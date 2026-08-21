/** Line-drawn, quietly animated weather marks — Swiss strokes, one accent
 *  color per condition. Motion is subtle and honors prefers-reduced-motion
 *  (the global reset kills animations there). */

export type WeatherKind = "sun" | "cloud" | "rain" | "storm";

export function weatherKindOf(text: string | null): WeatherKind | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/thunder|storm|lightning|typhoon/.test(t)) return "storm";
  if (/rain|shower|drizzle|wet|downpour/.test(t)) return "rain";
  if (/cloud|overcast|grey|gray/.test(t)) return "cloud";
  if (/sun|clear|fair|fine|hot|blue sky/.test(t)) return "sun";
  return "cloud";
}

const COLOR: Record<WeatherKind, string> = {
  sun: "var(--signal)",
  cloud: "var(--ink-3)",
  rain: "#3a7ca5",
  storm: "var(--warn)",
};

const Cloud = ({ className }: { className?: string }) => (
  <path
    className={className}
    d="M13 32 h21 a7 7 0 0 0 1-13.9 A10 10 0 0 0 16 16.5 7.5 7.5 0 0 0 13 31.9 Z"
    fill="none"
  />
);

export default function WeatherGlyph(props: { kind: WeatherKind; size?: number }) {
  const { kind } = props;
  const size = props.size ?? 46;
  return (
    <svg
      className="wx"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      style={{ color: COLOR[kind] }}
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="square"
      fill="none"
      aria-hidden
    >
      {kind === "sun" && (
        <>
          <circle cx="24" cy="24" r="8.5" />
          <g className="wx-rays">
            {Array.from({ length: 8 }, (_, i) => {
              const a = (i * Math.PI) / 4;
              const x1 = 24 + Math.cos(a) * 13, y1 = 24 + Math.sin(a) * 13;
              const x2 = 24 + Math.cos(a) * 18, y2 = 24 + Math.sin(a) * 18;
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
            })}
          </g>
        </>
      )}
      {kind === "cloud" && <Cloud className="wx-cloud" />}
      {kind === "rain" && (
        <>
          <Cloud className="wx-cloud" />
          <line className="wx-drop" x1="18" y1="36" x2="16.5" y2="42" />
          <line className="wx-drop d2" x1="25" y1="36" x2="23.5" y2="42" />
          <line className="wx-drop d3" x1="32" y1="36" x2="30.5" y2="42" />
        </>
      )}
      {kind === "storm" && (
        <>
          <Cloud />
          <polyline className="wx-bolt" points="25,33 20,40 24,40 21,46" />
        </>
      )}
    </svg>
  );
}
