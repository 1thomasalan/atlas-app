import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { inTauri } from "./demoFs";
import { ObjectIndex, AtlasObject, objectsOfType } from "./objects";

/** Coordinates, map links, and nearest-place matching. Coordinates ride in
 *  frontmatter as a plain "lat,lon" string so Obsidian and a future Chrome
 *  clipper read the same field. */

export interface Coords { lat: number; lon: number; }

export const formatCoords = (c: Coords) => `${c.lat.toFixed(6)},${c.lon.toFixed(6)}`;

export function parseCoords(raw: unknown): Coords | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export const appleMapsUrl = (c: Coords, label?: string) =>
  `https://maps.apple.com/?ll=${c.lat},${c.lon}${label ? `&q=${encodeURIComponent(label)}` : "&q=Dropped%20Pin"}`;

export const googleMapsUrl = (c: Coords) =>
  `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lon}`;

/** Markdown block of map links, dropped into a place / meal body. */
export function mapLinksMarkdown(c: Coords, label?: string): string {
  return `- [Open in Apple Maps](${appleMapsUrl(c, label)})\n- [Open in Google Maps](${googleMapsUrl(c)})`;
}

/** Metres between two points (haversine). */
export function distanceMeters(a: Coords, b: Coords): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export interface NearbyPlace { obj: AtlasObject; meters: number; }

/** Existing place objects that carry coordinates, nearest first. */
export function placesWithCoords(index: ObjectIndex): { obj: AtlasObject; coords: Coords }[] {
  return objectsOfType(index, "place")
    .map((o) => {
      const coords = parseCoords(o.props.coordinates);
      return coords ? { obj: o, coords } : null;
    })
    .filter(Boolean) as { obj: AtlasObject; coords: Coords }[];
}

/** The closest place within `radius` metres of a point, if any. */
export function nearestPlace(index: ObjectIndex, c: Coords, radius = 250): NearbyPlace | null {
  let best: NearbyPlace | null = null;
  for (const { obj, coords } of placesWithCoords(index)) {
    const meters = distanceMeters(c, coords);
    if (meters <= radius && (!best || meters < best.meters)) best = { obj, meters };
  }
  return best;
}

/* ----------------------------------------------------------------------
   Geocoding — keyless via OpenStreetMap Nominatim (CORS-enabled, usage
   policy ~1 req/sec which a manual field edit never exceeds). Reverse:
   coordinates → a readable place name. Forward: a typed place → coordinates
   the user then verifies. Same fetch shim as the photo/unfurl libs.
   ---------------------------------------------------------------------- */

const doFetch = (input: string, init?: RequestInit) =>
  inTauri ? tauriFetch(input, init) : fetch(input, init);

const NOMINATIM = "https://nominatim.openstreetmap.org";
const GEO_HEADERS = { "User-Agent": "AtlasPKM/2.0 (personal knowledge app)", Accept: "application/json" };

interface NomRecord { name?: string; display_name?: string; address?: Record<string, string>; lat?: string; lon?: string; }

/** Build a concise "Feature, Area" label from a Nominatim record. */
function placeNameFrom(j: NomRecord): string {
  const a = j.address ?? {};
  const primary = j.name || a.amenity || a.shop || a.tourism || a.building || a.road ||
    a.neighbourhood || a.suburb || a.village || a.town || a.city || "";
  const area = a.suburb || a.city_district || a.town || a.city || a.county || a.state || "";
  const parts = [primary, area].filter((p, i, arr) => p && arr.indexOf(p) === i);
  if (parts.length) return parts.slice(0, 2).join(", ");
  return (j.display_name ?? "").split(",").slice(0, 2).map((s) => s.trim()).filter(Boolean).join(", ");
}

/** A short, readable place name for coordinates, or null. */
export async function reverseGeocode(c: Coords): Promise<string | null> {
  try {
    const res = await doFetch(
      `${NOMINATIM}/reverse?lat=${c.lat}&lon=${c.lon}&format=jsonv2&zoom=16&addressdetails=1`,
      { headers: GEO_HEADERS });
    if (!res.ok) return null;
    const j = (await res.json()) as NomRecord;
    return placeNameFrom(j) || null;
  } catch { return null; }
}

export interface GeoHit { coords: Coords; label: string; }

/** Best coordinates (and a label) for a typed place name, or null. */
export async function forwardGeocode(query: string): Promise<GeoHit | null> {
  const q = query.trim();
  if (!q) return null;
  try {
    const res = await doFetch(
      `${NOMINATIM}/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=1&addressdetails=1`,
      { headers: GEO_HEADERS });
    if (!res.ok) return null;
    const arr = (await res.json()) as NomRecord[];
    const hit = arr?.[0];
    if (!hit?.lat || !hit?.lon) return null;
    const lat = Number(hit.lat), lon = Number(hit.lon);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    return { coords: { lat, lon }, label: placeNameFrom(hit) || hit.display_name || q };
  } catch { return null; }
}
