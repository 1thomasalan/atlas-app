import exifr from "exifr";
import { PickedImage } from "./vision";

/** Reads the camera, capture time, and GPS coordinates a phone or camera
 *  writes into a photo's EXIF block. Screenshots and PNGs usually carry
 *  none of this, so every field is optional and failure is silent. */

export interface PhotoMeta {
  camera?: string;     // "Apple iPhone 15 Pro"
  takenAt?: string;    // YYYY-MM-DD
  lat?: number;
  lon?: number;
}

function bytesOf(img: PickedImage): Uint8Array {
  const bin = atob(img.b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function readPhotoMeta(img: PickedImage): Promise<PhotoMeta> {
  try {
    const d = await exifr.parse(bytesOf(img), {
      pick: ["Make", "Model", "DateTimeOriginal", "GPSLatitude", "GPSLongitude"],
      gps: true,
    }) as Record<string, unknown> | undefined;
    if (!d) return {};
    const make = typeof d.Make === "string" ? d.Make.trim() : "";
    const model = typeof d.Model === "string" ? d.Model.trim() : "";
    // "Apple iPhone 15 Pro" — drop a make already echoed in the model
    const camera = model
      ? (make && !model.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${model}` : model)
      : make || undefined;
    const taken = d.DateTimeOriginal instanceof Date && !isNaN(d.DateTimeOriginal.getTime())
      ? isoDay(d.DateTimeOriginal) : undefined;
    const lat = typeof d.latitude === "number" ? d.latitude : undefined;
    const lon = typeof d.longitude === "number" ? d.longitude : undefined;
    return {
      camera: camera || undefined,
      takenAt: taken,
      lat: lat != null && lon != null ? lat : undefined,
      lon: lat != null && lon != null ? lon : undefined,
    };
  } catch {
    return {};
  }
}

function isoDay(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
