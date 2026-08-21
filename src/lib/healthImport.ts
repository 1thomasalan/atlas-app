import { AtlasProfile } from "./atlasProfile";
import { ObjectIndex, AtlasObject, createObject, objectsOfType } from "./objects";
import { ObjectTypeDef, typeByKey } from "./objectTypes";
import { join, ensureDir, fileExists, writeBinaryFile } from "./vault";
import { inTauri } from "./demoFs";
import { habitDefs, setHabit } from "./habits";
import { PickedImage } from "./vision";
import { Coords, formatCoords, mapLinksMarkdown } from "./geo";
import { createPlaceObject } from "./places";

/** Saving an AI-extracted (user-reviewed) workout or meal: screenshots into
 *  the vault's attachments, one markdown object, and — for workouts — the
 *  Exercise habit ticked for that date. Shared by the Habits screen and the
 *  Meals / Workouts browsers. */

export interface WorkoutDraft {
  date: string; time: string; minutes: string; workoutType: string;
  kcal: string; heartRate: string; exercises: string;   // one per line: "Name — 9×"
}
export interface MealDraft {
  date: string; meal: string; calories: string; protein: string;
  carbs: string; fat: string; items: string;            // one per line: "Name — 320 kcal"
}

/** Optional AI/user extras gathered in the review step. */
export interface ImportExtras {
  insights?: string;
  userNotes?: string;
  camera?: string;            // from photo EXIF
  takenAt?: string;           // photo capture date
  coords?: Coords;            // photo GPS
  linkPlaceTitle?: string;    // link to an existing place by title
  newPlaceName?: string;      // create a new place at coords, then link it
}

export interface HealthImportResult {
  objectPath: string;
  habitNotePath?: string;   // daily note touched by the Exercise tick
  placePath?: string;       // a place created during this import
  exerciseTicked: boolean;
}

/** A compact recent-history block the refine pass reads to spot trends. */
export function formatHealthHistory(index: ObjectIndex, kind: "workout" | "meal", limit = 10): string {
  const rows = objectsOfType(index, kind)
    .sort((a, b) => ((a.props.date as string ?? "") < (b.props.date as string ?? "") ? 1 : -1))
    .slice(0, limit);
  const p = (o: AtlasObject, k: string) => (o.props[k] != null ? String(o.props[k]) : "");
  return rows.map((o) => kind === "meal"
    ? `${p(o, "date")} ${p(o, "meal")}: ${p(o, "calories")}kcal P${p(o, "protein")} C${p(o, "carbs")} F${p(o, "fat")}`.trim()
    : `${p(o, "date")} ${p(o, "workout_type")}: ${p(o, "duration")}min ${p(o, "energy")}kcal ${p(o, "heart_rate")}`.trim(),
  ).join("\n");
}

export async function saveHealthImport(
  profile: AtlasProfile,
  types: ObjectTypeDef[],
  index: ObjectIndex,
  kind: "workout" | "meal",
  draft: WorkoutDraft | MealDraft,
  images: PickedImage[],
  extras: ImportExtras = {},
  openaiKey?: string,
): Promise<HealthImportResult> {
  const attachRel = profile.isAtlas ? "02-Library/Health/Attachments" : "Health/Attachments";

  // Write screenshots; keep both the vault-relative path (frontmatter cover)
  // and the note-relative path (Obsidian-resolvable body embed).
  const coverVaultRel: string[] = [];   // <attachRel>/<name>
  const coverNoteRel: string[] = [];    // ../Attachments/<name>
  if (inTauri && images.length) {
    const dir = join(profile.root, attachRel);
    await ensureDir(dir);
    for (let i = 0; i < images.length; i++) {
      const ext = images[i].mime.includes("png") ? "png" : "jpg";
      let name = `${kind}-${draft.date}-${i + 1}.${ext}`;
      if (await fileExists(join(dir, name))) name = `${kind}-${draft.date}-${i + 1}-${Date.now() % 10000}.${ext}`;
      const bin = atob(images[i].b64);
      const bytes = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
      await writeBinaryFile(join(dir, name), bytes);
      coverVaultRel.push(`${attachRel}/${name}`);
      coverNoteRel.push(`../Attachments/${name}`);
    }
  }
  const photoBlock = coverNoteRel.map((r, i) => `![${kind} photo${i + 1}](${r})`).join("\n");
  const noteBlock = extras.userNotes?.trim() ? `> ${extras.userNotes.trim().replace(/\n/g, "\n> ")}` : "";
  const cameraCaption = extras.camera ? `*Shot on ${extras.camera}*` : "";

  // ---- Photo metadata: camera, capture date, GPS, and the place link ----
  const metaFm: Record<string, string> = {};
  if (extras.camera) metaFm.camera = extras.camera;
  if (extras.takenAt) metaFm.taken = extras.takenAt;

  let placePath: string | undefined;
  let placeLink: string | undefined;
  if (extras.coords) {
    metaFm.coordinates = formatCoords(extras.coords);
    if (extras.newPlaceName?.trim()) {
      placePath = await createPlaceObject(profile, types, {
        name: extras.newPlaceName.trim(), coords: extras.coords, openaiKey,
      });
      placeLink = `[[${extras.newPlaceName.trim()}]]`;
    } else if (extras.linkPlaceTitle?.trim()) {
      placeLink = `[[${extras.linkPlaceTitle.trim()}]]`;
    }
    if (placeLink) metaFm.location = placeLink;
  }

  const placeLabel = extras.newPlaceName?.trim() || extras.linkPlaceTitle?.trim();
  const locationBlock = extras.coords
    ? `## Location\n${placeLink ? `${placeLink}\n\n` : ""}${mapLinksMarkdown(extras.coords, placeLabel)}\n\nCoordinates: ${formatCoords(extras.coords)}`
    : "";

  if (kind === "workout") {
    const w = draft as WorkoutDraft;
    const title = `${w.workoutType.trim() || "Workout"} — ${w.date}`;
    const fm: Record<string, string> = { date: w.date, source: "screenshot", ...metaFm };
    if (coverVaultRel[0]) fm.image = coverVaultRel[0];
    if (w.time.trim()) fm.time = w.time.trim();
    if (w.workoutType.trim()) fm.workout_type = w.workoutType.trim();
    if (w.minutes) fm.duration = w.minutes;
    if (w.kcal) fm.energy = w.kcal;
    if (w.heartRate.trim()) fm.heart_rate = w.heartRate.trim();
    fm.summary = [w.minutes && `${w.minutes} min`, w.kcal && `${w.kcal} kcal`, w.heartRate.trim()]
      .filter(Boolean).join(" · ") || "Workout";
    const exercises = w.exercises.split("\n").map((l) => l.trim()).filter(Boolean);
    const body = [
      `# ${title}`, "", photoBlock, cameraCaption, noteBlock,
      exercises.length ? `## Exercises\n${exercises.map((e) => `- ${e}`).join("\n")}` : "",
      locationBlock,
      extras.insights?.trim() ? `## Insights\n${extras.insights.trim()}` : "",
    ].filter(Boolean).join("\n\n");
    const objectPath = await createObject(profile, typeByKey(types, "workout")!, title, fm, body);

    const exHabit = habitDefs(index).find((h) => /exercise/i.test(h.name));
    let habitNotePath: string | undefined;
    if (exHabit) {
      habitNotePath = await setHabit(profile, w.date, exHabit.name, true,
        w.minutes ? Number(w.minutes) : undefined);
    }
    return { objectPath, habitNotePath, placePath, exerciseTicked: !!exHabit };
  }

  const m = draft as MealDraft;
  const mealKind = (m.meal || "").trim() || "meal";   // never let an empty meal crash the title
  const title = `${mealKind[0].toUpperCase()}${mealKind.slice(1)} — ${m.date}`;
  const fm: Record<string, string> = { date: m.date, meal: mealKind, source: "screenshot", ...metaFm };
  if (coverVaultRel[0]) fm.image = coverVaultRel[0];
  if (m.calories) fm.calories = m.calories;
  if (m.protein) fm.protein = m.protein;
  if (m.carbs) fm.carbs = m.carbs;
  if (m.fat) fm.fat = m.fat;
  fm.summary = [m.calories && `${m.calories} kcal`, m.protein && `${m.protein}g protein`,
    m.carbs && `${m.carbs}g carbs`, m.fat && `${m.fat}g fat`].filter(Boolean).join(" · ") || "Meal";
  const items = m.items.split("\n").map((l) => l.trim()).filter(Boolean);
  const body = [
    `# ${title}`, "", photoBlock, cameraCaption, noteBlock,
    items.length ? `## Items\n${items.map((i) => `- ${i}`).join("\n")}` : "",
    locationBlock,
    extras.insights?.trim() ? `## Insights\n${extras.insights.trim()}` : "",
  ].filter(Boolean).join("\n\n");
  const objectPath = await createObject(profile, typeByKey(types, "meal")!, title, fm, body);
  return { objectPath, placePath, exerciseTicked: false };
}
