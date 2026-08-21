import { AtlasProfile } from "./atlasProfile";
import { logChange } from "./changeLog";
import { todayStamp } from "./daily";
import { ensureDir, fileExists, join, writeFile } from "./vault";

export interface ObjectStudioRequest {
  name: string;
  tracks: string;
  processing: string;
  goal: string;
  preferredProcessor: "codex" | "agent-zero";
}

const safeName = (value: string) => value
  .replace(/[\\/:*?"<>|]/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 80) || "Custom Object";

async function uniquePath(dir: string, stem: string): Promise<string> {
  let candidate = join(dir, `${stem}.md`);
  let suffix = 2;
  while (await fileExists(candidate)) {
    candidate = join(dir, `${stem} ${suffix}.md`);
    suffix += 1;
  }
  return candidate;
}

export async function createObjectStudioRequest(
  profile: AtlasProfile,
  request: ObjectStudioRequest,
): Promise<string> {
  const name = safeName(request.name);
  const date = todayStamp();
  await ensureDir(profile.capture);
  const path = await uniquePath(profile.capture, `${date} - Custom Object Request - ${name}`);
  const processor = request.preferredProcessor === "agent-zero" ? "Agent Zero" : "Codex local";
  const markdown = `---
title: ${JSON.stringify(`Custom Object Request - ${name}`)}
type: capture
status: captured
created: ${date}
updated: ${date}
tags:
  - atlas-request
  - custom-object-request
summary: Define and review a new Atlas object type.
---

# Custom Object Request - ${name}

## Object Name

${name}

## What It Tracks

${request.tracks.trim()}

## Processing Behavior

${request.processing.trim()}

## Ultimate Goal

${request.goal.trim()}

## Preferred Setup Processor

${processor}

## Processing Instructions

Propose an object definition, folder, frontmatter schema, template, and processing rules. Save the proposal to Review with a Quick Approval block. Do not modify the durable object registry, templates, or processing rules until the proposal is approved.
`;
  await writeFile(path, markdown);
  await logChange(
    profile,
    [path],
    `Created a custom object setup request for ${name} from Object Studio.`,
    "user-requested-object-studio",
  );
  return path;
}
