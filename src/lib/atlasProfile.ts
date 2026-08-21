import { fileExists, join, ensureDir } from "./vault";

/** Auto-detects the Atlas folder convention and lights up the right widgets.
 *  Falls back to a generic profile for any plain markdown folder. */
export interface AtlasProfile {
  isAtlas: boolean;
  root: string;
  capture: string;       // daily notes + dropped briefs
  review: string;
  lanes: { today: string; week: string; waiting: string; someday: string; done: string };
  routines: string;
  projectsActive: string;
  people: string;
  places: string;
  library: string;
}

export async function detectProfile(root: string): Promise<AtlasProfile> {
  const isAtlas =
    (await fileExists(join(root, "00-System"))) &&
    (await fileExists(join(root, "05-Tasks")));

  if (isAtlas) {
    const p: AtlasProfile = {
      isAtlas: true,
      root,
      capture: join(root, "01-Inbox/01-Capture"),
      review: join(root, "01-Inbox/02-Review"),
      lanes: {
        today:   join(root, "05-Tasks/01-Today"),
        week:    join(root, "05-Tasks/02-This-Week"),
        waiting: join(root, "05-Tasks/03-Waiting"),
        someday: join(root, "05-Tasks/04-Someday"),
        done:    join(root, "05-Tasks/06-Done"),
      },
      routines: join(root, "05-Tasks/05-Routines"),
      projectsActive: join(root, "03-Projects/01-Active"),
      people: join(root, "04-Relationships/01-People"),
      places: join(root, "02-Library/Places"),
      library: join(root, "02-Library"),
    };
    await ensureDir(p.lanes.done); // the one structural addition Atlas makes
    return p;
  }

  // Generic profile: create a light structure inside any folder
  const p: AtlasProfile = {
    isAtlas: false,
    root,
    capture: join(root, "Inbox"),
    review: join(root, "Inbox"),
    lanes: {
      today:   join(root, "Tasks/Today"),
      week:    join(root, "Tasks/This-Week"),
      waiting: join(root, "Tasks/Waiting"),
      someday: join(root, "Tasks/Someday"),
      done:    join(root, "Tasks/Done"),
    },
    routines: join(root, "Tasks/Routines"),
    projectsActive: join(root, "Projects"),
    people: join(root, "People"),
    places: join(root, "Places"),
    library: root,
  };
  for (const dir of [p.capture, ...Object.values(p.lanes)]) await ensureDir(dir);
  return p;
}

export type LaneKey = keyof AtlasProfile["lanes"];
export const LANE_LABELS: Record<LaneKey, string> = {
  today: "Today", week: "This Week", waiting: "Waiting", someday: "Someday", done: "Done",
};
