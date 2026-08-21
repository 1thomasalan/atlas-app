import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { inTauri } from "./demoFs";
import { forwardGeocode } from "./geo";

/** Local weather for the Daily Brief. Open-Meteo is free, keyless and
 *  CORS-friendly, so it works in the Tauri app and the browser demo. The
 *  location is geocoded with Open-Meteo's OWN geocoder (keyless, no
 *  User-Agent / rate-limit requirements — unlike Nominatim, which the packaged
 *  app's HTTP client gets blocked by); Nominatim is kept only as a fallback. */

const doFetch = (input: string, init?: RequestInit) =>
  inTauri ? tauriFetch(input, init) : fetch(input, init);

interface GeoResult { lat: number; lon: number; label: string }

/** Resolve a place name → coordinates. Tries Open-Meteo's geocoder (the full
 *  string, then the part before any comma), then Nominatim as a last resort. */
async function geocode(name: string): Promise<GeoResult | null> {
  const queries = [name, name.split(",")[0].trim()].filter((v, i, a) => v && a.indexOf(v) === i);
  for (const q of queries) {
    try {
      const res = await doFetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`,
      );
      if (!res.ok) continue;
      const j = (await res.json()) as { results?: { latitude: number; longitude: number; name?: string; admin1?: string; country?: string }[] };
      const r = j.results?.[0];
      if (r && isFinite(r.latitude) && isFinite(r.longitude)) {
        const label = [r.name, r.admin1, r.country].filter((v, i, a) => v && a.indexOf(v) === i).join(", ");
        return { lat: r.latitude, lon: r.longitude, label: label || q };
      }
    } catch { /* try the next query / fallback */ }
  }
  try {
    const hit = await forwardGeocode(name);
    if (hit) return { lat: hit.coords.lat, lon: hit.coords.lon, label: hit.label };
  } catch { /* no geocode available */ }
  return null;
}

export interface Weather {
  location: string;
  current: {
    tempC: number; tempF: number; feelsC: number; feelsF: number;
    humidity: number; windKph: number; label: string; emoji: string;
  };
  today: {
    hiC: number; loC: number; hiF: number; loF: number;
    label: string; emoji: string; precipPct: number | null;
  };
}

const cToF = (c: number) => Math.round((c * 9) / 5 + 32);

/** WMO weather-interpretation codes → a short label + emoji. */
const WMO: Record<number, { label: string; emoji: string }> = {
  0: { label: "Clear", emoji: "☀️" }, 1: { label: "Mainly clear", emoji: "🌤️" },
  2: { label: "Partly cloudy", emoji: "⛅" }, 3: { label: "Overcast", emoji: "☁️" },
  45: { label: "Fog", emoji: "🌫️" }, 48: { label: "Rime fog", emoji: "🌫️" },
  51: { label: "Light drizzle", emoji: "🌦️" }, 53: { label: "Drizzle", emoji: "🌦️" }, 55: { label: "Heavy drizzle", emoji: "🌧️" },
  56: { label: "Freezing drizzle", emoji: "🌧️" }, 57: { label: "Freezing drizzle", emoji: "🌧️" },
  61: { label: "Light rain", emoji: "🌦️" }, 63: { label: "Rain", emoji: "🌧️" }, 65: { label: "Heavy rain", emoji: "🌧️" },
  66: { label: "Freezing rain", emoji: "🌧️" }, 67: { label: "Freezing rain", emoji: "🌧️" },
  71: { label: "Light snow", emoji: "🌨️" }, 73: { label: "Snow", emoji: "🌨️" }, 75: { label: "Heavy snow", emoji: "❄️" }, 77: { label: "Snow grains", emoji: "🌨️" },
  80: { label: "Light showers", emoji: "🌦️" }, 81: { label: "Showers", emoji: "🌧️" }, 82: { label: "Violent showers", emoji: "⛈️" },
  85: { label: "Snow showers", emoji: "🌨️" }, 86: { label: "Snow showers", emoji: "❄️" },
  95: { label: "Thunderstorm", emoji: "⛈️" }, 96: { label: "Thunderstorm, hail", emoji: "⛈️" }, 99: { label: "Thunderstorm, hail", emoji: "⛈️" },
};
const wmo = (code: number | undefined) => WMO[code ?? -1] ?? { label: "—", emoji: "🌡️" };

interface OpenMeteo {
  current?: {
    temperature_2m: number; relative_humidity_2m: number;
    apparent_temperature: number; weather_code: number; wind_speed_10m: number;
  };
  daily?: {
    weather_code: number[]; temperature_2m_max: number[];
    temperature_2m_min: number[]; precipitation_probability_max?: (number | null)[];
  };
}

/** Today's weather for a place name, or null if it can't be resolved. */
export async function getWeather(location: string): Promise<Weather | null> {
  const loc = location.trim();
  if (!loc) return null;
  const hit = await geocode(loc);
  if (!hit) return null;
  const { lat, lon } = hit;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
    "&timezone=auto&forecast_days=1";
  try {
    const res = await doFetch(url);
    if (!res.ok) return null;
    const j = (await res.json()) as OpenMeteo;
    const c = j.current, d = j.daily;
    if (!c || !d) return null;
    const cur = wmo(c.weather_code), day = wmo(d.weather_code?.[0]);
    return {
      location: hit.label,
      current: {
        tempC: Math.round(c.temperature_2m), tempF: cToF(c.temperature_2m),
        feelsC: Math.round(c.apparent_temperature), feelsF: cToF(c.apparent_temperature),
        humidity: Math.round(c.relative_humidity_2m), windKph: Math.round(c.wind_speed_10m),
        label: cur.label, emoji: cur.emoji,
      },
      today: {
        hiC: Math.round(d.temperature_2m_max[0]), loC: Math.round(d.temperature_2m_min[0]),
        hiF: cToF(d.temperature_2m_max[0]), loF: cToF(d.temperature_2m_min[0]),
        label: day.label, emoji: day.emoji,
        precipPct: d.precipitation_probability_max?.[0] ?? null,
      },
    };
  } catch { return null; }
}
