// Simplex desktop shell (phase 6e). The application itself is the web
// frontend; this side only provides the window and the plugins:
//   single-instance a second launch (e.g. another double-clicked .sdoc)
//                   focuses the running window and hands its argv over —
//                   registered FIRST (upstream requirement)
//   dialog          native open/save dialogs (extends the fs scope with
//                   every user-picked path at runtime)
//   fs              read/write of those files from JS (io/tauriFs.js)
//   persisted-scope keeps allowed paths across app restarts, which makes
//                   the "recently opened" list work on the desktop
//   window-state    remembers size/position/maximized across restarts
//                   (auto restore on window creation, auto save on exit —
//                   verified in tauri-plugin-window-state 2.4.1 sources)
//
// File associations (phase 6e part 3): a double-clicked .sdoc arrives as a
// command-line argument (Windows/Linux; macOS would need RunEvent::Opened —
// parked with the other Mac topics in the plan). The path is allowed on the
// fs-plugin scope here — the exact tauri::fs::Scope that resolve_path checks
// (verified in tauri-plugin-fs 2.5.1), the same runtime mechanism the dialog
// plugin uses for picked paths — and then handed to the frontend: on a fresh
// launch via the `take_launch_file` command, into a running instance via the
// `open-file` event emitted from the single-instance callback.

use std::sync::Mutex;

use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;

/// First document path in a launch argv (arg 0 and flags skipped) — the
/// current .sdoc extension plus the legacy ones (.sim, .swdoc).
fn document_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter().skip(1).find(|arg| {
        if arg.starts_with('-') {
            return false;
        }
        let lower = arg.to_lowercase();
        lower.ends_with(".sdoc") || lower.ends_with(".sim") || lower.ends_with(".swdoc")
    })
}

/// Allow `path` for the fs plugin so io/tauriFs.js can read/write it.
/// persisted-scope keeps the grant across restarts (recents behavior).
fn allow_path(app: &tauri::AppHandle, path: &str) {
    if let Err(error) = app.fs_scope().allow_file(path) {
        eprintln!("[simplex] fs scope for {path} failed: {error}");
    }
}

/// The association-opened path waits here until the frontend is ready.
struct LaunchFile(Mutex<Option<String>>);

/// One-shot pickup of the launch file by the frontend (main.js, boot).
#[tauri::command]
fn take_launch_file(state: tauri::State<'_, LaunchFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

/// Feature 1 (0.25.0): copy the document to `<path><suffix>` right before it
/// gets overwritten. Runs in Rust because the webview's fs scope covers the
/// document path itself, not the .bak sibling.
#[tauri::command]
fn backup_copy(path: String, suffix: String) -> Result<bool, String> {
    let source = std::path::Path::new(&path);
    if !source.is_file() {
        return Ok(false);
    }
    std::fs::copy(source, format!("{path}{suffix}"))
        .map(|_| true)
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Runs in the FIRST instance with the SECOND launch's argv.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            if let Some(path) = document_from_args(args) {
                allow_path(app, &path);
                let _ = app.emit("open-file", path);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            // App setup runs after plugin setup — the fs scope exists here.
            let launch = document_from_args(std::env::args());
            if let Some(path) = &launch {
                allow_path(app.handle(), path);
            }
            app.manage(LaunchFile(Mutex::new(launch)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![take_launch_file, backup_copy])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
