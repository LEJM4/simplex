// src/io/fileSystem.js
// ---------------------------------------------------------------------------
// New / Open / Save / Save As for .sdoc files (legacy .sim/.swdoc stay openable).
// Primary path: File System Access API (Chrome/Edge) with real file handles,
// re-saving in place and a persistent "recent files" list (handles survive a
// browser restart in IndexedDB; access is re-confirmed via requestPermission).
// Fallback path (Firefox/Safari): open via <input type=file>, save via
// download — no handles, hence no recent list there.
//
// State key 'file': { name, handle | null } or null (untitled document).
// Opening or creating mounts a FRESH editor (via mountEditor) so the undo
// history can never step back across a file boundary.
// ---------------------------------------------------------------------------

import { settings } from '../config/settings.js';
import { appState } from '../core/appState.js';
import { t } from '../i18n/index.js';
import { showDialog } from '../ui/dialogs/dialog.js';
import { createContainer, parseContainer } from './container.js';
import { getDb } from './db.js';
import { deleteSnapshot, recordSaveGeneration } from './autosave.js';
import { replaceDocSettings } from '../core/docSettings.js';
import {
  isTauri,
  pickOpenPath,
  pickSavePath,
  readFileBytes,
  writeFileBytes,
  fileNameOf,
  backupCopy,
} from './tauriFs.js';

// Three backends, checked in this order everywhere:
//   1. Tauri (desktop)  — native dialogs, path strings, phase 6e
//   2. FS Access API    — Chrome/Edge in the browser, file handles
//   3. Download/Upload  — Firefox/Safari fallback
// isTauri excludes FS Access on purpose: WebView2 may expose the API, but
// the native path must win on the desktop.
export const supportsFileSystemAccess =
  !isTauri && typeof window !== 'undefined' && 'showOpenFilePicker' in window;

/** Recents need a re-openable reference: a Tauri path or a FSA handle. */
export const supportsRecents = isTauri || supportsFileSystemAccess;

function openPickerTypes() {
  return [
    {
      description: t('file.pickerType'),
      accept: { 'application/x-simplex': settings.file.openExtensions },
    },
  ];
}

function savePickerTypes() {
  return [
    {
      description: t('file.pickerType'),
      accept: { 'application/x-simplex': [settings.file.extension] },
    },
  ];
}

/** Save-As types: our format first (preselected), Word second. */
function saveAsPickerTypes() {
  return [
    ...savePickerTypes(),
    {
      description: t('file.docxPickerType'),
      accept: {
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
          [settings.file.docxExtension],
      },
    },
  ];
}

/** File name without our document extension — legacy .sim/.swdoc included. */
export function stripDocExtension(name) {
  if (name == null) return null;
  const lower = String(name).toLowerCase();
  for (const extension of settings.file.openExtensions) {
    if (lower.endsWith(extension)) return String(name).slice(0, -extension.length);
  }
  return String(name);
}

function untitledFileName() {
  return `${t('file.untitled')}${settings.file.extension}`;
}

async function ensurePermission(handle) {
  const options = { mode: 'readwrite' };
  if ((await handle.queryPermission(options)) === 'granted') return true;
  return (await handle.requestPermission(options)) === 'granted';
}

async function writeToHandle(handle, bytes) {
  const writable = await handle.createWritable();
  await writable.write(bytes);
  await writable.close();
}

/** Feature 1 (0.25.0): capture the previous ON-DISK state before it gets
    overwritten — as a 'saved' generation in IndexedDB on every backend, plus
    a sibling .bak on the desktop (Rust copies; the webview fs scope covers
    only the document path). Best effort: a corrupt or unreadable previous
    file must never block the save itself. */
async function backupBeforeOverwrite(target) {
  if (!settings.file.backupCopy) return;
  try {
    let bytes = null;
    if (target.path) {
      await backupCopy(target.path, settings.file.backupSuffix);
      bytes = await readFileBytes(target.path);
    } else if (target.handle) {
      const file = await target.handle.getFile();
      if (file.size > 0) bytes = new Uint8Array(await file.arrayBuffer());
    }
    if (!bytes?.length) return;
    const previous = parseContainer(bytes);
    await recordSaveGeneration({
      content: previous.content,
      docSettings: previous.settings ?? null,
      fileName: target.name ?? null,
    });
  } catch {
    /* previous file missing, foreign or unreadable — the save proceeds */
  }
}

function downloadBytes(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function initFileSystem({ getEditor, mountEditor }) {
  const showError = (message) =>
    showDialog({
      title: t('file.errorTitle'),
      message,
      defaultValue: 'ok',
      buttons: [{ label: t('dialog.ok'), value: 'ok', primary: true }],
    });

  /** True when it is safe to replace the current document. */
  async function confirmDiscardIfDirty() {
    if (!appState.get('documentDirty')) return true;
    const choice = await showDialog({
      title: t('file.confirmDiscardTitle'),
      message: t('file.confirmDiscardMessage'),
      defaultValue: 'cancel',
      buttons: [
        { label: t('file.discard'), value: 'discard' },
        { label: t('file.cancel'), value: 'cancel', primary: true },
      ],
    });
    return choice === 'discard';
  }

  function afterSaved(name) {
    appState.set('documentDirty', false);
    appState.emit('document:baseline');
    appState.set('autosave', { status: 'file-saved', time: Date.now(), name });
  }

  /* Recent files (handle-based, therefore FS-Access only) ----------------- */

  async function loadRecents() {
    if (!supportsRecents) return [];
    try {
      const db = await getDb();
      return (await db.get(settings.autosave.storeName, settings.file.recentKey)) ?? [];
    } catch {
      return [];
    }
  }

  async function addRecent(name, ref) {
    if (!supportsRecents || !(ref?.handle || ref?.path)) return;
    try {
      const db = await getDb();
      const list =
        (await db.get(settings.autosave.storeName, settings.file.recentKey)) ?? [];
      const sameEntry = async (entry) => {
        if (entry.name !== name) return false;
        if (ref.path || entry.path) return entry.path === ref.path;
        if (ref.handle && typeof entry.handle?.isSameEntry === 'function') {
          return entry.handle.isSameEntry(ref.handle);
        }
        return true;
      };
      const filtered = [];
      for (const entry of list) {
        if (!(await sameEntry(entry))) filtered.push(entry);
      }
      filtered.unshift({
        name,
        handle: ref.handle ?? null,
        path: ref.path ?? null,
        openedAt: Date.now(),
      });
      await db.put(
        settings.autosave.storeName,
        filtered.slice(0, settings.file.maxRecent),
        settings.file.recentKey
      );
      appState.emit('recents:changed');
    } catch (error) {
      console.warn('[recents] could not update list', error);
    }
  }

  /* Actions ---------------------------------------------------------------- */

  async function newDocument() {
    if (!(await confirmDiscardIfDirty())) return;
    mountEditor(null);
    replaceDocSettings(null);
    appState.set('file', null);
    appState.set('autosave', null);
    await deleteSnapshot();
  }

  async function mountFromBytes(bytes, name, ref = null) {
    let documentJson;
    try {
      documentJson = parseContainer(bytes);
    } catch (error) {
      // v1 freeze promise: a document from a NEWER format generation is not
      // "invalid" — it needs a newer Simplex. Distinct message, distinct fix.
      const key = error?.message === 'unsupported-version'
        ? 'file.formatTooNew'
        : 'file.invalidFormat';
      await showError(t(key));
      return false;
    }
    mountEditor(documentJson.content);
    replaceDocSettings(documentJson.settings);
    appState.set('file', {
      name,
      handle: ref?.handle ?? null,
      path: ref?.path ?? null,
    });
    appState.set('autosave', null);
    await deleteSnapshot();
    await addRecent(name, ref);
    return true;
  }

  async function openDocument() {
    if (!(await confirmDiscardIfDirty())) return;
    try {
      if (isTauri) {
        const path = await pickOpenPath(t('file.pickerType'), settings.file.openExtensions);
        if (!path) return; // cancelled
        await mountFromBytes(await readFileBytes(path), fileNameOf(path), { path });
      } else if (supportsFileSystemAccess) {
        const [handle] = await window.showOpenFilePicker({
          types: openPickerTypes(),
          multiple: false,
        });
        const file = await handle.getFile();
        await mountFromBytes(await file.arrayBuffer(), file.name, { handle });
      } else {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = settings.file.openExtensions.join(',');
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          if (file) await mountFromBytes(await file.arrayBuffer(), file.name);
        });
        input.click();
      }
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.error('[file] open failed', error);
        await showError(t('file.openError'));
      }
    }
  }

  async function openRecent(entry) {
    if (!(await confirmDiscardIfDirty())) return;
    try {
      if (entry.path) {
        // Tauri: the persisted-scope plugin keeps picked paths readable
        // across app restarts — no permission dance needed.
        await mountFromBytes(
          await readFileBytes(entry.path),
          fileNameOf(entry.path),
          { path: entry.path }
        );
        return;
      }
      if (!(await ensurePermission(entry.handle))) return;
      const file = await entry.handle.getFile();
      await mountFromBytes(await file.arrayBuffer(), file.name, { handle: entry.handle });
    } catch (error) {
      console.error('[file] open recent failed', error);
      await showError(t('file.openError'));
    }
  }

  /** Container bytes of the CURRENT document (built after the dialog — the
   *  chosen type decides whether these are needed at all). */
  function buildContainerBytes() {
    return createContainer({
      content: getEditor().getJSON(),
      title: stripDocExtension(appState.get('file')?.name) ?? null,
      docSettings: appState.get('docSettings'),
    });
  }

  const isDocxTarget = (nameOrPath) =>
    String(nameOrPath).toLowerCase().endsWith(settings.file.docxExtension);

  /** Save As with a format choice right in the dialog's type dropdown:
   *  Simplex-Dokument (.sdoc, preselected) or Word (.docx). Picking Word
   *  acts as an EXPORT — a lossy format must never become the silent save
   *  target, so file state, dirty flag and window title stay on the .sdoc
   *  side. The suggested name carries NO extension: the chosen type appends
   *  it (a prefilled ".sdoc" would survive switching the type to Word). */
  async function saveAs() {
    const baseName =
      stripDocExtension(appState.get('file')?.name) ?? t('file.untitled');
    try {
      if (isTauri) {
        let path = await pickSavePath(baseName, [
          { name: t('file.pickerType'), extension: settings.file.extension },
          { name: t('file.docxPickerType'), extension: settings.file.docxExtension },
        ]);
        if (!path) return false; // cancelled
        if (isDocxTarget(path)) {
          const { buildDocxBlob } = await import('./docxExport.js');
          const blob = await buildDocxBlob(getEditor);
          await writeFileBytes(path, new Uint8Array(await blob.arrayBuffer()));
          return true;
        }
        if (!path.toLowerCase().endsWith(settings.file.extension)) {
          path += settings.file.extension;
        }
        await backupBeforeOverwrite({ path, name: fileNameOf(path) });
        await writeFileBytes(path, buildContainerBytes());
        const name = fileNameOf(path);
        appState.set('file', { name, handle: null, path });
        afterSaved(name);
        await addRecent(name, { path });
      } else if (supportsFileSystemAccess) {
        const handle = await window.showSaveFilePicker({
          suggestedName: baseName,
          types: saveAsPickerTypes(),
        });
        if (isDocxTarget(handle.name)) {
          const { buildDocxBlob } = await import('./docxExport.js');
          const writable = await handle.createWritable();
          await writable.write(await buildDocxBlob(getEditor));
          await writable.close();
          return true;
        }
        await backupBeforeOverwrite({ handle, name: handle.name });
        await writeToHandle(handle, buildContainerBytes());
        appState.set('file', { name: handle.name, handle, path: null });
        afterSaved(handle.name);
        await addRecent(handle.name, { handle });
      } else {
        // Download fallback has no type dropdown — .sdoc here, Word stays
        // available through the export menu entry.
        const name = appState.get('file')?.name ?? untitledFileName();
        downloadBytes(buildContainerBytes(), name);
        appState.set('file', { name, handle: null, path: null });
        afterSaved(name);
      }
      return true;
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.error('[file] save-as failed', error);
        await showError(t('file.saveError'));
      }
      return false;
    }
  }

  async function save() {
    const file = appState.get('file');
    if (!file) return saveAs();

    try {
      if (file.path) {
        const bytes = createContainer({
          content: getEditor().getJSON(),
          title: stripDocExtension(file.name),
          docSettings: appState.get('docSettings'),
        });
        await backupBeforeOverwrite({ path: file.path, name: file.name });
        await writeFileBytes(file.path, bytes);
        afterSaved(file.name);
        return true;
      }
      if (file.handle) {
        if (!(await ensurePermission(file.handle))) return saveAs();
        const bytes = createContainer({
          content: getEditor().getJSON(),
          title: stripDocExtension(file.name),
          docSettings: appState.get('docSettings'),
        });
        await backupBeforeOverwrite({ handle: file.handle, name: file.name });
        await writeToHandle(file.handle, bytes);
        afterSaved(file.name);
        return true;
      }
      if (isTauri || supportsFileSystemAccess) {
        // Name known but no target (e.g. restored session) → pick one.
        return saveAs();
      }
      const bytes = createContainer({
        content: getEditor().getJSON(),
        title: stripDocExtension(file.name),
        docSettings: appState.get('docSettings'),
      });
      downloadBytes(bytes, file.name);
      afterSaved(file.name);
      return true;
    } catch (error) {
      console.error('[file] save failed', error);
      await showError(t('file.saveError'));
      return false;
    }
  }

  return { newDocument, openDocument, openRecent, save, saveAs, loadRecents, confirmDiscardIfDirty };
}
