use chrono::NaiveDateTime;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

// ── State ───────────────────────────────────────────

struct AppState {
    conflicts: Mutex<Vec<ConflictItem>>,
    directory: Mutex<String>,
}

// ── Data types ───────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ConflictItem {
    index: usize,
    original_name: String,
    original_path: String,
    conflict_path: String,
    device_id: String,
    conflict_date: String,
    conflict_size: u64,
    original_size: u64,
    resolved: bool,
}

#[derive(Debug, Serialize)]
struct DiffLine {
    orig_line_no: u32,
    conf_line_no: u32,
    orig_content: String,
    conf_content: String,
    status: String, // "equal" | "added" | "removed" | "modified"
}

#[derive(Debug, Serialize)]
struct DiffData {
    lines: Vec<DiffLine>,
    added: u32,
    removed: u32,
    identical: bool,
}

#[derive(Debug, Serialize)]
struct MergeBlock {
    block_index: usize,
    #[serde(rename = "type")]
    block_type: String,
    lines: Vec<String>,
}

#[derive(Debug, Serialize)]
struct MergeData {
    original_content: String,
    conflict_content: String,
    blocks: Vec<MergeBlock>,
    conflict_index: usize,
    total_conflicts: usize,
}

// ── Conflict parsing ─────────────────────────────────

/// Parse a Syncthing conflict filename.
/// Format: <basename>.sync-conflict-<YYYYMMDD>-<HHMMSS>-<device>.<ext>
fn parse_conflict_path(conflict_path: &Path) -> Option<(String, String, NaiveDateTime, String)> {
    let filename = conflict_path.file_name()?.to_str()?;

    let re = Regex::new(
        r"^(.+)\.sync-conflict-(\d{8})-(\d{6})-([A-Za-z0-9]+)\.(\w+)$"
    ).ok()?;

    let caps = re.captures(filename)?;
    let name_without_ext = caps.get(1)?.as_str();
    let date_str = caps.get(2)?.as_str();
    let time_str = caps.get(3)?.as_str();
    let device_id = caps.get(4)?.as_str().to_string();
    let ext = caps.get(5)?.as_str();

    let original_name = format!("{}.{}", name_without_ext, ext);
    let datetime = NaiveDateTime::parse_from_str(
        &format!("{}{}", date_str, time_str),
        "%Y%m%d%H%M%S",
    )
    .ok()?;

    let parent = conflict_path.parent()?;
    let original_path = parent.join(&original_name);

    Some((original_path.to_string_lossy().to_string(), original_name, datetime, device_id))
}

fn is_conflict_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.contains(".sync-conflict-"))
        .unwrap_or(false)
}

// ── Commands ─────────────────────────────────────────

#[tauri::command]
fn scan_conflicts(
    directory: String,
    state: tauri::State<AppState>,
) -> Result<Vec<ConflictItem>, String> {
    let mut items = Vec::new();
    let dir = Path::new(&directory);

    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", directory));
    }

    scan_dir_recursive(dir, &mut items)?;

    // Sort by conflict date, newest first
    items.sort_by(|a, b| b.conflict_date.cmp(&a.conflict_date));

    // Assign indices
    for (i, item) in items.iter_mut().enumerate() {
        item.index = i;
    }

    *state.conflicts.lock().map_err(|e| e.to_string())? = items.clone();
    *state.directory.lock().map_err(|e| e.to_string())? = directory;

    Ok(items)
}

fn scan_dir_recursive(dir: &Path, items: &mut Vec<ConflictItem>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            // Skip hidden dirs and common VCS dirs
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with('.') || name == "node_modules" || name == "target" {
                    continue;
                }
            }
            scan_dir_recursive(&path, items)?;
        } else if is_conflict_file(&path) {
            if let Some((orig_path, orig_name, date, device_id)) = parse_conflict_path(&path) {
                let conflict_size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                let original_size = fs::metadata(&orig_path).map(|m| m.len()).unwrap_or(0);

                items.push(ConflictItem {
                    index: 0, // will be set after sorting
                    original_name: orig_name,
                    original_path: orig_path,
                    conflict_path: path.to_string_lossy().to_string(),
                    device_id,
                    conflict_date: date.and_utc().to_rfc3339(),
                    conflict_size,
                    original_size,
                    resolved: false,
                });
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Cannot read {}: {}", path, e))
}

#[tauri::command]
fn get_diff(original_path: String, conflict_path: String) -> Result<DiffData, String> {
    let orig = fs::read_to_string(&original_path).map_err(|e| e.to_string())?;
    let conf = fs::read_to_string(&conflict_path).map_err(|e| e.to_string())?;

    if orig == conf {
        let lines: Vec<DiffLine> = orig
            .lines()
            .enumerate()
            .map(|(i, content)| DiffLine {
                orig_line_no: (i + 1) as u32,
                conf_line_no: (i + 1) as u32,
                orig_content: content.to_string(),
                conf_content: content.to_string(),
                status: "equal".to_string(),
            })
            .collect();
        return Ok(DiffData {
            identical: true,
            added: 0,
            removed: 0,
            lines,
        });
    }

    let changes = diff::lines(&orig, &conf);
    let mut lines = Vec::new();
    let mut added = 0u32;
    let mut removed = 0u32;
    let mut orig_line = 1u32;
    let mut conf_line = 1u32;

    for change in &changes {
        match change {
            diff::Result::Both(content, _) => {
                lines.push(DiffLine {
                    orig_line_no: orig_line,
                    conf_line_no: conf_line,
                    orig_content: content.to_string(),
                    conf_content: content.to_string(),
                    status: "equal".to_string(),
                });
                orig_line += 1;
                conf_line += 1;
            }
            diff::Result::Left(content) => {
                removed += 1;
                lines.push(DiffLine {
                    orig_line_no: orig_line,
                    conf_line_no: 0,
                    orig_content: content.to_string(),
                    conf_content: String::new(),
                    status: "removed".to_string(),
                });
                orig_line += 1;
            }
            diff::Result::Right(content) => {
                added += 1;
                lines.push(DiffLine {
                    orig_line_no: 0,
                    conf_line_no: conf_line,
                    orig_content: String::new(),
                    conf_content: content.to_string(),
                    status: "added".to_string(),
                });
                conf_line += 1;
            }
        }
    }

    Ok(DiffData {
        identical: false,
        added,
        removed,
        lines,
    })
}

#[tauri::command]
fn get_merge_data(
    original_path: String,
    conflict_path: String,
    state: tauri::State<AppState>,
) -> Result<MergeData, String> {
    let orig = fs::read_to_string(&original_path).map_err(|e| e.to_string())?;
    let conf = fs::read_to_string(&conflict_path).map_err(|e| e.to_string())?;

    let conflicts = state.conflicts.lock().map_err(|e| e.to_string())?;

    // Find the conflict index
    let (conflict_index, total) = {
        let idx = conflicts
            .iter()
            .position(|c| c.conflict_path == conflict_path)
            .map(|i| i + 1)
            .unwrap_or(0);
        (idx, conflicts.len())
    };

    // Build diff blocks for merge editor
    let changes = diff::lines(&orig, &conf);
    let mut blocks = Vec::new();
    let mut block_index = 0usize;

    for change in &changes {
        match change {
            diff::Result::Both(content, _) => {
                let lines: Vec<String> = content.lines().map(String::from).collect();
                blocks.push(MergeBlock {
                    block_index,
                    block_type: "equal".to_string(),
                    lines,
                });
                block_index += 1;
            }
            diff::Result::Left(content) => {
                let lines: Vec<String> = content.lines().map(String::from).collect();
                blocks.push(MergeBlock {
                    block_index,
                    block_type: "removed".to_string(),
                    lines,
                });
                block_index += 1;
            }
            diff::Result::Right(content) => {
                let lines: Vec<String> = content.lines().map(String::from).collect();
                blocks.push(MergeBlock {
                    block_index,
                    block_type: "added".to_string(),
                    lines,
                });
                block_index += 1;
            }
        }
    }

    Ok(MergeData {
        original_content: orig,
        conflict_content: conf,
        blocks,
        conflict_index,
        total_conflicts: total,
    })
}

#[tauri::command]
fn resolve_conflict(
    index: usize,
    choice: String,
    merged_content: Option<String>,
    state: tauri::State<AppState>,
) -> Result<String, String> {
    let conflicts = state.conflicts.lock().map_err(|e| e.to_string())?;
    let item = conflicts
        .get(index)
        .ok_or_else(|| format!("Conflict index {} out of range", index))?;

    let original_path = Path::new(&item.original_path);
    let conflict_path = Path::new(&item.conflict_path);
    let backup_dir = original_path
        .parent()
        .map(|p| p.join(".stc-backup"))
        .unwrap_or_else(|| PathBuf::from(".stc-backup"));

    fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;

    match choice.as_str() {
        "original" => {
            // Delete the conflict file, keep the original
            if conflict_path.exists() {
                fs::remove_file(conflict_path).map_err(|e| e.to_string())?;
            }
        }
        "conflict" => {
            // Backup original, replace with conflict content, delete conflict
            if original_path.exists() {
                let orig_name = original_path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy();
                fs::copy(original_path, backup_dir.join(orig_name.as_ref()))
                    .map_err(|e| e.to_string())?;
            }
            fs::rename(conflict_path, original_path).map_err(|e| e.to_string())?;
        }
        "both" => {
            // Keep both: conflict file stays as-is
            // (no action needed)
        }
        "delete" => {
            // Delete the conflict file
            if conflict_path.exists() {
                fs::remove_file(conflict_path).map_err(|e| e.to_string())?;
            }
        }
        "merge" => {
            if let Some(content) = merged_content {
                // Backup original
                if original_path.exists() {
                    let orig_name = original_path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy();
                    fs::copy(original_path, backup_dir.join(orig_name.as_ref()))
                        .map_err(|e| e.to_string())?;
                }
                // Write merged content to original
                fs::write(original_path, &content).map_err(|e| e.to_string())?;
                // Delete conflict file
                if conflict_path.exists() {
                    fs::remove_file(conflict_path).map_err(|e| e.to_string())?;
                }
            } else {
                return Err("merged_content is required for 'merge' choice".to_string());
            }
        }
        _ => {
            return Err(format!("Unknown choice: {}", choice));
        }
    }

    Ok(format!("Resolved {} with choice {}", item.original_name, choice))
}

#[tauri::command]
fn pick_directory() -> Result<Option<String>, String> {
    // This will use tauri-plugin-dialog but for now,
    // we implement a simple approach using the dialog plugin
    // The frontend will use @tauri-apps/plugin-dialog directly
    Ok(None)
}

// ── App entry ────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            conflicts: Mutex::new(Vec::new()),
            directory: Mutex::new(String::new()),
        })
        .invoke_handler(tauri::generate_handler![
            scan_conflicts,
            get_diff,
            get_merge_data,
            resolve_conflict,
            read_file,
            pick_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
