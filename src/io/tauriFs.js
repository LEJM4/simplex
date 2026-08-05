// src/io/tauriFs.js
// ---------------------------------------------------------------------------
// Desktop backend (phase 6e): native open/save dialogs and direct file I/O
// through the official Tauri plugins. Paths are plain strings — unlike
// browser FS-Access handles they serialize trivially into the recents list,
// and the persisted-scope plugin keeps them readable across app restarts
// (the dialog plugin adds every user-picked path to the fs scope at runtime;
// verified in tauri-plugin-dialog 2.7.2 sources).
//
// All Tauri modules are imported lazily: in a regular web build they end up
// in a chunk that is never fetched, because every call is guarded by
// `isTauri`. fileSystem.js checks the Tauri branch FIRST — WebView2 may also
// expose showOpenFilePicker, but the native path must win on the desktop.
// ---------------------------------------------------------------------------

export const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let dialogModule = null;
let fsModule = null;

async function dialog() {
  dialogModule ??= await import('@tauri-apps/plugin-dialog');
  return dialogModule;
}

async function fs() {
  fsModule ??= await import('@tauri-apps/plugin-fs');
  return fsModule;
}

/** Dialog filter list from one extension or an array ('.sdoc' → ['sdoc']). */
const toExtensions = (extension) =>
  [].concat(extension).map((value) => String(value).replace(/^\./, ''));

/** Native open dialog → absolute path string, or null on cancel. */
export async function pickOpenPath(filterName, extension) {
  const { open } = await dialog();
  return open({
    multiple: false,
    filters: [{ name: filterName, extensions: toExtensions(extension) }],
  });
}

/** Native save dialog → absolute path string, or null on cancel.
 *  `filters` is a list of { name, extension } — more than one entry becomes
 *  the type dropdown of the native dialog (the first one is preselected). */
export async function pickSavePath(defaultName, filters) {
  const { save } = await dialog();
  return save({
    defaultPath: defaultName,
    filters: filters.map(({ name, extension }) => ({
      name,
      extensions: toExtensions(extension),
    })),
  });
}

/** Read a file as Uint8Array. */
export async function readFileBytes(path) {
  const { readFile } = await fs();
  return readFile(path);
}

/** Write Uint8Array bytes to a file (creates/overwrites). */
export async function writeFileBytes(path, bytes) {
  const { writeFile } = await fs();
  return writeFile(path, bytes);
}

/** Last path segment — works for both / and \\ separators. */
/** Copy `path` to `path + suffix` right before an overwrite. Runs in Rust
    (command backup_copy): the webview's fs scope covers the document path
    itself, not its .bak sibling. Best effort — never blocks the save. */
export async function backupCopy(path, suffix) {
  if (!isTauri) return false;
  try {
    return await invoke('backup_copy', { path, suffix });
  } catch (error) {
    console.warn('[backup] .bak copy failed', error);
    return false;
  }
}

export function fileNameOf(path) {
  return path.split(/[\\/]/).pop();
}

/** Mirror document.title into the native window titlebar. */
export async function setNativeWindowTitle(title) {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().setTitle(title);
}

/* File-association hand-over (phase 6e part 3) ------------------------------ */

/** Path the OS handed to a FRESH launch (double-clicked .sdoc) — one-shot,
 *  the Rust side clears it on pickup (command `take_launch_file`, lib.rs). */
export async function takeLaunchFile() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('take_launch_file');
}

/** Paths arriving while the app is RUNNING: the single-instance plugin
 *  forwards a second launch's argv as an 'open-file' event (lib.rs). */
export async function onOpenFile(handler) {
  const { listen } = await import('@tauri-apps/api/event');
  return listen('open-file', (event) => handler(event.payload));
}
