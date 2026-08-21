import { AtlasProfile } from "./atlasProfile";
import { join, readFile, writeFile, fileExists, ensureDir } from "./vault";

/** Capacities-style object types, mapped onto plain markdown folders.
 *  A type is just: a folder, a frontmatter `type:` value, and a property
 *  schema. Obsidian sees ordinary notes; Atlas sees typed objects. */

export type PropKind = "text" | "number" | "date" | "select" | "tags" | "url" | "link";

export interface PropDef {
  key: string;            // frontmatter key
  label: string;
  kind: PropKind;
  options?: string[];     // for select
}

export interface ObjectTypeDef {
  key: string;            // frontmatter `type:` value, e.g. "task"
  name: string;
  plural: string;
  icon: string;           // single glyph — Swiss restraint, no emoji noise
  color: string;          // accent hex, used at low intensity
  folder: string;         // vault-relative folder where new objects land
  props: PropDef[];
  special?: "daily" | "task" | "tag";  // built-in behavior (calendar / kanban / tag index)
  custom?: boolean;
}

const rel = (profile: AtlasProfile, abs: string) =>
  abs.startsWith(profile.root + "/") ? abs.slice(profile.root.length + 1) : abs;

export function builtinTypes(profile: AtlasProfile): ObjectTypeDef[] {
  const a = profile.isAtlas;
  return [
    {
      key: "daily", name: "Daily Note", plural: "Daily Notes", icon: "◷", color: "#6f5bb5",
      folder: rel(profile, profile.capture), special: "daily",
      props: [{ key: "tags", label: "Tags", kind: "tags" }],
    },
    {
      key: "note", name: "Page", plural: "Pages", icon: "¶", color: "#4a6fa5",
      folder: a ? "02-Library/Notes" : "Pages",
      props: [
        { key: "status", label: "Status", kind: "select", options: ["captured", "approved", "evergreen"] },
        { key: "summary", label: "Summary", kind: "text" },
        { key: "tags", label: "Tags", kind: "tags" },
      ],
    },
    {
      key: "task", name: "Task", plural: "Tasks", icon: "☑", color: "#ff4400",
      folder: rel(profile, profile.lanes.week), special: "task",
      props: [
        { key: "status", label: "Status", kind: "select", options: ["today", "week", "waiting", "someday", "done"] },
        { key: "project", label: "Project", kind: "link" },
        { key: "due", label: "Due", kind: "date" },
        { key: "priority", label: "Priority", kind: "select", options: ["high", "medium", "low"] },
      ],
    },
    {
      key: "project", name: "Project", plural: "Projects", icon: "▣", color: "#2e7d4f",
      folder: rel(profile, profile.projectsActive),
      props: [
        { key: "status", label: "Status", kind: "select", options: ["active", "paused", "done"] },
        { key: "due", label: "Due", kind: "date" },
        { key: "tags", label: "Tags", kind: "tags" },
      ],
    },
    {
      key: "meeting", name: "Meeting", plural: "Meetings", icon: "◉", color: "#b3590a",
      folder: a ? "02-Library/Meetings" : "Meetings",
      props: [
        { key: "date", label: "Date", kind: "date" },
        { key: "attendees", label: "Attendees", kind: "tags" },
        { key: "project", label: "Project", kind: "link" },
        { key: "tags", label: "Tags", kind: "tags" },
      ],
    },
    {
      key: "person", name: "Person", plural: "People", icon: "○", color: "#8a5a44",
      folder: rel(profile, profile.people),
      props: [
        { key: "role", label: "Role", kind: "text" },
        { key: "org", label: "Organization", kind: "link" },
        { key: "email", label: "Email", kind: "text" },
        { key: "tags", label: "Tags", kind: "tags" },
      ],
    },
    {
      key: "org", name: "Organization", plural: "Organizations", icon: "◫", color: "#5a5a8a",
      folder: a ? "04-Relationships/02-Organizations" : "Organizations",
      props: [
        { key: "website", label: "Website", kind: "url" },
        { key: "location", label: "Location", kind: "text" },
        { key: "tags", label: "Tags", kind: "tags" },
      ],
    },
    {
      key: "place", name: "Place", plural: "Places", icon: "◬", color: "#3a7ca5",
      folder: rel(profile, profile.places),
      props: [
        { key: "location", label: "Location", kind: "text" },
        { key: "coordinates", label: "Coordinates", kind: "text" },
        { key: "tags", label: "Tags", kind: "tags" },
      ],
    },
    {
      key: "weblink", name: "Weblink", plural: "Weblinks", icon: "⌁", color: "#467fcf",
      folder: a ? "02-Library/Weblinks" : "Weblinks",
      props: [
        { key: "url", label: "URL", kind: "url" },
        { key: "site", label: "Site", kind: "text" },
        { key: "description", label: "Description", kind: "text" },
        { key: "tags", label: "Tags", kind: "tags" },
      ],
    },
    {
      key: "workout", name: "Workout", plural: "Workouts", icon: "↯", color: "#b3443f",
      folder: a ? "02-Library/Health/Workouts" : "Health/Workouts",
      props: [
        { key: "date", label: "Date", kind: "date" },
        { key: "workout_type", label: "Type", kind: "text" },
        { key: "duration", label: "Minutes", kind: "number" },
        { key: "energy", label: "Energy (kcal)", kind: "number" },
        { key: "heart_rate", label: "Heart rate", kind: "text" },
        { key: "tags", label: "Tags", kind: "tags" },
      ],
    },
    {
      key: "meal", name: "Meal", plural: "Meals", icon: "◐", color: "#7a8a3a",
      folder: a ? "02-Library/Health/Meals" : "Health/Meals",
      props: [
        { key: "date", label: "Date", kind: "date" },
        { key: "meal", label: "Meal", kind: "select", options: ["breakfast", "lunch", "dinner", "snack"] },
        { key: "calories", label: "Calories", kind: "number" },
        { key: "protein", label: "Protein (g)", kind: "number" },
        { key: "carbs", label: "Carbs (g)", kind: "number" },
        { key: "fat", label: "Fat (g)", kind: "number" },
        { key: "tags", label: "Tags", kind: "tags" },
      ],
    },
    {
      key: "habit", name: "Habit", plural: "Habits", icon: "◎", color: "#2e7d4f",
      folder: a ? "02-Library/Habits" : "Habits",
      props: [
        { key: "kind", label: "Kind", kind: "select", options: ["check", "timer"] },
        { key: "minutes", label: "Minutes", kind: "number" },
        { key: "order", label: "Order", kind: "number" },
      ],
    },
    {
      key: "tag", name: "Tag", plural: "Tags", icon: "#", color: "#8a8a84",
      folder: a ? "00-System/Tags" : "Tags", special: "tag",
      props: [],
    },
  ];
}

/** Custom types ride with the vault in .atlas/types.json so every machine
 *  (and future Atlas install) sees the same schema. Obsidian ignores it. */
const TYPES_FILE = ".atlas/types.json";

export async function loadCustomTypes(profile: AtlasProfile): Promise<ObjectTypeDef[]> {
  const path = join(profile.root, TYPES_FILE);
  if (!(await fileExists(path))) return [];
  try {
    const parsed = JSON.parse(await readFile(path)) as ObjectTypeDef[];
    return parsed.filter((t) => t.key && t.folder).map((t) => ({ ...t, custom: true }));
  } catch {
    return [];
  }
}

export async function saveCustomTypes(profile: AtlasProfile, types: ObjectTypeDef[]): Promise<void> {
  await ensureDir(join(profile.root, ".atlas"));
  await writeFile(join(profile.root, TYPES_FILE), JSON.stringify(types, null, 2));
}

export async function loadAllTypes(profile: AtlasProfile): Promise<ObjectTypeDef[]> {
  const builtin = builtinTypes(profile);
  const custom = await loadCustomTypes(profile);
  const taken = new Set(builtin.map((t) => t.key));
  return [...builtin, ...custom.filter((t) => !taken.has(t.key))];
}

export const typeByKey = (types: ObjectTypeDef[], key: string | undefined) =>
  types.find((t) => t.key === key);

/** Longest-folder-prefix match: a file in 05-Tasks/01-Today is a task even
 *  without a `type:` line. */
export function typeForPath(types: ObjectTypeDef[], relPath: string): ObjectTypeDef | undefined {
  let best: ObjectTypeDef | undefined;
  for (const t of types) {
    const prefix = t.folder.replace(/\/$/, "") + "/";
    // Tasks live in lane subfolders next to the default lane folder
    const taskRoot = t.special === "task" ? prefix.split("/")[0] + "/" : null;
    if (relPath.startsWith(prefix) || (taskRoot && relPath.startsWith(taskRoot))) {
      if (!best || t.folder.length > best.folder.length) best = t;
    }
  }
  return best;
}
