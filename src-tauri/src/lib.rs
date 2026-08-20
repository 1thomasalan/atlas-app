use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const TASK_DIRS: &[(&str, &str)] = &[
    ("today", "05-Tasks/01-Today"),
    ("this-week", "05-Tasks/02-This-Week"),
    ("waiting", "05-Tasks/03-Waiting"),
    ("someday", "05-Tasks/04-Someday"),
    ("routines", "05-Tasks/05-Routines"),
];
const NOTE_WORKSPACE_ROOTS: &[&str] = &["01-Inbox", "02-Library", "03-Projects", "04-Relationships", "05-Tasks"];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    #[serde(default)]
    runtime: String,
    #[serde(default)]
    vault_path: String,
    #[serde(default)]
    theme: String,
}

#[derive(Debug, Clone)]
struct Note {
    file: PathBuf,
    relative_path: String,
    title: String,
    item_type: String,
    status: String,
    summary: String,
    priority: String,
    due: String,
    cadence: String,
    routine_mode: String,
    measurement_kind: String,
    unit: String,
    completed: String,
    updated: String,
    created: String,
    tags: Vec<String>,
    bucket: String,
    mtime: u128,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskInput {
    title: Option<String>,
    bucket: Option<String>,
    priority: Option<String>,
    summary: Option<String>,
}

fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn timestamp() -> String {
    Local::now().format("%Y-%m-%d %H:%M").to_string()
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("settings.json"))
}

fn normalize_settings(mut settings: AppSettings) -> AppSettings {
    settings.runtime = "tauri".to_string();
    if settings.theme.is_empty() {
        settings.theme = "light".to_string();
    }
    settings
}

fn read_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(normalize_settings(AppSettings::default()));
    }
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let settings = serde_json::from_str::<AppSettings>(&text).unwrap_or_default();
    Ok(normalize_settings(settings))
}

fn write_settings(app: &AppHandle, settings: &AppSettings) -> Result<AppSettings, String> {
    let settings = normalize_settings(settings.clone());
    let path = settings_path(app)?;
    let text = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(path, text).map_err(|error| error.to_string())?;
    Ok(settings)
}

fn validate_vault(path: &Path) -> Result<(), String> {
    let required = [
        "00-System/AGENTS.md",
        "01-Inbox",
        "02-Library",
        "03-Projects",
        "04-Relationships",
        "05-Tasks",
    ];
    if !path.is_dir() {
        return Err("Choose a folder, not a file.".to_string());
    }
    for item in required {
        if !path.join(item).exists() {
            return Err("That folder does not look like an Atlas Markdown vault.".to_string());
        }
    }
    Ok(())
}

fn vault_root(app: &AppHandle) -> Result<PathBuf, String> {
    let settings = read_settings(app)?;
    if settings.vault_path.trim().is_empty() {
        return Err("No Atlas vault folder is selected.".to_string());
    }
    let root = PathBuf::from(settings.vault_path);
    validate_vault(&root)?;
    Ok(root)
}

fn walk(dir: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            walk(&path, files);
        } else {
            files.push(path);
        }
    }
}

fn markdown_files(root: &Path, relative_dir: &str) -> Vec<PathBuf> {
    let mut files = Vec::new();
    walk(&root.join(relative_dir), &mut files);
    files
        .into_iter()
        .filter(|file| file.extension().is_some_and(|ext| ext.to_string_lossy() == "md"))
        .collect()
}

fn clean_scalar(value: &str) -> String {
    let value = value.trim();
    if value.len() >= 2 {
        let first = value.as_bytes()[0] as char;
        let last = value.as_bytes()[value.len() - 1] as char;
        if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
            return value[1..value.len() - 1].to_string();
        }
    }
    value.to_string()
}

fn frontmatter(text: &str) -> HashMap<String, Value> {
    let mut result = HashMap::new();
    if !text.starts_with("---\n") {
        return result;
    }
    let Some(end) = text[4..].find("\n---") else {
        return result;
    };
    let mut active_key = String::new();
    for line in text[4..4 + end].lines() {
        let trimmed = line.trim();
        if let Some(item) = trimmed.strip_prefix("- ") {
            if !active_key.is_empty() {
                let entry = result
                    .entry(active_key.clone())
                    .or_insert_with(|| Value::Array(Vec::new()));
                if let Value::Array(items) = entry {
                    items.push(Value::String(clean_scalar(item)));
                }
            }
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        active_key = key.trim().to_string();
        let value = value.trim();
        if value.is_empty() {
            result.insert(active_key.clone(), Value::Array(Vec::new()));
        } else {
            result.insert(active_key.clone(), Value::String(clean_scalar(value)));
        }
    }
    result
}

fn meta_string(meta: &HashMap<String, Value>, key: &str) -> String {
    meta.get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn meta_tags(meta: &HashMap<String, Value>) -> Vec<String> {
    meta.get("tags")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn heading_title(text: &str) -> String {
    text.lines()
        .find_map(|line| line.strip_prefix("# ").map(str::trim))
        .unwrap_or("")
        .to_string()
}

fn read_note(root: &Path, file: &Path, bucket: &str) -> Option<Note> {
    let text = fs::read_to_string(file).ok()?;
    let meta = frontmatter(&text);
    let relative_path = file
        .strip_prefix(root)
        .ok()?
        .to_string_lossy()
        .replace('\\', "/");
    let fallback_title = file.file_stem()?.to_string_lossy().to_string();
    let mtime = fs::metadata(file)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .map(|elapsed| u128::MAX - elapsed.as_millis())
        .unwrap_or(0);
    Some(Note {
        file: file.to_path_buf(),
        relative_path,
        title: first_non_empty(&[meta_string(&meta, "title"), heading_title(&text), fallback_title]),
        item_type: first_non_empty(&[meta_string(&meta, "type"), "note".to_string()]),
        status: first_non_empty(&[meta_string(&meta, "status"), "unknown".to_string()]),
        summary: meta_string(&meta, "summary"),
        priority: meta_string(&meta, "priority"),
        due: meta_string(&meta, "due"),
        cadence: meta_string(&meta, "cadence"),
        routine_mode: meta_string(&meta, "routine_mode"),
        measurement_kind: meta_string(&meta, "measurement_kind"),
        unit: meta_string(&meta, "unit"),
        completed: meta_string(&meta, "completed"),
        updated: meta_string(&meta, "updated"),
        created: meta_string(&meta, "created"),
        tags: meta_tags(&meta),
        bucket: bucket.to_string(),
        mtime,
    })
}

fn first_non_empty(values: &[String]) -> String {
    values
        .iter()
        .find(|value| !value.trim().is_empty())
        .cloned()
        .unwrap_or_default()
}

fn notes_in(root: &Path, relative_dir: &str, bucket: &str) -> Vec<Note> {
    markdown_files(root, relative_dir)
        .into_iter()
        .filter(|file| file.file_name().is_some_and(|name| name.to_string_lossy() != "README.md"))
        .filter_map(|file| read_note(root, &file, bucket))
        .collect()
}

fn public_note(note: &Note) -> Value {
    json!({
        "title": note.title,
        "relativePath": note.relative_path,
        "summary": note.summary,
        "status": note.status,
        "type": note.item_type,
        "priority": note.priority,
        "due": note.due,
        "cadence": note.cadence,
        "routineMode": note.routine_mode,
        "measurementKind": note.measurement_kind,
        "unit": note.unit,
        "completed": note.completed,
        "created": note.created,
        "tags": note.tags,
        "bucket": note.bucket
    })
}

fn section_body(text: &str, title: &str) -> String {
    let heading = format!("## {title}");
    let mut in_section = false;
    let mut lines = Vec::new();
    for line in text.lines() {
        if line.trim() == heading {
            in_section = true;
            continue;
        }
        if in_section && line.starts_with("## ") {
            break;
        }
        if in_section {
            lines.push(line);
        }
    }
    lines.join("\n").trim().to_string()
}

fn parse_checklist(text: &str) -> Vec<Value> {
    let mut index = 0;
    let mut items = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim_start();
        let Some(rest) = trimmed.strip_prefix("- [") else {
            continue;
        };
        let mut chars = rest.chars();
        let Some(mark) = chars.next() else {
            continue;
        };
        if chars.next() != Some(']') {
            continue;
        }
        let text = chars.as_str().trim().to_string();
        if text.is_empty() {
            continue;
        }
        items.push(json!({
            "index": index,
            "done": mark == 'x' || mark == 'X',
            "text": text
        }));
        index += 1;
    }
    items
}

fn task_notes(text: &str) -> Vec<String> {
    let mut notes: Vec<String> = section_body(text, "Notes")
        .lines()
        .filter_map(|line| line.trim().strip_prefix("- ").map(str::trim))
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect();
    notes.reverse();
    notes.truncate(6);
    notes
}

fn public_task(note: &Note) -> Value {
    let text = fs::read_to_string(&note.file).unwrap_or_default();
    let mut value = public_note(note);
    value["checklist"] = Value::Array(parse_checklist(&text));
    value["notes"] = json!(task_notes(&text));
    value
}

fn parse_progress(text: &str) -> Vec<Value> {
    section_body(text, "Progress")
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            let rest = trimmed.strip_prefix("- [")?;
            let done = rest.starts_with('x') || rest.starts_with('X');
            let after_box = rest.get(2..)?.trim();
            let (date, detail) = after_box.split_once(" - ").unwrap_or((after_box, ""));
            if date.len() != 10 {
                return None;
            }
            Some(json!({ "date": date, "done": done, "detail": detail }))
        })
        .collect()
}

fn public_routine(note: &Note) -> Value {
    let text = fs::read_to_string(&note.file).unwrap_or_default();
    let progress = parse_progress(&text);
    let completed = progress
        .iter()
        .filter(|item| item.get("done").and_then(Value::as_bool).unwrap_or(false))
        .count();
    let today = today();
    let today_done = progress.iter().any(|item| {
        item.get("date").and_then(Value::as_str) == Some(today.as_str())
            && item.get("done").and_then(Value::as_bool).unwrap_or(false)
    });
    let mut value = public_note(note);
    value["routineMode"] = json!(if note.routine_mode.is_empty() {
        "check"
    } else {
        note.routine_mode.as_str()
    });
    value["measurementKind"] = json!(if note.measurement_kind.is_empty() {
        "number"
    } else {
        note.measurement_kind.as_str()
    });
    value["progress"] = json!({
        "completed": completed,
        "total": progress.len(),
        "items": progress,
        "todayDone": today_done
    });
    value["recentEntries"] = json!([]);
    value["readings"] = json!([]);
    value
}

fn note_workspace_files(root: &Path) -> Vec<PathBuf> {
    NOTE_WORKSPACE_ROOTS
        .iter()
        .flat_map(|dir| markdown_files(root, dir))
        .filter(|file| file.file_name().is_some_and(|name| name.to_string_lossy() != "README.md"))
        .collect()
}

fn note_section(relative_path: &str) -> String {
    NOTE_WORKSPACE_ROOTS
        .iter()
        .find(|root| relative_path == **root || relative_path.starts_with(&format!("{root}/")))
        .unwrap_or(&"")
        .to_string()
}

fn split_markdown(text: &str) -> (String, String) {
    if !text.starts_with("---\n") {
        return (String::new(), text.trim_start_matches('\n').to_string());
    }
    let Some(end) = text[4..].find("\n---") else {
        return (String::new(), text.trim_start_matches('\n').to_string());
    };
    let marker_end = 4 + end + 4;
    (
        text[..marker_end].trim_end().to_string(),
        text[marker_end..].trim_start_matches('\n').to_string(),
    )
}

fn public_editor_note(note: &Note) -> Value {
    let text = fs::read_to_string(&note.file).unwrap_or_default();
    let (_, body) = split_markdown(&text);
    let preview = body
        .lines()
        .filter(|line| !line.trim_start().starts_with("# "))
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(3)
        .collect::<Vec<_>>()
        .join(" ");
    let mut value = public_note(note);
    value["section"] = json!(note_section(&note.relative_path));
    value["folder"] = json!(
        Path::new(&note.relative_path)
            .parent()
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default()
    );
    value["preview"] = json!(preview.chars().take(220).collect::<String>());
    value["updated"] = json!(note.updated);
    value
}

fn list_editor_notes(root: &Path, query: &str, section: &str) -> Value {
    let query = query.to_lowercase();
    let section = section.to_lowercase();
    let mut notes: Vec<Note> = note_workspace_files(root)
        .into_iter()
        .filter_map(|file| read_note(root, &file, ""))
        .filter(|note| section.is_empty() || note_section(&note.relative_path).to_lowercase() == section)
        .filter(|note| {
            if query.is_empty() {
                return true;
            }
            format!(
                "{} {} {} {}",
                note.title,
                note.summary,
                note.relative_path,
                note.tags.join(" ")
            )
            .to_lowercase()
            .contains(&query)
        })
        .collect();
    notes.sort_by(|a, b| b.mtime.cmp(&a.mtime).then_with(|| a.title.cmp(&b.title)));
    notes.truncate(250);
    json!({ "notes": notes.iter().map(public_editor_note).collect::<Vec<_>>() })
}

fn safe_note_file(root: &Path, relative_path: &str) -> Result<(PathBuf, String), String> {
    let normalized = relative_path.trim().replace('\\', "/");
    if normalized.starts_with('/') || normalized.contains("..") || !normalized.ends_with(".md") {
        return Err("Invalid note path.".to_string());
    }
    if !NOTE_WORKSPACE_ROOTS
        .iter()
        .any(|folder| normalized.starts_with(&format!("{folder}/")))
    {
        return Err("Notes can only be edited inside Atlas working folders.".to_string());
    }
    let file = root.join(&normalized);
    if !file.exists() {
        return Err("Note was not found.".to_string());
    }
    Ok((file, normalized))
}

fn clean_note_body(value: &str) -> Result<String, String> {
    let cleaned = value.replace("\r\n", "\n").replace('\r', "\n");
    if cleaned.len() > 200000 {
        return Err("Note body is too long.".to_string());
    }
    Ok(cleaned)
}

fn read_editor_note(root: &Path, relative_path: &str) -> Result<Value, String> {
    let (file, normalized) = safe_note_file(root, relative_path)?;
    let text = fs::read_to_string(&file).map_err(|error| error.to_string())?;
    let note = read_note(root, &file, "").ok_or_else(|| "Note could not be read.".to_string())?;
    let (frontmatter, body) = split_markdown(&text);
    let mut value = public_editor_note(&note);
    value["relativePath"] = json!(normalized);
    value["frontmatter"] = json!(frontmatter);
    value["body"] = json!(body);
    value["text"] = json!(text);
    Ok(value)
}

fn save_editor_note(root: &Path, payload: Value) -> Result<Value, String> {
    let relative_path = payload
        .get("relativePath")
        .and_then(Value::as_str)
        .ok_or_else(|| "Note path is required.".to_string())?;
    let (file, normalized) = safe_note_file(root, relative_path)?;
    let body = clean_note_body(payload.get("body").and_then(Value::as_str).unwrap_or(""))?;
    let title = payload.get("title").and_then(Value::as_str).unwrap_or("").trim();
    let original = fs::read_to_string(&file).map_err(|error| error.to_string())?;
    let (frontmatter, _) = split_markdown(&original);
    let mut updated = if frontmatter.is_empty() {
        format!("{}\n", body.trim_end())
    } else {
        format!("{}\n\n{}\n", frontmatter, body.trim_end())
    };
    updated = update_frontmatter_scalar(&updated, "updated", &today());
    if !title.is_empty() {
        updated = update_frontmatter_scalar(
            &updated,
            "title",
            &serde_json::to_string(title).map_err(|error| error.to_string())?,
        );
    }
    fs::write(&file, updated).map_err(|error| error.to_string())?;
    append_change_log(
        root,
        &[normalized.clone()],
        "Saved a Markdown note from the Atlas Notes workspace after an explicit user action.",
        "approved",
    )?;
    let mut value = read_editor_note(root, &normalized)?;
    value["message"] = json!("Note saved.");
    Ok(value)
}

fn create_editor_note(root: &Path, payload: Value) -> Result<Value, String> {
    let title = compact_line(
        payload.get("title").and_then(Value::as_str).map(ToString::to_string),
        "Title",
        120,
        true,
    )?;
    let destination = payload
        .get("destination")
        .and_then(Value::as_str)
        .unwrap_or("capture");
    let (dir, status, tag) = match destination {
        "library-notes" => ("02-Library/Notes", "approved", "library-note"),
        _ => ("01-Inbox/01-Capture", "captured", "capture"),
    };
    let body = clean_note_body(payload.get("body").and_then(Value::as_str).unwrap_or(""))?;
    fs::create_dir_all(root.join(dir)).map_err(|error| error.to_string())?;
    let today = today();
    let stem = if destination == "library-notes" {
        safe_filename_stem(&title, "New Atlas Note")
    } else {
        format!("{} - {}", today, safe_filename_stem(&title, "New Atlas Note"))
    };
    let file = unique_path(root, dir, &stem);
    let relative = file
        .strip_prefix(root)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let text = format!(
        "---\ntitle: {}\ntype: note\nstatus: {}\ncreated: {}\nupdated: {}\ntags:\n  - {}\nsummary: \"\"\n---\n\n# {}\n\n{}\n",
        serde_json::to_string(&title).map_err(|error| error.to_string())?,
        status,
        today,
        today,
        tag,
        title,
        body.trim()
    );
    fs::write(&file, text).map_err(|error| error.to_string())?;
    append_change_log(
        root,
        &[relative.clone()],
        &format!("Created a new Markdown note in {dir} from the Atlas Notes workspace."),
        if destination == "library-notes" {
            "approved"
        } else {
            "direct-low-stakes-task"
        },
    )?;
    let mut value = read_editor_note(root, &relative)?;
    value["message"] = json!("Note created.");
    Ok(value)
}

fn project_sections(text: &str) -> Vec<Value> {
    let mut sections = Vec::new();
    let mut current_title = String::new();
    let mut current_body = Vec::new();
    for line in text.lines() {
        if let Some(title) = line.strip_prefix("## ") {
            if !current_title.is_empty() && !current_body.join("\n").trim().is_empty() {
                sections.push(json!({
                    "title": current_title,
                    "body": current_body.join("\n").trim()
                }));
            }
            current_title = title.trim().to_string();
            current_body.clear();
        } else if !current_title.is_empty() {
            current_body.push(line.to_string());
        }
    }
    if !current_title.is_empty() && !current_body.join("\n").trim().is_empty() {
        sections.push(json!({
            "title": current_title,
            "body": current_body.join("\n").trim()
        }));
    }
    sections.truncate(8);
    sections
}

fn public_project(note: &Note) -> Value {
    let text = fs::read_to_string(&note.file).unwrap_or_default();
    let mut value = public_note(note);
    value["sections"] = Value::Array(project_sections(&text));
    value
}

fn collect_tasks(root: &Path) -> Vec<Note> {
    TASK_DIRS
        .iter()
        .flat_map(|(bucket, dir)| notes_in(root, dir, bucket))
        .collect()
}

fn collect_projects(root: &Path) -> Vec<Note> {
    let base = root.join("03-Projects/01-Active");
    let Ok(entries) = fs::read_dir(base) else {
        return Vec::new();
    };
    let mut projects: Vec<Note> = entries
        .flatten()
        .map(|entry| entry.path().join("README.md"))
        .filter(|path| path.exists())
        .filter_map(|path| read_note(root, &path, "projects"))
        .collect();
    projects.sort_by(|a, b| a.title.cmp(&b.title));
    projects
}

fn priority_rank(priority: &str) -> i32 {
    match priority {
        "high" => 0,
        "medium" => 1,
        "low" => 2,
        _ => 3,
    }
}

fn sort_tasks(tasks: &mut [Note]) {
    tasks.sort_by(|a, b| {
        priority_rank(&a.priority)
            .cmp(&priority_rank(&b.priority))
            .then_with(|| a.due.cmp(&b.due))
            .then_with(|| a.title.cmp(&b.title))
    });
}

fn task_score(task: &Note, today: &str) -> (i32, Vec<String>, Value) {
    let mut score = 0;
    let mut reasons = Vec::new();
    if task.bucket == "today" {
        score += 110;
        reasons.push("selected for today".to_string());
    }
    match task.priority.as_str() {
        "high" => {
            score += 45;
            reasons.push("high priority".to_string());
        }
        "medium" => {
            score += 22;
            reasons.push("medium priority".to_string());
        }
        "low" => score += 5,
        _ => {}
    }
    if !task.due.is_empty() {
        if task.due.as_str() < today {
            score += 70;
            reasons.push("overdue".to_string());
        } else if task.due == today {
            score += 60;
            reasons.push("due today".to_string());
        }
    }
    if reasons.is_empty() {
        reasons.push("active this week".to_string());
    }
    let explanation = json!({
        "whyNow": "Atlas selected this from the live task signals in your Markdown files.",
        "risk": "If it waits without a decision, the open loop may carry into the next review.",
        "nextMove": "Choose the smallest visible step that moves it forward today."
    });
    (score, reasons, explanation)
}

fn focus_task(note: &Note, score: i32, reasons: Vec<String>, explanation: Value) -> Value {
    let mut value = public_task(note);
    value["score"] = json!(score);
    value["reasons"] = json!(reasons);
    value["explanation"] = explanation;
    value
}

fn recent_notes(root: &Path) -> Vec<Value> {
    let mut notes: Vec<Note> = ["02-Library", "03-Projects", "04-Relationships", "05-Tasks"]
        .iter()
        .flat_map(|dir| notes_in(root, dir, ""))
        .collect();
    notes.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    notes
        .into_iter()
        .take(6)
        .map(|note| {
            json!({
                "title": note.title,
                "relativePath": note.relative_path,
                "type": note.item_type,
                "updated": note.updated
            })
        })
        .collect()
}

fn dashboard(root: &Path) -> Value {
    let today = today();
    let all_markdown: Vec<PathBuf> = markdown_files(root, ".")
        .into_iter()
        .filter(|file| !file.to_string_lossy().contains("00-System/Dashboard"))
        .collect();
    let capture = notes_in(root, "01-Inbox/01-Capture", "");
    let review: Vec<Note> = notes_in(root, "01-Inbox/02-Review", "")
        .into_iter()
        .filter(|note| note.relative_path != "01-Inbox/02-Review/00-Review Queue.md")
        .collect();
    let pending_review: Vec<Note> = review
        .into_iter()
        .filter(|note| note.status == "under-review")
        .collect();
    let archived_reviews = notes_in(root, "02-Library/Sources/Review-Archive", "");
    let people = notes_in(root, "04-Relationships/01-People", "");
    let organizations = notes_in(root, "04-Relationships/02-Organizations", "");
    let interactions = notes_in(root, "04-Relationships/03-Interactions", "");
    let projects = collect_projects(root);
    let tasks = collect_tasks(root);
    let routines: Vec<Note> = tasks
        .iter()
        .filter(|task| task.item_type == "routine")
        .cloned()
        .collect();
    let active_routines: Vec<Note> = routines
        .into_iter()
        .filter(|task| task.status == "active")
        .collect();
    let active_tasks: Vec<Note> = tasks
        .iter()
        .filter(|task| task.item_type == "task" && task.status == "active")
        .cloned()
        .collect();
    let waiting_tasks: Vec<Note> = tasks
        .iter()
        .filter(|task| {
            task.item_type == "task" && (task.status == "waiting" || task.bucket == "waiting")
        })
        .cloned()
        .collect();
    let completed_tasks: Vec<Note> = tasks
        .iter()
        .filter(|task| task.item_type == "task" && task.status == "completed")
        .cloned()
        .collect();
    let completed_today: Vec<Note> = completed_tasks
        .iter()
        .filter(|task| task.completed == today)
        .cloned()
        .collect();

    let mut scored: Vec<(Note, i32, Vec<String>, Value)> = active_tasks
        .iter()
        .map(|task| {
            let (score, reasons, explanation) = task_score(task, &today);
            (task.clone(), score, reasons, explanation)
        })
        .collect();
    scored.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.title.cmp(&b.0.title)));
    let top_three: Vec<Value> = scored
        .iter()
        .take(3)
        .map(|(task, score, reasons, explanation)| {
            focus_task(task, *score, reasons.clone(), explanation.clone())
        })
        .collect();
    let top_three_candidates: Vec<Value> = scored
        .iter()
        .map(|(task, score, reasons, explanation)| {
            focus_task(task, *score, reasons.clone(), explanation.clone())
        })
        .collect();

    let mut today_tasks: Vec<Note> = active_tasks
        .iter()
        .filter(|task| task.bucket == "today")
        .cloned()
        .collect();
    let mut week_tasks: Vec<Note> = active_tasks
        .iter()
        .filter(|task| task.bucket == "this-week")
        .cloned()
        .collect();
    let mut waiting = waiting_tasks.clone();
    let mut active_routines_sorted = active_routines.clone();
    let mut completed = completed_tasks.clone();
    let mut completed_today_sorted = completed_today.clone();
    sort_tasks(&mut today_tasks);
    sort_tasks(&mut week_tasks);
    sort_tasks(&mut waiting);
    sort_tasks(&mut active_routines_sorted);
    sort_tasks(&mut completed);
    sort_tasks(&mut completed_today_sorted);

    json!({
        "generatedAt": Local::now().to_rfc3339(),
        "today": today,
        "stats": {
            "totalNotes": all_markdown.len(),
            "libraryNotes": markdown_files(root, "02-Library").len(),
            "relationships": people.len() + organizations.len() + interactions.len(),
            "people": people.len(),
            "organizations": organizations.len(),
            "interactions": interactions.len(),
            "captureToProcess": capture.len(),
            "reviewToDecide": pending_review.len(),
            "archivedReviews": archived_reviews.len(),
            "activeProjects": projects.len(),
            "activeTasks": active_tasks.len(),
            "activeRoutines": active_routines_sorted.len(),
            "waitingTasks": waiting.len(),
            "completedTasks": completed.len(),
            "completedToday": completed_today_sorted.len()
        },
        "inbox": {
            "capture": capture.iter().map(public_note).collect::<Vec<_>>(),
            "review": pending_review.iter().map(public_note).collect::<Vec<_>>(),
            "archivedCount": archived_reviews.len()
        },
        "projects": projects.iter().map(public_project).collect::<Vec<_>>(),
        "tasks": {
            "topThree": top_three,
            "topThreeMode": "atlas",
            "topThreeCandidates": top_three_candidates,
            "today": today_tasks.iter().map(public_task).collect::<Vec<_>>(),
            "thisWeek": week_tasks.iter().map(public_task).collect::<Vec<_>>(),
            "waiting": waiting.iter().map(public_task).collect::<Vec<_>>(),
            "routines": active_routines_sorted.iter().map(public_routine).collect::<Vec<_>>(),
            "completed": completed.iter().map(public_task).collect::<Vec<_>>(),
            "completedToday": completed_today_sorted.iter().map(public_task).collect::<Vec<_>>()
        },
        "dailyFocus": {
            "mode": "atlas",
            "closeout": []
        },
        "recent": recent_notes(root)
    })
}

fn compact_line(value: Option<String>, label: &str, max: usize, required: bool) -> Result<String, String> {
    let cleaned = value.unwrap_or_default().split_whitespace().collect::<Vec<_>>().join(" ");
    if required && cleaned.is_empty() {
        return Err(format!("{label} is required."));
    }
    if cleaned.len() > max {
        return Err(format!("{label} is too long."));
    }
    Ok(cleaned)
}

fn safe_filename_stem(value: &str, fallback: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == ' ' || character == '-' || character == '_' {
                character
            } else {
                ' '
            }
        })
        .collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned.chars().take(96).collect()
    }
}

fn unique_path(root: &Path, relative_dir: &str, stem: &str) -> PathBuf {
    let dir = root.join(relative_dir);
    let mut path = dir.join(format!("{stem}.md"));
    let mut index = 2;
    while path.exists() {
        path = dir.join(format!("{stem} {index}.md"));
        index += 1;
    }
    path
}

fn append_change_log(root: &Path, files: &[String], reason: &str, approval_status: &str) -> Result<(), String> {
    let file_lines = files
        .iter()
        .map(|file| format!("- `{file}`"))
        .collect::<Vec<_>>()
        .join("\n");
    let entry = format!(
        "\n---\n\n## {}\n\n### Agent\nAtlas Tauri Dashboard\n\n### Action\nEdited files\n\n### Files Changed\n{}\n\n### Reason\n{}\n\n### Approval Status\n{}\n",
        timestamp(),
        file_lines,
        reason,
        approval_status
    );
    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(root.join("00-System/Change-Log.md"))
        .and_then(|mut file| std::io::Write::write_all(&mut file, entry.as_bytes()))
        .map_err(|error| error.to_string())
}

fn create_daily_capture(root: &Path) -> Result<Value, String> {
    let today = today();
    let relative = format!("01-Inbox/01-Capture/{today} - Daily Capture.md");
    let path = root.join(&relative);
    if !path.exists() {
        let text = format!(
            "---\ntitle: {today} - Daily Capture\ntype: note\nstatus: captured\ncreated: {today}\nupdated: {today}\ntags:\n  - daily-capture\nsummary: Mixed daily capture note containing work, life, task, and idea entries.\n---\n\n# {today} - Daily Capture\n\n"
        );
        fs::write(&path, text).map_err(|error| error.to_string())?;
        append_change_log(
            root,
            &[relative.clone()],
            "Created today's daily capture note from the Atlas app.",
            "direct-low-stakes-task",
        )?;
    }
    Ok(json!({ "message": "Daily capture is ready.", "relativePath": relative }))
}

fn create_task(root: &Path, payload: Value) -> Result<Value, String> {
    let input: TaskInput = serde_json::from_value(payload).map_err(|error| error.to_string())?;
    let title = compact_line(input.title, "Task title", 100, true)?;
    let summary = compact_line(input.summary, "Summary", 180, false)?;
    let priority = match input.priority.unwrap_or_else(|| "medium".to_string()).as_str() {
        "high" => "high",
        "low" => "low",
        _ => "medium",
    };
    let (bucket, dir) = match input.bucket.unwrap_or_else(|| "today".to_string()).as_str() {
        "this-week" => ("this-week", "05-Tasks/02-This-Week"),
        _ => ("today", "05-Tasks/01-Today"),
    };
    fs::create_dir_all(root.join(dir)).map_err(|error| error.to_string())?;
    let path = unique_path(root, dir, &safe_filename_stem(&title, "Atlas Task"));
    let relative = path
        .strip_prefix(root)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let today = today();
    let text = format!(
        "---\ntitle: {}\ntype: task\nstatus: active\ncreated: {}\nupdated: {}\npriority: {}\ntags: []\nsummary: {}\n---\n\n# {}\n\n## Notes\n\n",
        serde_json::to_string(&title).unwrap_or_else(|_| "\"Task\"".to_string()),
        today,
        today,
        priority,
        serde_json::to_string(&summary).unwrap_or_else(|_| "\"\"".to_string()),
        title
    );
    fs::write(&path, text).map_err(|error| error.to_string())?;
    append_change_log(
        root,
        &[relative.clone()],
        &format!("Created a quick task in Atlas {bucket}."),
        "direct-low-stakes-task",
    )?;
    Ok(json!({ "message": "Task added to Atlas.", "relativePath": relative }))
}

fn safe_relative(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    if relative_path.contains("..") || relative_path.starts_with('/') {
        return Err("Invalid Atlas path.".to_string());
    }
    let path = root.join(relative_path);
    if !path.exists() {
        return Err("Atlas file was not found.".to_string());
    }
    Ok(path)
}

fn update_frontmatter_scalar(text: &str, key: &str, value: &str) -> String {
    if !text.starts_with("---\n") {
        return format!("---\n{key}: {value}\n---\n\n{text}");
    }
    let Some(end) = text[4..].find("\n---") else {
        return text.to_string();
    };
    let end = 4 + end;
    let mut lines: Vec<String> = text[4..end].lines().map(ToString::to_string).collect();
    let prefix = format!("{key}:");
    let mut updated = false;
    for line in &mut lines {
        if line.starts_with(&prefix) {
            *line = format!("{key}: {value}");
            updated = true;
            break;
        }
    }
    if !updated {
        lines.push(format!("{key}: {value}"));
    }
    format!("---\n{}\n---{}", lines.join("\n"), &text[end + 4..])
}

fn complete_task(root: &Path, payload: Value) -> Result<Value, String> {
    let relative = payload
        .get("relativePath")
        .and_then(Value::as_str)
        .ok_or_else(|| "Task path is required.".to_string())?;
    let path = safe_relative(root, relative)?;
    let today = today();
    let mut text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    text = update_frontmatter_scalar(&text, "status", "completed");
    text = update_frontmatter_scalar(&text, "updated", &today);
    text = update_frontmatter_scalar(&text, "completed", &today);
    fs::write(&path, text).map_err(|error| error.to_string())?;
    append_change_log(
        root,
        &[relative.to_string()],
        "Marked an Atlas task completed from the app.",
        "direct-low-stakes-task",
    )?;
    Ok(json!({ "message": "Task marked complete.", "relativePath": relative }))
}

fn destination_dir(destination: &str) -> Result<(&'static str, &'static str), String> {
    match destination {
        "today" => Ok(("today", "05-Tasks/01-Today")),
        "this-week" => Ok(("this-week", "05-Tasks/02-This-Week")),
        "waiting" => Ok(("waiting", "05-Tasks/03-Waiting")),
        "someday" => Ok(("someday", "05-Tasks/04-Someday")),
        _ => Err("Unknown task lane.".to_string()),
    }
}

fn move_task(root: &Path, payload: Value) -> Result<Value, String> {
    let relative = payload
        .get("relativePath")
        .and_then(Value::as_str)
        .ok_or_else(|| "Task path is required.".to_string())?;
    let destination = payload
        .get("destination")
        .and_then(Value::as_str)
        .ok_or_else(|| "Destination is required.".to_string())?;
    let (bucket, dir) = destination_dir(destination)?;
    let source = safe_relative(root, relative)?;
    fs::create_dir_all(root.join(dir)).map_err(|error| error.to_string())?;
    let filename = source
        .file_name()
        .ok_or_else(|| "Task filename is invalid.".to_string())?;
    let mut target = root.join(dir).join(filename);
    if target.exists() && target != source {
        let stem = source
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("Task");
        target = unique_path(root, dir, stem);
    }
    let today = today();
    let mut text = fs::read_to_string(&source).map_err(|error| error.to_string())?;
    text = update_frontmatter_scalar(&text, "status", if bucket == "waiting" { "waiting" } else { "active" });
    text = update_frontmatter_scalar(&text, "updated", &today);
    fs::write(&source, text).map_err(|error| error.to_string())?;
    fs::rename(&source, &target).map_err(|error| error.to_string())?;
    let new_relative = target
        .strip_prefix(root)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    append_change_log(
        root,
        &[relative.to_string(), new_relative.clone()],
        "Moved an Atlas task between app lanes.",
        "direct-low-stakes-task",
    )?;
    Ok(json!({ "message": "Task moved.", "relativePath": new_relative }))
}

fn ensure_daily_focus(root: &Path) -> Result<PathBuf, String> {
    let relative = "05-Tasks/01-Today/Daily Focus.md";
    let path = root.join(relative);
    if !path.exists() {
        let today = today();
        let text = format!(
            "---\ntitle: Daily Focus\ntype: note\nstatus: active\ncreated: {today}\nupdated: {today}\ntags:\n  - daily-focus\nsummary: App-maintained record of daily focus choices and evening rollover notes.\n---\n\n# Daily Focus\n\n## {today}\n\n### Top Three\n\n### Closeout\n\n"
        );
        fs::write(&path, text).map_err(|error| error.to_string())?;
    }
    Ok(path)
}

fn append_daily_focus(root: &Path, title: &str, lines: &[String]) -> Result<(), String> {
    let path = ensure_daily_focus(root)?;
    let mut text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let today = today();
    text.push_str(&format!("\n## {today}\n\n### {title}\n\n"));
    if lines.is_empty() {
        text.push_str("- Atlas selected priorities from live task signals.\n");
    } else {
        for line in lines {
            text.push_str("- ");
            text.push_str(line);
            text.push('\n');
        }
    }
    text = update_frontmatter_scalar(&text, "updated", &today);
    fs::write(&path, text).map_err(|error| error.to_string())?;
    append_change_log(
        root,
        &["05-Tasks/01-Today/Daily Focus.md".to_string()],
        "Updated the daily focus record from the Atlas app.",
        "direct-low-stakes-task",
    )
}

fn set_top_three(root: &Path, payload: Value) -> Result<Value, String> {
    let relative_paths = payload
        .get("relativePaths")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let lines: Vec<String> = relative_paths
        .iter()
        .filter_map(Value::as_str)
        .take(3)
        .map(|path| format!("Manual priority: {path}"))
        .collect();
    append_daily_focus(root, "Top Three", &lines)?;
    Ok(json!({ "message": "Top Three preference saved.", "relativePath": "05-Tasks/01-Today/Daily Focus.md" }))
}

fn close_day(root: &Path, payload: Value) -> Result<Value, String> {
    let actions = payload
        .get("actions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut summary = Vec::new();
    for action in actions {
        let relative_path = action.get("relativePath").and_then(Value::as_str).unwrap_or("");
        let destination = action.get("destination").and_then(Value::as_str).unwrap_or("today");
        if relative_path.is_empty() {
            continue;
        }
        let result = move_task(
            root,
            json!({
                "relativePath": relative_path,
                "destination": destination
            }),
        )?;
        summary.push(format!(
            "{} -> {}",
            result.get("relativePath").and_then(Value::as_str).unwrap_or(relative_path),
            destination
        ));
    }
    append_daily_focus(root, "Closeout", &summary)?;
    Ok(json!({ "message": "Atlas day closed.", "relativePath": "05-Tasks/01-Today/Daily Focus.md" }))
}

fn create_atlas_request(root: &Path, payload: Value) -> Result<Value, String> {
    let kind = payload
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("feature");
    let description = payload
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if description.is_empty() {
        return Err("Request is required.".to_string());
    }
    let today = today();
    let title = match kind {
        "routine" => "Routine Request",
        "priority" => "Priority Request",
        "project" => "Project Request",
        _ => "App Request",
    };
    let tag = match kind {
        "routine" => "routine-request",
        "priority" => "priority-request",
        "project" => "project-request",
        _ => "feature-request",
    };
    let dir = "01-Inbox/01-Capture";
    fs::create_dir_all(root.join(dir)).map_err(|error| error.to_string())?;
    let path = unique_path(root, dir, &format!("{today} - {title}"));
    let relative = path
        .strip_prefix(root)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let text = format!(
        "---\ntitle: {today} - {title}\ntype: note\nstatus: captured\ncreated: {today}\nupdated: {today}\ntags:\n  - atlas-request\n  - {tag}\nsummary: App-created Atlas request awaiting the next processing pass.\n---\n\n# {today} - {title}\n\n{description}\n"
    );
    fs::write(&path, text).map_err(|error| error.to_string())?;
    append_change_log(
        root,
        &[relative.clone()],
        "Saved an app request to Capture for Atlas processing.",
        "direct-low-stakes-task",
    )?;
    Ok(json!({ "message": "Request saved to Capture.", "relativePath": relative }))
}

fn add_task_note(root: &Path, payload: Value) -> Result<Value, String> {
    let relative = payload
        .get("relativePath")
        .and_then(Value::as_str)
        .ok_or_else(|| "Task path is required.".to_string())?;
    let note = payload
        .get("note")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if note.is_empty() {
        return Err("Note is required.".to_string());
    }
    let path = safe_relative(root, relative)?;
    let mut text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    if !text.contains("\n## Notes") {
        text.push_str("\n\n## Notes\n\n");
    }
    text = text.replace("\n## Notes\n\n", &format!("\n## Notes\n\n- {} - {}\n", today(), note));
    text = update_frontmatter_scalar(&text, "updated", &today());
    fs::write(&path, text).map_err(|error| error.to_string())?;
    append_change_log(
        root,
        &[relative.to_string()],
        "Added a short note to an Atlas task from the app.",
        "direct-low-stakes-task",
    )?;
    Ok(json!({ "message": "Task note added.", "relativePath": relative }))
}

fn toggle_task_checklist(root: &Path, payload: Value) -> Result<Value, String> {
    let relative = payload
        .get("relativePath")
        .and_then(Value::as_str)
        .ok_or_else(|| "Task path is required.".to_string())?;
    let target_index = payload
        .get("checklistIndex")
        .and_then(Value::as_u64)
        .ok_or_else(|| "Checklist item is required.".to_string())? as usize;
    let done = payload.get("done").and_then(Value::as_bool).unwrap_or(true);
    let path = safe_relative(root, relative)?;
    let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let mut index = 0;
    let mut changed = false;
    let mut updated_lines = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("- [") && trimmed.get(4..5) == Some("]") {
            if index == target_index {
                let indent_len = line.len() - trimmed.len();
                let indent = &line[..indent_len];
                let rest = trimmed.get(5..).unwrap_or("").trim_start();
                updated_lines.push(format!("{}- [{}] {}", indent, if done { "x" } else { " " }, rest));
                changed = true;
            } else {
                updated_lines.push(line.to_string());
            }
            index += 1;
        } else {
            updated_lines.push(line.to_string());
        }
    }
    if !changed {
        return Err("Checklist item was not found.".to_string());
    }
    let mut updated = updated_lines.join("\n");
    updated.push('\n');
    updated = update_frontmatter_scalar(&updated, "updated", &today());
    fs::write(&path, updated).map_err(|error| error.to_string())?;
    append_change_log(
        root,
        &[relative.to_string()],
        "Updated an Atlas task checklist item from the app.",
        "direct-low-stakes-task",
    )?;
    Ok(json!({ "message": "Checklist updated.", "relativePath": relative }))
}

fn routine_detail(payload: &Value) -> String {
    let note = payload.get("note").and_then(Value::as_str).unwrap_or("").trim();
    if let (Some(sys), Some(dia)) = (
        payload.get("systolic").and_then(Value::as_str),
        payload.get("diastolic").and_then(Value::as_str),
    ) {
        return [format!("{}/{}", sys, dia), note.to_string()]
            .into_iter()
            .filter(|item| !item.trim().is_empty())
            .collect::<Vec<_>>()
            .join(" - ");
    }
    if let (Some(weight), Some(body_fat), Some(bmi)) = (
        payload.get("weight").and_then(Value::as_str),
        payload.get("bodyFat").and_then(Value::as_str),
        payload.get("bmi").and_then(Value::as_str),
    ) {
        return [format!("Weight: {weight}, Fat: {body_fat}%, BMI: {bmi}"), note.to_string()]
            .into_iter()
            .filter(|item| !item.trim().is_empty())
            .collect::<Vec<_>>()
            .join(" - ");
    }
    if let Some(value) = payload.get("value").and_then(Value::as_str) {
        return [value.to_string(), note.to_string()]
            .into_iter()
            .filter(|item| !item.trim().is_empty())
            .collect::<Vec<_>>()
            .join(" - ");
    }
    note.to_string()
}

fn log_routine(root: &Path, payload: Value) -> Result<Value, String> {
    let relative = payload
        .get("relativePath")
        .and_then(Value::as_str)
        .ok_or_else(|| "Routine path is required.".to_string())?;
    let path = safe_relative(root, relative)?;
    let mut text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let today = today();
    let detail = routine_detail(&payload);
    if !text.contains("\n## Entries") {
        text.push_str("\n\n## Entries\n\n");
    }
    text.push_str(&format!("\n- {today}"));
    if !detail.is_empty() {
        text.push_str(" - ");
        text.push_str(&detail);
    }
    text.push('\n');
    text = update_frontmatter_scalar(&text, "updated", &today);
    fs::write(&path, text).map_err(|error| error.to_string())?;
    append_change_log(
        root,
        &[relative.to_string()],
        "Logged an Atlas routine entry from the app.",
        "direct-low-stakes-task",
    )?;
    Ok(json!({ "message": "Routine logged.", "relativePath": relative }))
}

fn set_routine_status(root: &Path, payload: Value, status: &str) -> Result<Value, String> {
    let relative = payload
        .get("relativePath")
        .and_then(Value::as_str)
        .ok_or_else(|| "Routine path is required.".to_string())?;
    let path = safe_relative(root, relative)?;
    let mut text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    text = update_frontmatter_scalar(&text, "status", status);
    text = update_frontmatter_scalar(&text, "updated", &today());
    fs::write(&path, text).map_err(|error| error.to_string())?;
    append_change_log(
        root,
        &[relative.to_string()],
        &format!("Set an Atlas routine to {status} from the app."),
        "direct-low-stakes-task",
    )?;
    Ok(json!({ "message": "Routine updated.", "relativePath": relative }))
}

#[tauri::command]
fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    read_settings(&app)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    if !settings.vault_path.trim().is_empty() {
        validate_vault(Path::new(&settings.vault_path))?;
    }
    write_settings(&app, &settings)
}

#[tauri::command]
fn set_vault_folder(app: AppHandle, vault_path: String) -> Result<AppSettings, String> {
    validate_vault(Path::new(&vault_path))?;
    let mut settings = read_settings(&app)?;
    settings.vault_path = vault_path;
    write_settings(&app, &settings)
}

#[tauri::command]
fn select_vault_folder() -> Result<AppSettings, String> {
    Err("Use the native folder picker from the app window.".to_string())
}

#[tauri::command]
fn get_dashboard(app: AppHandle) -> Result<Value, String> {
    let root = vault_root(&app)?;
    Ok(dashboard(&root))
}

#[tauri::command]
fn get_market_ticker() -> Value {
    json!({
        "generatedAt": Local::now().to_rfc3339(),
        "status": "Market data moves to Phase 4.",
        "items": []
    })
}

#[tauri::command]
fn get_weather() -> Value {
    json!({
        "temperature": null,
        "summary": "Weather moves to Phase 4",
        "icon": "cloud",
        "high": null,
        "low": null,
        "apparent": null,
        "location": "Local"
    })
}

#[tauri::command]
fn get_notes(app: AppHandle, query: String, section: String) -> Result<Value, String> {
    let root = vault_root(&app)?;
    Ok(list_editor_notes(&root, &query, &section))
}

#[tauri::command]
fn read_note_content(app: AppHandle, relative_path: String) -> Result<Value, String> {
    let root = vault_root(&app)?;
    read_editor_note(&root, &relative_path)
}

#[tauri::command]
fn save_note(app: AppHandle, note: Value) -> Result<Value, String> {
    let root = vault_root(&app)?;
    save_editor_note(&root, note)
}

#[tauri::command]
fn create_note(app: AppHandle, note: Value) -> Result<Value, String> {
    let root = vault_root(&app)?;
    create_editor_note(&root, note)
}

#[tauri::command]
fn run_action(app: AppHandle, action: String, payload: Value) -> Result<Value, String> {
    let root = vault_root(&app)?;
    match action.as_str() {
        "/api/actions/create-daily-capture" => create_daily_capture(&root),
        "/api/actions/create-task" => create_task(&root, payload),
        "/api/actions/complete-task" => complete_task(&root, payload),
        "/api/actions/move-task" => move_task(&root, payload),
        "/api/actions/set-top-three" => set_top_three(&root, payload),
        "/api/actions/close-day" => close_day(&root, payload),
        "/api/actions/create-atlas-request"
        | "/api/actions/create-routine-request"
        | "/api/actions/create-routine" => create_atlas_request(&root, payload),
        "/api/actions/add-task-note" => add_task_note(&root, payload),
        "/api/actions/toggle-task-checklist" => toggle_task_checklist(&root, payload),
        "/api/actions/log-routine" => log_routine(&root, payload),
        "/api/actions/complete-routine" => set_routine_status(&root, payload, "completed"),
        "/api/actions/archive-routine" => set_routine_status(&root, payload, "archived"),
        _ => Err("That Atlas action is not available in the Tauri app yet.".to_string()),
    }
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("obsidian://") || url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Atlas blocked an unsupported external URL.".to_string());
    }
    open::that(url).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            create_note,
            get_dashboard,
            get_market_ticker,
            get_notes,
            get_settings,
            get_weather,
            open_external,
            read_note_content,
            run_action,
            save_note,
            save_settings,
            select_vault_folder,
            set_vault_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Atlas");
}
