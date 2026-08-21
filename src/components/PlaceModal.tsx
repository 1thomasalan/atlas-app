import { useRef, useState } from "react";
import { PickedImage } from "../lib/vision";
import { readPhotoMeta, PhotoMeta } from "../lib/exif";
import { Coords, appleMapsUrl, googleMapsUrl } from "../lib/geo";
import { openExternal } from "../lib/open";

/** New Place from a photo: read the camera + GPS out of the image, ask for a
 *  name (and a location if the photo has no GPS), then build the object —
 *  cover photo, coordinates, map links, and an AI-drafted profile. */

export interface NewPlaceData {
  name: string;
  coords?: Coords;
  locationText?: string;
  image?: PickedImage;
}

export default function PlaceModal(props: {
  openaiKey: string;
  onSave: (data: NewPlaceData) => Promise<void>;
  onClose: () => void;
}) {
  const [image, setImage] = useState<PickedImage | null>(null);
  const [meta, setMeta] = useState<PhotoMeta>({});
  const [name, setName] = useState("");
  const [locationText, setLocationText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const coords: Coords | null = meta.lat != null && meta.lon != null ? { lat: meta.lat, lon: meta.lon } : null;

  const pick = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f || !f.type.startsWith("image/")) return;
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
    const img = { b64: btoa(bin), mime: f.type, name: f.name };
    setImage(img);
    setError("");
    setMeta(await readPhotoMeta(img));
  };

  const save = async () => {
    if (!name.trim()) { setError("Give the place a name."); return; }
    setBusy(true);
    try {
      await props.onSave({
        name: name.trim(),
        coords: coords ?? undefined,
        locationText: locationText.trim() || undefined,
        image: image ?? undefined,
      });
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal import-modal">
        <span className="eyebrow" style={{ color: "var(--signal)" }}>New place · photo + AI profile</span>
        <h2>Add a place</h2>

        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
          onChange={(e) => pick(e.target.files)} />
        <div className="import-drop" onClick={() => fileRef.current?.click()}>
          {image
            ? <div className="import-thumbs"><span className="import-thumb"><img src={`data:${image.mime};base64,${image.b64}`} alt="" /></span><span className="import-thumb-add">↻</span></div>
            : <span>Choose a photo of the place…</span>}
        </div>

        {(meta.camera || coords) && (
          <div className="import-meta">
            <span className="eyebrow">From the photo</span>
            <div className="import-meta-row">
              {meta.camera && <span className="meta-chip">📷 {meta.camera}</span>}
              {coords ? (
                <>
                  <span className="meta-chip">📍 {coords.lat.toFixed(4)}, {coords.lon.toFixed(4)}</span>
                  <button className="tb-btn" onClick={() => openExternal(appleMapsUrl(coords, name))}>Apple Maps ↗</button>
                  <button className="tb-btn" onClick={() => openExternal(googleMapsUrl(coords))}>Google Maps ↗</button>
                </>
              ) : <span className="eyebrow">No GPS in this photo — add the location below.</span>}
            </div>
          </div>
        )}

        <div className="field">
          <label className="eyebrow">Name</label>
          <input className="input" autoFocus value={name} placeholder="e.g. Eastbank Esplanade"
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && coords && save()} />
        </div>
        {!coords && (
          <div className="field">
            <label className="eyebrow">Location — where is it? (no GPS found)</label>
            <input className="input" value={locationText} placeholder="e.g. Portland, Oregon"
              onChange={(e) => setLocationText(e.target.value)} />
          </div>
        )}
        {error && <p className="import-error">{error}</p>}

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn primary" onClick={save} disabled={busy || !name.trim()}>
            {busy ? "Building…" : "Create place"}
          </button>
          <button className="btn" onClick={props.onClose}>Cancel</button>
          <span className="eyebrow">
            {props.openaiKey ? "AI drafts a short profile + map links" : "Adds map links (set an OpenAI key for an AI profile)"}
          </span>
        </div>
      </div>
    </div>
  );
}
