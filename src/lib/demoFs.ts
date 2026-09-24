import { todayStamp, addDays } from "./daily";

/** Browser demo mode: when Atlas runs outside the Tauri shell (plain vite),
 *  vault.ts and settings.ts route here — an in-memory markdown vault seeded
 *  with believable demo content. Lets the whole UI run in a browser tab. */

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const DEMO_ROOT = "/Demo Vault";

const files = new Map<string, string>();
const dirs = new Set<string>();

const norm = (p: string) => p.replace(/\/+/g, "/").replace(/\/$/, "");
const parentChain = (p: string) => {
  const parts = norm(p).split("/").slice(1, -1);
  let cur = "";
  for (const part of parts) { cur += "/" + part; dirs.add(cur); }
};

function put(path: string, content: string) {
  files.set(norm(path), content);
  parentChain(path);
}

let seeded = false;
export function seedDemo() {
  if (seeded) return;
  seeded = true;
  const today = todayStamp();
  const r = DEMO_ROOT;
  dirs.add(r);

  put(`${r}/00-System/README.md`, "# Demo vault\n");
  put(`${r}/01-Inbox/01-Capture/Daily Technology Brief - ${today}.md`,
    `---\ntype: daily-brief\nstatus: captured\n---\n\n# Daily Technology Brief - ${today}\n\n## AI\n- **Open tools make local workflows easier to own**\n  New releases improve long-running coding and research workflows.\n  *Why it matters:* Useful automation can stay close to the files it serves.\n\n- **Local-first apps have a moment**\n  Markdown vaults and portable data formats are receiving renewed attention.\n  *Why it matters:* Your files can outlive a subscription.\n`);
  put(`${r}/01-Inbox/01-Capture/River City Local News Edition - ${today}.md`,
    `---\ntype: local-news\nstatus: captured\n---\n\n# River City Local News Edition - ${today}\n\nSaturday · Local Time\n\n## Lead\n\n### Library opens a new neighborhood workshop\n\nThe fictional River City library added reservable tools and evening classes for residents.\n\n## Weather\n\nClouds in the morning with clearing expected after lunch.\n\n- Central district: cloudy, then brighter\n- Forecast marker: 18 C\n\n## Local Briefs\n\n### Weekend market expands its maker section\n\nMore tables are being reserved for local crafts and repair demonstrations.\n`);
  put(`${r}/.atlas/local-news/current.json`, JSON.stringify({
    schemaVersion: 1,
    date: today,
    edition: "morning",
    name: "River City Dispatch",
    location: "River City",
    generatedAt: new Date().toISOString(),
    headline: "Library workshop puts useful tools within reach",
    dek: "A practical morning edition on neighborhood services, transit, and the weekend ahead. Every item opens its original source.",
    weather: {
      location: "River City",
      current: { tempC: 18, tempF: 64, feelsC: 18, feelsF: 64, humidity: 62, windKph: 8, label: "Partly cloudy", emoji: "Clouds" },
      today: { hiC: 23, loC: 15, hiF: 73, loF: 59, label: "Mostly clear", emoji: "Sun", precipPct: 20 },
    },
    sections: [
      { title: "Civic", items: [{ section: "Civic", title: "Library opens a neighborhood workshop", summary: "Residents can now reserve tools and join evening repair classes at the central branch.", source: "River City Library", url: "https://example.com/library-workshop", date: today, image: "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=900" }] },
      { title: "Weather & Transport", items: [{ section: "Weather & Transport", title: "Weekend bus service adds market stops", summary: "Two temporary stops will shorten the walk to the expanded makers market on Saturday.", source: "River City Transit", url: "https://example.com/market-transit", date: today, image: "https://images.unsplash.com/photo-1494522358652-f30e61a60313?w=900" }] },
      { title: "Culture & Community", items: [{ section: "Culture & Community", title: "Makers market expands its repair program", summary: "Local craftspeople will offer demonstrations and small-item repair consultations throughout the day.", source: "River City Market", url: "https://example.com/makers-market", date: today, image: "https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=900" }] },
    ],
    events: [{ section: "Calendar", title: "Community photo walk", summary: "A guided documentary photo walk starts at the old station Saturday morning.", source: "River City Arts", url: "https://example.com/photo-walk", date: today, time: "09:00" }],
    notes: [],
    markdownPath: `${r}/02-Library/Local News/river-city-dispatch-morning-${today}.md`,
  }, null, 2));
  put(`${r}/01-Inbox/01-Capture/${today}.md`,
    `# Daily Capture — ${today}\n\n## Morning Review (08:10)\n\nTop three for today:\n1. Ship the object browser\n2. Walk the [[Eastbank Esplanade]]\n3. Call [[Jordan Lee]]\n\n## Habits\n- [x] Gratitude\n- [ ] Journal\n- [x] Meditate — 15m\n- [ ] Exercise\n- [x] Morning Walk\n- [ ] Afternoon Walk\n`);
  for (let i = 1; i <= 6; i++) {
    const d = addDays(today, -i);
    const all = i % 3 !== 0;
    put(`${r}/01-Inbox/01-Capture/${d}.md`,
      `# Daily Capture — ${d}\n\n## Habits\n- [x] Gratitude\n- [${all ? "x" : " "}] Journal\n- [x] Meditate — ${10 + i}m\n- [${i % 2 ? "x" : " "}] Exercise — 30m\n- [x] Morning Walk\n- [${all ? "x" : " "}] Afternoon Walk\n`);
  }
  const HABITS: [string, string, number][] = [
    ["Gratitude", "check", 15], ["Journal", "check", 15], ["Meditate", "timer", 15],
    ["Exercise", "timer", 30], ["Morning Walk", "check", 15], ["Afternoon Walk", "check", 15],
  ];
  HABITS.forEach(([name, kind, minutes], i) => {
    put(`${r}/02-Library/Habits/${name}.md`,
      `---\ntype: habit\ntitle: ${name}\nkind: ${kind}\nminutes: ${minutes}\norder: ${i + 1}\ncreated: 2026-05-01\nupdated: ${today}\n---\n\n# ${name}\n`);
  });
  const workouts: [number, string, number, number, string][] = [
    [0, "Core Training", 10, 62, "102-129"], [1, "Walking", 32, 148, "98-117"],
    [3, "Core Training", 12, 71, "104-133"], [4, "Walking", 28, 130, "95-112"], [6, "Strength", 24, 156, "110-141"],
  ];
  for (const [back, wtype, mins, kcal, hr] of workouts) {
    const d = addDays(today, -back);
    put(`${r}/02-Library/Health/Workouts/${wtype} — ${d}.md`,
      `---\ntype: workout\ntitle: ${wtype} — ${d}\ndate: ${d}\nworkout_type: ${wtype}\nduration: ${mins}\nenergy: ${kcal}\nheart_rate: ${hr}\nsource: screenshot\ncreated: ${d}\nupdated: ${d}\n---\n\n# ${wtype} — ${d}\n\n## Exercises\n- Bird Dogs — 9×\n- Jumping Jacks — 8×\n- Squats — 14×\n- Plank — 15sec\n- Glute Bridges — 8×\n`);
  }
  const mealsSeed: [number, string, number, number, number, number, string][] = [
    [0, "breakfast", 420, 28, 44, 14, "Eggs & toast — 320 kcal\nOrange juice — 100 kcal"],
    [0, "lunch", 640, 42, 58, 22, "Chicken bowl — 520 kcal\nApple — 120 kcal"],
    [1, "dinner", 710, 38, 70, 26, "Vegetable noodle bowl — 590 kcal\nCucumber salad — 120 kcal"],
  ];
  const mealPhoto: Record<string, string> = {
    breakfast: "https://images.unsplash.com/photo-1525351484163-7529414344d8?w=640",
    lunch: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=640",
    dinner: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=640",
  };
  const mealInsight: Record<string, string> = {
    breakfast: "A balanced start at 420 kcal with solid protein — right in line with your recent mornings. Carbs lean on the orange juice; swapping to whole fruit would steady the curve.",
    lunch: "This lunch is protein-forward at 42 g, your highest midday protein this week — good fuel on a training day. Calories sit a touch above your lunch average, balanced by the lighter dinners you've logged.",
    dinner: "A comforting noodle dinner, carb-heavier than the last two but still within the recent range. Pairing it with a crisp salad keeps fibre up and the plate satisfying.",
  };
  for (const [back, mealName, cal, prot, carbs, fat, items] of mealsSeed) {
    const d = addDays(today, -back);
    const title = `${mealName[0].toUpperCase()}${mealName.slice(1)} — ${d}`;
    const summary = `${cal} kcal · ${prot}g protein · ${carbs}g carbs · ${fat}g fat`;
    put(`${r}/02-Library/Health/Meals/${title}.md`,
      `---\ntype: meal\ntitle: ${title}\ndate: ${d}\nmeal: ${mealName}\nimage: ${mealPhoto[mealName]}\ncalories: ${cal}\nprotein: ${prot}\ncarbs: ${carbs}\nfat: ${fat}\nsummary: "${summary}"\nsource: screenshot\ncreated: ${d}\nupdated: ${d}\n---\n\n# ${title}\n\n![${mealName} photo](${mealPhoto[mealName]})\n\n## Items\n${items.split("\n").map((i) => `- ${i}`).join("\n")}\n\n## Insights\n${mealInsight[mealName]}\n`);
  }
  const w = [83.6, 83.4, 83.5, 83.1, 82.9, 83.0, 82.6, 82.4];
  put(`${r}/02-Library/Health/Weight.md`,
    `---\ntype: metric\ntitle: Weight\ncreated: ${addDays(today, -14)}\n---\n\n# Weight\n\n` +
    w.map((v, i) => `- ${addDays(today, i * 2 - 14)} 07:0${i % 10} — ${v} kg`).join("\n") + "\n");
  const bp = [[128, 84, 64], [126, 82, 66], [124, 80, 62], [125, 81, 63], [122, 79, 61], [121, 78, 60]];
  put(`${r}/02-Library/Health/Blood Pressure.md`,
    `---\ntype: metric\ntitle: Blood Pressure\ncreated: ${addDays(today, -10)}\n---\n\n# Blood Pressure\n\n` +
    bp.map((v, i) => `- ${addDays(today, i * 2 - 10)} 07:1${i} — ${v[0]}/${v[1]} · ${v[2]} bpm`).join("\n") + "\n");
  put(`${r}/02-Library/Notes/How to build a second brain.md`,
    `---\ntype: note\ntitle: How to build a second brain\nstatus: approved\ncreated: ${today}\nupdated: ${today}\ntags:\n  - pkm\n  - reading\nsummary: "Objects, not folders."\n---\n\n# How to build a second brain\n\nLink anything to anything — see [[Atlas Rebuild]] and [[Jordan Lee]].\n`);
  put(`${r}/02-Library/Places/Eastbank Esplanade.md`,
    `---\ntype: place\ntitle: Eastbank Esplanade\nlocation: Portland, Oregon\ncoordinates: 45.515500,-122.665000\nimage: https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=640\ncreated: 2026-05-01\nupdated: ${today}\ntags:\n  - demo\n---\n\n# Eastbank Esplanade\n\n## About\nA public riverside path used here as neutral demo content for place objects and maps.\n\n## Location\n- [Open in Apple Maps](https://maps.apple.com/?ll=45.5155,-122.6650&q=Eastbank%20Esplanade)\n- [Open in Google Maps](https://www.google.com/maps/search/?api=1&query=45.5155,-122.6650)\n\nCoordinates: 45.515500,-122.665000\n`);
  put(`${r}/02-Library/Meetings/Kickoff — Atlas Rebuild.md`,
    `---\ntype: meeting\ntitle: Kickoff — Atlas Rebuild\ndate: ${today}\ncreated: ${today}\nupdated: ${today}\nattendees:\n  - Jordan Lee\nproject: "[[Atlas Rebuild]]"\ntags:\n  - atlas\n---\n\n# Kickoff — Atlas Rebuild\n\nDecisions: objects, not folders. Files stay markdown.\n\n## Summary & actions\n\nKicked off the object-based rebuild.\n\n**Action items**\n- [ ] Draft the object-type schema\n- [ ] Wire up the calendar view\n- [ ] Ship a demo vault\n`);
  put(`${r}/02-Library/Weblinks/Capacities.md`,
    `---\ntype: weblink\ntitle: Capacities\nurl: https://capacities.io\nsite: capacities.io\ndescription: "A studio for your mind. Capacities turns your ideas into connected objects, not files buried in folders."\nimage: https://picsum.photos/seed/capacities/640/360\nfavicon: https://www.google.com/s2/favicons?domain=capacities.io&sz=64\ncreated: 2026-06-01\nupdated: ${today}\ntags:\n  - pkm\n---\n\n# Capacities\n\nA studio for your mind.\n`);
  put(`${r}/02-Library/Weblinks/Morning Mobility Routine.md`,
    `---\ntype: weblink\ntitle: Morning Mobility Routine — 10 Minutes\nurl: https://www.youtube.com/watch?v=RwsUnvHYmyw\nsite: youtube.com\ndescription: "YouTube · Movement Lab"\nimage: https://i.ytimg.com/vi/RwsUnvHYmyw/maxresdefault.jpg\nfavicon: https://www.google.com/s2/favicons?domain=youtube.com&sz=64\nsummary: "A compact 10-minute morning mobility flow covering the spine, hips, and shoulders, designed to be done daily before coffee."\ncreated: ${today}\nupdated: ${today}\ntags:\n  - exercise\n---\n\n## Summary\n\nA compact 10-minute morning mobility flow covering the spine, hips, and shoulders. The coach emphasizes moving slowly through end ranges and breathing through each hold, making it sustainable as a daily pre-coffee habit.\n\n## Steps\n\n1. Cat-cow — 10 slow reps\n2. World's greatest stretch — 5 per side\n3. Deep squat hold — 60 seconds\n4. Hip 90/90 switches — 8 per side\n5. Shoulder CARs — 5 per direction\n6. Standing forward fold — 60 seconds\n`);
  put(`${r}/02-Library/Weblinks/Obsidian.md`,
    `---\ntype: weblink\ntitle: Obsidian\nurl: https://obsidian.md\ncreated: 2026-06-05\nupdated: ${today}\ntags:\n  - pkm\n---\n\n# Obsidian\n\nSharpen your thinking.\n`);
  put(`${r}/03-Projects/01-Active/Atlas Rebuild.md`,
    `---\ntype: project\ntitle: Atlas Rebuild\nstatus: active\ndue: 2026-06-30\ncreated: 2026-06-10\nupdated: ${today}\ntags:\n  - atlas\n---\n\n# Atlas Rebuild\n\nTurn Atlas into a Capacities-style object studio over plain markdown.\n`);
  put(`${r}/04-Relationships/01-People/Jordan Lee.md`,
    `---\ntype: person\ntitle: Jordan Lee\nrole: Designer\nemail: jordan.lee@example.com\ncreated: 2026-04-12\nupdated: ${today}\ntags:\n  - collaborator\n  - demo\n---\n\n# Jordan Lee\n\nWorks on [[Atlas Rebuild]].\n`);
  put(`${r}/05-Tasks/01-Today/Ship the Capacities rebuild.md`,
    `---\ntype: task\ntitle: Ship the Capacities rebuild\nstatus: today\nproject: "[[Atlas Rebuild]]"\ndue: ${today}\npriority: high\ntop: 1\nupdated: ${today}\n---\n\nObject types, calendar, search.\n`);
  put(`${r}/05-Tasks/02-This-Week/Write the weekly brief.md`,
    `---\ntype: task\ntitle: Write the weekly brief\nstatus: week\npriority: medium\nupdated: ${today}\n---\n`);
  put(`${r}/05-Tasks/03-Waiting/Hear back from print shop.md`,
    `---\ntype: task\ntitle: Hear back from print shop\nstatus: waiting\nupdated: ${today}\n---\n`);
  // A few more tasks linked to Atlas Rebuild so the project shows real progress.
  put(`${r}/05-Tasks/02-This-Week/Ship a demo vault.md`,
    `---\ntype: task\ntitle: Ship a demo vault\nstatus: week\nproject: "[[Atlas Rebuild]]"\npriority: medium\nupdated: ${today}\n---\n`);
  put(`${r}/05-Tasks/06-Done/Draft the object-type schema.md`,
    `---\ntype: task\ntitle: Draft the object-type schema\nstatus: done\nproject: "[[Atlas Rebuild]]"\ncreated: ${addDays(today, -3)}\nupdated: ${addDays(today, -1)}\n---\n`);
  put(`${r}/05-Tasks/06-Done/Wire up the calendar view.md`,
    `---\ntype: task\ntitle: Wire up the calendar view\nstatus: done\nproject: "[[Atlas Rebuild]]"\ncreated: ${addDays(today, -2)}\nupdated: ${today}\n---\n`);
  for (const lane of ["04-Someday", "05-Routines"]) dirs.add(`${r}/05-Tasks/${lane}`);
  dirs.add(`${r}/01-Inbox/02-Review`);
}

export const demoFs = {
  async readTextFile(path: string): Promise<string> {
    const c = files.get(norm(path));
    if (c === undefined) throw new Error(`demoFs: no such file ${path}`);
    return c;
  },
  async writeTextFile(path: string, content: string): Promise<void> {
    put(path, content);
  },
  async exists(path: string): Promise<boolean> {
    const p = norm(path);
    if (files.has(p) || dirs.has(p)) return true;
    for (const k of files.keys()) if (k.startsWith(p + "/")) return true;
    return false;
  },
  async mkdir(path: string): Promise<void> {
    dirs.add(norm(path));
    parentChain(norm(path) + "/x");
  },
  async rename(from: string, to: string): Promise<void> {
    const f = norm(from);
    const c = files.get(f);
    if (c === undefined) throw new Error(`demoFs: no such file ${from}`);
    files.delete(f);
    put(to, c);
  },
  async readDir(root: string): Promise<{ name: string; isDirectory: boolean }[]> {
    const p = norm(root);
    const out = new Map<string, boolean>();
    for (const k of [...files.keys(), ...dirs]) {
      if (!k.startsWith(p + "/")) continue;
      const rest = k.slice(p.length + 1);
      const name = rest.split("/")[0];
      const isDir = rest.includes("/") || dirs.has(p + "/" + name);
      if (!out.has(name) || isDir) out.set(name, isDir);
    }
    return [...out.entries()].map(([name, isDirectory]) => ({ name, isDirectory }));
  },
};

/** localStorage-backed stand-in for the Tauri settings store. */
export const demoStore = {
  get<T>(key: string): T | undefined {
    try {
      const raw = localStorage.getItem(`atlas-demo:${key}`);
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch { return undefined; }
  },
  set(key: string, value: unknown) {
    localStorage.setItem(`atlas-demo:${key}`, JSON.stringify(value));
  },
};
