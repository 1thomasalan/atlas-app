import { AtlasProfile } from "./atlasProfile";
import { ObjectTypeDef, typeByKey } from "./objectTypes";
import { createObject } from "./objects";
import { join, ensureDir, fileExists, writeBinaryFile } from "./vault";
import { inTauri } from "./demoFs";
import { Coords, formatCoords, mapLinksMarkdown } from "./geo";
import { PickedImage, aiPlaceProfile } from "./vision";
import { searchPhoto, savePhotoFromUrl, attachmentsFor } from "./photos";

/** Builds a Place object: optional photo cover, coordinates, deterministic
 *  map links, and — when a key is set — a short AI-written profile. Shared by
 *  the standalone "New place from photo" flow and the import location-linker. */

export interface NewPlaceInput {
  name: string;
  coords?: Coords | null;
  locationText?: string;       // freeform "Portland, Oregon" when no GPS
  image?: PickedImage;         // a photo OF the place → becomes the cover
  openaiKey?: string;
}

export async function createPlaceObject(
  profile: AtlasProfile,
  types: ObjectTypeDef[],
  input: NewPlaceInput,
): Promise<string> {
  const placeType = typeByKey(types, "place")!;
  const attachRel = `${placeType.folder}/Attachments`;

  // Save the place photo (if any) as the cover.
  let coverVaultRel: string | undefined;
  let coverNoteRel: string | undefined;
  if (inTauri && input.image) {
    const dir = join(profile.root, attachRel);
    await ensureDir(dir);
    const ext = input.image.mime.includes("png") ? "png" : "jpg";
    let name = `place-${slug(input.name) || "photo"}.${ext}`;
    if (await fileExists(join(dir, name))) name = `place-${slug(input.name) || "photo"}-${Date.now() % 10000}.${ext}`;
    const bin = atob(input.image.b64);
    const bytes = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
    await writeBinaryFile(join(dir, name), bytes);
    coverVaultRel = `${attachRel}/${name}`;
    coverNoteRel = `../Attachments/${name}`;
  }

  // No photo supplied → try to grab one from the internet (places especially).
  if (!coverVaultRel) {
    const q = [input.name, input.locationText].filter(Boolean).join(" ");
    const found = await searchPhoto(q);
    if (found) {
      const saved = await savePhotoFromUrl(profile, attachmentsFor(placeType.folder), input.name, found);
      coverVaultRel = saved;
      if (saved.startsWith(attachRel)) coverNoteRel = `../Attachments/${saved.split("/").pop()}`;
    }
  }

  // Optional AI profile — never block creation on it.
  let profileSummary = "";
  let highlights: string[] = [];
  if (input.openaiKey) {
    try {
      const p = await aiPlaceProfile(input.openaiKey, input.name, input.coords ?? null, input.image);
      profileSummary = p.summary;
      highlights = p.highlights;
    } catch { /* keep the deterministic parts */ }
  }

  const fm: Record<string, string> = {};
  if (coverVaultRel) fm.image = coverVaultRel;
  if (input.locationText?.trim()) fm.location = input.locationText.trim();
  if (input.coords) fm.coordinates = formatCoords(input.coords);

  const body = [
    `# ${input.name}`, "",
    coverNoteRel ? `![${input.name}](${coverNoteRel})` : "",
    profileSummary ? `## About\n${profileSummary}` : "",
    highlights.length ? `## Highlights\n${highlights.map((h) => `- ${h}`).join("\n")}` : "",
    input.coords ? `## Location\n${mapLinksMarkdown(input.coords, input.name)}\n\nCoordinates: ${formatCoords(input.coords)}` : "",
    input.openaiKey && profileSummary ? `\n*Profile drafted by AI — verify specifics.*` : "",
  ].filter(Boolean).join("\n\n");

  return createObject(profile, placeType, input.name, fm, body);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
