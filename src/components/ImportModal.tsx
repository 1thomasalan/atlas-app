import { useEffect, useMemo, useRef, useState } from "react";
import { todayStamp } from "../lib/daily";
import {
  PickedImage, WorkoutExtract, MealExtract, extractFromImages, refineHealthImport,
} from "../lib/vision";
import { WorkoutDraft, MealDraft, ImportExtras } from "../lib/healthImport";
import { readPhotoMeta, PhotoMeta } from "../lib/exif";
import { Coords, distanceMeters, appleMapsUrl, googleMapsUrl } from "../lib/geo";
import { openExternal } from "../lib/open";

export interface PlaceRef { title: string; lat: number; lon: number; }

/** Screenshot → AI extraction → review (with a free-text note for the AI and
 *  AI insights) → save. The model never writes directly: everything lands in
 *  this form first, the original screenshots are saved into the vault, and the
 *  photo is embedded in the entry for reference. */

export type { WorkoutDraft, MealDraft };

const emptyWorkout = (): WorkoutDraft => ({
  date: todayStamp(), time: "", minutes: "", workoutType: "", kcal: "", heartRate: "", exercises: "",
});
const emptyMeal = (): MealDraft => ({
  date: todayStamp(), meal: "lunch", calories: "", protein: "", carbs: "", fat: "", items: "",
});

export default function ImportModal(props: {
  kind: "workout" | "meal";
  openaiKey: string;
  history?: string;            // compact recent entries, for trend insights
  places?: PlaceRef[];         // existing places with coordinates, for matching
  onSave: (draft: WorkoutDraft | MealDraft, images: PickedImage[], extras: ImportExtras) => Promise<void>;
  onClose: () => void;
}) {
  const { kind } = props;
  const [images, setImages] = useState<PickedImage[]>([]);
  const [workout, setWorkout] = useState<WorkoutDraft>(emptyWorkout());
  const [meal, setMeal] = useState<MealDraft>(emptyMeal());
  const [notes, setNotes] = useState("");
  const [insights, setInsights] = useState("");
  const [meta, setMeta] = useState<PhotoMeta>({});
  const [placeChoice, setPlaceChoice] = useState("");   // "" none · "__new__" · existing title
  const [newPlaceName, setNewPlaceName] = useState("");
  const [busy, setBusy] = useState<"extract" | "refine" | "save" | null>(null);
  const [error, setError] = useState("");
  const [extracted, setExtracted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const draft = kind === "workout" ? workout : meal;
  const coords: Coords | null = meta.lat != null && meta.lon != null ? { lat: meta.lat, lon: meta.lon } : null;

  const nearest = useMemo(() => {
    if (!coords || !props.places?.length) return null;
    let best: { p: PlaceRef; m: number } | null = null;
    for (const p of props.places) {
      const m = distanceMeters(coords, { lat: p.lat, lon: p.lon });
      if (m <= 250 && (!best || m < best.m)) best = { p, m };
    }
    return best;
  }, [coords, props.places]);

  const pickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const next: PickedImage[] = [...images];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
      next.push({ b64: btoa(bin), mime: f.type, name: f.name });
    }
    setImages(next);
    setError("");
  };

  // EXIF is derived from the WHOLE current image set, not just the first
  // pick — so a camera-only photo never masks a later geotagged one, and
  // removing a photo recomputes (no stale camera/coords surviving its source).
  const placeChoiceTouched = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const merged: PhotoMeta = {};
      for (const img of images) {
        const m = await readPhotoMeta(img);
        merged.camera ??= m.camera;
        merged.takenAt ??= m.takenAt;
        if (merged.lat == null && m.lat != null) { merged.lat = m.lat; merged.lon = m.lon; }
        if (merged.camera && merged.lat != null) break;
      }
      if (cancelled) return;
      setMeta(merged);
      if (merged.takenAt) {
        if (kind === "meal") setMeal((cur) => (cur.date === todayStamp() ? { ...cur, date: merged.takenAt! } : cur));
        else setWorkout((cur) => (cur.date === todayStamp() ? { ...cur, date: merged.takenAt! } : cur));
      }
      if (merged.lat == null) {
        setPlaceChoice(""); placeChoiceTouched.current = false;   // coords gone → no place link
      } else if (!placeChoiceTouched.current) {
        let near: PlaceRef | null = null, best = Infinity;
        for (const p of props.places ?? []) {
          const d = distanceMeters({ lat: merged.lat, lon: merged.lon! }, { lat: p.lat, lon: p.lon });
          if (d <= 250 && d < best) { best = d; near = p; }
        }
        setPlaceChoice(near ? near.title : "__new__");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  const applyExtract = (r: WorkoutExtract | MealExtract) => {
    if (kind === "workout") {
      const w = r as WorkoutExtract;
      setWorkout((cur) => ({
        date: w.date ?? cur.date,   // keep an EXIF-prefilled date when the shot has none
        time: w.time ?? "",
        minutes: w.duration_minutes != null ? String(Math.round(w.duration_minutes)) : "",
        workoutType: w.workout_type ?? "",
        kcal: w.energy_kcal != null ? String(w.energy_kcal) : "",
        heartRate: w.heart_rate ?? "",
        exercises: (w.exercises ?? []).map((e) => `${e.name} — ${e.amount}`).join("\n"),
      }));
    } else {
      const m = r as MealExtract;
      setMeal((cur) => ({
        date: m.date ?? cur.date,
        meal: m.meal ?? "lunch",
        calories: m.calories_total != null ? String(m.calories_total) : "",
        protein: m.protein_g != null ? String(m.protein_g) : "",
        carbs: m.carbs_g != null ? String(m.carbs_g) : "",
        fat: m.fat_g != null ? String(m.fat_g) : "",
        items: (m.items ?? []).map((i) =>
          `${i.name}${i.quantity ? ` (${i.quantity})` : ""}${i.calories != null ? ` — ${i.calories} kcal` : ""}`).join("\n"),
      }));
    }
  };

  const extract = async () => {
    if (!props.openaiKey) { setError("Add your OpenAI key in Settings to read screenshots automatically — or fill the fields by hand."); return; }
    setBusy("extract");
    setError("");
    try {
      applyExtract(await extractFromImages(props.openaiKey, kind, images, notes));
      setExtracted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setBusy(null);
    }
  };

  const refine = async () => {
    if (!props.openaiKey) { setError("AI insights need your OpenAI key (Settings)."); return; }
    setBusy("refine");
    setError("");
    try {
      const r = await refineHealthImport(props.openaiKey, kind, images, draft, notes, props.history ?? "");
      if (kind === "workout") setWorkout(r.draft as WorkoutDraft);
      else setMeal(r.draft as MealDraft);
      setInsights(r.insights);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refine failed");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    try {
      await props.onSave(draft, images, {
        insights: insights.trim() || undefined,
        userNotes: notes.trim() || undefined,
        camera: meta.camera,
        takenAt: meta.takenAt,
        coords: coords ?? undefined,
        linkPlaceTitle: placeChoice && placeChoice !== "__new__" ? placeChoice : undefined,
        newPlaceName: placeChoice === "__new__" && newPlaceName.trim() ? newPlaceName.trim() : undefined,
      });
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setBusy(null);
    }
  };

  const F = (label: string, value: string, set: (v: string) => void, opts?: { type?: string; width?: number; placeholder?: string }) => (
    <div className="field" style={{ flex: opts?.width ? `0 0 ${opts.width}px` : 1, minWidth: 90 }}>
      <label className="eyebrow">{label}</label>
      <input className="input" type={opts?.type ?? "text"} value={value}
        placeholder={opts?.placeholder} onChange={(e) => set(e.target.value)} />
    </div>
  );

  const hasKey = !!props.openaiKey;

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal import-modal">
        <span className="eyebrow" style={{ color: "var(--signal)" }}>
          Import {kind} · screenshots stay in your vault
        </span>
        <h2>{kind === "workout" ? "Log a workout" : "Log a meal"}</h2>

        <input
          ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }}
          onChange={(e) => pickFiles(e.target.files)}
        />
        <div className="import-drop" onClick={() => fileRef.current?.click()}>
          {images.length === 0
            ? <span>Choose {kind === "workout" ? "screenshots — summary + exercise pages together" : "a food photo or nutrition screenshot"}…</span>
            : (
              <div className="import-thumbs">
                {images.map((img, i) => (
                  <span key={i} className="import-thumb">
                    <img src={`data:${img.mime};base64,${img.b64}`} alt={img.name} />
                    <button className="import-thumb-x" onClick={(e) => { e.stopPropagation(); setImages(images.filter((_, j) => j !== i)); }}>×</button>
                  </span>
                ))}
                <span className="import-thumb-add">+</span>
              </div>
            )}
        </div>

        {/* Context for the AI — usable BEFORE extracting (the model reads it on
            the first pass) and again when refining AFTER. */}
        <div className="field">
          <label className="eyebrow">Notes &amp; context for the AI — optional</label>
          <textarea className="input" rows={2} value={notes}
            placeholder={kind === "meal"
              ? "Anything the photo can't show — brand, portion, how it was made · e.g. 2 scoops Orgain + almond milk, post-workout, ate about half"
              : "Anything the screenshot can't show · e.g. felt easy today, cut it short, new program week 1"}
            onChange={(e) => setNotes(e.target.value)} />
          <span className="eyebrow">Add details before extracting and the AI uses them — or add more after and re-read below.</span>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn primary" onClick={extract} disabled={images.length === 0 || busy !== null}>
            {busy === "extract" ? "Reading…" : extracted ? "Re-read photo" : "Extract with AI"}
          </button>
          <span className="eyebrow">
            {extracted ? "Check the fields below" : notes.trim() ? "reads your notes + the photo" : "reads the photo · or fill in by hand"}
          </span>
        </div>
        {error && <p className="import-error">{error}</p>}

        {kind === "workout" ? (
          <>
            <div className="import-fields">
              {F("Date", workout.date, (v) => setWorkout({ ...workout, date: v }), { type: "date", width: 150 })}
              {F("Time", workout.time, (v) => setWorkout({ ...workout, time: v }), { width: 92, placeholder: "06:36" })}
              {F("Type", workout.workoutType, (v) => setWorkout({ ...workout, workoutType: v }), { placeholder: "Core Training" })}
              {F("Minutes", workout.minutes, (v) => setWorkout({ ...workout, minutes: v }), { type: "number", width: 90 })}
              {F("kcal", workout.kcal, (v) => setWorkout({ ...workout, kcal: v }), { type: "number", width: 90 })}
              {F("Heart rate", workout.heartRate, (v) => setWorkout({ ...workout, heartRate: v }), { width: 110, placeholder: "102-129" })}
            </div>
            <div className="field">
              <label className="eyebrow">Exercises — one per line</label>
              <textarea className="input" rows={5} value={workout.exercises}
                placeholder={"Bird Dogs — 9×\nPlank — 15sec"}
                onChange={(e) => setWorkout({ ...workout, exercises: e.target.value })} />
            </div>
          </>
        ) : (
          <>
            <div className="import-fields">
              {F("Date", meal.date, (v) => setMeal({ ...meal, date: v }), { type: "date", width: 150 })}
              <div className="field" style={{ flex: "0 0 130px" }}>
                <label className="eyebrow">Meal</label>
                <select className="input" value={meal.meal} onChange={(e) => setMeal({ ...meal, meal: e.target.value })}>
                  <option>breakfast</option><option>lunch</option><option>dinner</option><option>snack</option>
                </select>
              </div>
              {F("kcal", meal.calories, (v) => setMeal({ ...meal, calories: v }), { type: "number", width: 90 })}
              {F("Protein g", meal.protein, (v) => setMeal({ ...meal, protein: v }), { type: "number", width: 90 })}
              {F("Carbs g", meal.carbs, (v) => setMeal({ ...meal, carbs: v }), { type: "number", width: 90 })}
              {F("Fat g", meal.fat, (v) => setMeal({ ...meal, fat: v }), { type: "number", width: 90 })}
            </div>
            <div className="field">
              <label className="eyebrow">Items — one per line</label>
              <textarea className="input" rows={4} value={meal.items}
                placeholder={"Chicken bowl — 520 kcal\nApple — 90 kcal"}
                onChange={(e) => setMeal({ ...meal, items: e.target.value })} />
            </div>
          </>
        )}

        {/* ---- From the photo: camera + location ---- */}
        {(meta.camera || coords) && (
          <div className="import-meta">
            <span className="eyebrow">From the photo</span>
            <div className="import-meta-row">
              {meta.camera && <span className="meta-chip">📷 {meta.camera}</span>}
              {meta.takenAt && <span className="meta-chip">📅 {meta.takenAt}</span>}
              {coords && (
                <>
                  <span className="meta-chip">📍 {coords.lat.toFixed(4)}, {coords.lon.toFixed(4)}</span>
                  <button className="tb-btn" onClick={() => openExternal(appleMapsUrl(coords, newPlaceName || placeChoice))}>Apple Maps ↗</button>
                  <button className="tb-btn" onClick={() => openExternal(googleMapsUrl(coords))}>Google Maps ↗</button>
                </>
              )}
            </div>
            {coords && (
              <div className="import-meta-row" style={{ marginTop: 8 }}>
                <label className="eyebrow" style={{ alignSelf: "center" }}>Place</label>
                <select className="input" style={{ width: "auto", minWidth: 180 }}
                  value={placeChoice} onChange={(e) => { placeChoiceTouched.current = true; setPlaceChoice(e.target.value); }}>
                  <option value="">Don't link a place</option>
                  {(props.places ?? []).map((p) => (
                    <option key={p.title} value={p.title}>
                      {p.title}{nearest?.p.title === p.title ? ` · ${Math.round(nearest.m)}m away` : ""}
                    </option>
                  ))}
                  <option value="__new__">+ New place…</option>
                </select>
                {placeChoice === "__new__" && (
                  <input className="input" style={{ flex: 1, minWidth: 160 }} autoFocus
                    placeholder="Name this place — e.g. Eastbank Esplanade"
                    value={newPlaceName} onChange={(e) => setNewPlaceName(e.target.value)} />
                )}
              </div>
            )}
            {placeChoice === "__new__" && (
              <span className="eyebrow" style={{ marginTop: 4 }}>
                Atlas creates the place with map links{props.openaiKey ? " and an AI profile" : ""}.
              </span>
            )}
          </div>
        )}

        {/* ---- Refine AFTER: re-read with the (updated) notes above + insights ---- */}
        <div className="field" style={{ marginTop: 4 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn" onClick={refine} disabled={busy !== null || images.length === 0 || !hasKey}>
              {busy === "refine" ? "Thinking…" : "Re-read with notes & add insights"}
            </button>
            <span className="eyebrow">
              {hasKey ? "Re-reads the photo with your notes above, corrects the fields, and writes commentary" : "Add an OpenAI key for insights"}
            </span>
          </div>
        </div>

        {insights && (
          <div className="field import-insights">
            <label className="eyebrow" style={{ color: "var(--calm)" }}>Insights — saved into the entry, edit freely</label>
            <textarea className="input" rows={4} value={insights}
              onChange={(e) => setInsights(e.target.value)} />
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn primary" onClick={save} disabled={busy !== null}>
            {busy === "save" ? "Saving…" : "Save to vault"}
          </button>
          <button className="btn" onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
