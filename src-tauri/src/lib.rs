use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

/// A comic file path passed on the command line (via a file association
/// double-click) before the frontend had a chance to attach its listener.
/// The frontend pulls it once, on startup, via `take_pending_open_file`.
struct PendingOpenFile(Mutex<Option<String>>);

fn extract_file_arg(args: &[String]) -> Option<String> {
  args
    .iter()
    .skip(1)
    .find(|arg| {
      let lower = arg.to_lowercase();
      lower.ends_with(".cbz") || lower.ends_with(".cbr") || lower.ends_with(".zip") || lower.ends_with(".rar")
    })
    .cloned()
}

#[tauri::command]
fn take_pending_open_file(state: State<PendingOpenFile>) -> Option<String> {
  let taken = state.0.lock().unwrap().take();
  log::info!("take_pending_open_file -> {taken:?}");
  taken
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Note: log:: calls here are dropped — the logger isn't initialized until
  // .setup() runs below, so the initial file (if any) is only confirmed once
  // the frontend calls take_pending_open_file() and its own log line fires.
  let initial_file = extract_file_arg(&std::env::args().collect::<Vec<_>>());

  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
      // A second launch (e.g. double-clicking another comic while the app is
      // already open) is redirected here instead of opening a new window.
      log::info!("second instance launched with args {args:?}");
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
        let _ = window.unminimize();
      }
      if let Some(path) = extract_file_arg(&args) {
        log::info!("forwarding open-file-path -> {path}");
        let _ = app.emit("open-file-path", path);
      }
    }))
    .manage(PendingOpenFile(Mutex::new(initial_file)))
    .invoke_handler(tauri::generate_handler![take_pending_open_file])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
