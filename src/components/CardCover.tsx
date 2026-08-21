import { useState } from "react";
import { coverSrc } from "../lib/unfurl";
import { ObjectTypeDef } from "../lib/objectTypes";
import { initialsOf } from "../lib/relations";
import Icon, { hasTypeIcon } from "./Icon";

/** Every object card gets a visual top: the object's photo when it has one,
 *  otherwise a quiet gradient tinted by the type colour with the type glyph
 *  as a watermark. Deterministic per title so a wall of cards has rhythm. */

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export default function CardCover(props: {
  vaultRoot: string;
  image?: unknown;
  type?: ObjectTypeDef;
  title: string;
  favicon?: unknown;
}) {
  const [broken, setBroken] = useState(false);
  const src = coverSrc(props.vaultRoot, props.image);
  const color = (props.type?.color || "").trim() || "var(--ink-3)";   // empty string → fallback
  if (src && !broken) {
    return (
      <span className="obj-card-cover">
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
      </span>
    );
  }
  const angle = (hash(props.title) % 4) * 38 + 110;
  const bg = `linear-gradient(${angle}deg, color-mix(in srgb, ${color} 22%, var(--bg-raise)), color-mix(in srgb, ${color} 5%, var(--bg-raise)))`;
  // People get a tasteful monogram instead of a generic glyph — Atlas never
  // guesses a real face off the web, but initials keep a wall of people warm.
  // Every other type gets its detailed line icon as a large, crisp watermark.
  const watermark = props.type?.key === "person"
    ? <span className="card-monogram" style={{ color }}>{initialsOf(props.title)}</span>
    : hasTypeIcon(props.type?.key)
      ? <Icon name={props.type!.key} size={56} stroke={1.4} color={color} className="card-svg-glyph" />
      : <span className="card-glyph" style={{ color }}>{props.type?.icon ?? "·"}</span>;
  return (
    <span className="obj-card-cover generated" style={{ background: bg }}>
      {watermark}
    </span>
  );
}
