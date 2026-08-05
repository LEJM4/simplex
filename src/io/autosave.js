// src/io/autosave.js
// ---------------------------------------------------------------------------
// Crash safety net: a debounced snapshot of the whole document (Tiptap JSON)
// is written into IndexedDB while there are unsaved changes. On app start a
// found snapshot means the last session ended without saving — main.js asks
// the user (restore dialog) and passes the content into the fresh editor's
// constructor, so restoring is never an undoable transaction.
//
// Lifecycle: 'document:updated' schedules a write; 'document:baseline'
// (fired after save / open / new) cancels pending writes and deletes the
// snapshot — a cleanly saved session leaves nothing behind.
// ---------------------------------------------------------------------------

import { settings } from '../config/settings.js';
import { appState } from '../core/appState.js';
import { getDb } from './db.js';

/** Load the last snapshot ({ content, savedAt, fileName, … }) or null. */
export async function loadSnapshot() {
  try {
    const db = await getDb();
    const snapshot = await db.get(
      settings.autosave.storeName,
      settings.autosave.snapshotKey
    );
    return snapshot ?? null;
  } catch (error) {
    console.error('[autosave] could not load snapshot', error);
    return null;
  }
}

/** Remove the crash-recovery snapshot. Never throws. */
export async function deleteSnapshot() {
  try {
    const db = await getDb();
    await db.delete(settings.autosave.storeName, settings.autosave.snapshotKey);
  } catch (error) {
    console.error('[autosave] could not delete snapshot', error);
  }
}

/* Generations (feature 1, 0.25.0) ----------------------------------------------
   Time-spaced safety copies BESIDE the continuously updated crash snapshot.
   Two writers feed one pool:
   - the debounced autosave promotes its snapshot when the newest generation
     is at least `generationMinutes` old (kind 'auto');
   - io/fileSystem.js records the previous ON-DISK state right before an
     overwrite (kind 'saved'), guarded by `savedMinGapMs` against spamming.
   The pool is pruned to `maxGenerations`, oldest first. Keys carry the
   zero-padded timestamp, so lexicographic key order IS chronological order.
   All functions take `now` as a parameter for headless testing. */

const generationKey = (savedAt) =>
  `${settings.autosave.generationPrefix}${String(savedAt).padStart(15, '0')}`;

const generationRange = () =>
  IDBKeyRange.bound(
    settings.autosave.generationPrefix,
    `${settings.autosave.generationPrefix}\uffff`
  );

const generationKeys = (db) =>
  db.getAllKeys(settings.autosave.storeName, generationRange());

async function newestGenerationAt(db) {
  const keys = await generationKeys(db);
  if (keys.length === 0) return 0;
  const newest = keys[keys.length - 1];
  return Number.parseInt(newest.slice(settings.autosave.generationPrefix.length), 10) || 0;
}

async function pruneGenerations(db) {
  const keys = await generationKeys(db);
  const excess = keys.length - settings.autosave.maxGenerations;
  for (let index = 0; index < excess; index += 1) {
    await db.delete(settings.autosave.storeName, keys[index]);
  }
}

/** Promote a snapshot record to an 'auto' generation when the spacing allows.
    Returns whether a generation was written. */
export async function rotateGenerations(record, now = Date.now()) {
  try {
    const db = await getDb();
    const newest = await newestGenerationAt(db);
    if (now - newest < settings.autosave.generationMinutes * 60000) return false;
    await db.put(
      settings.autosave.storeName,
      { ...record, kind: 'auto', savedAt: now },
      generationKey(now)
    );
    await pruneGenerations(db);
    return true;
  } catch (error) {
    console.error('[autosave] rotation failed', error);
    return false;
  }
}

/** Record the previous on-disk state ('saved' generation) right before an
    overwrite. Returns whether a generation was written. */
export async function recordSaveGeneration(record, now = Date.now()) {
  try {
    const db = await getDb();
    const newest = await newestGenerationAt(db);
    if (now - newest < settings.autosave.savedMinGapMs) return false;
    await db.put(
      settings.autosave.storeName,
      {
        formatVersion: 1,
        appVersion: settings.app.version,
        kind: 'saved',
        savedAt: now,
        ...record,
      },
      generationKey(now)
    );
    await pruneGenerations(db);
    return true;
  } catch (error) {
    console.error('[autosave] pre-save backup failed', error);
    return false;
  }
}

/** Every stored stand, newest first: the crash snapshot (kind 'current')
    when present, then the generations. Records include their store key. */
export async function listSnapshots() {
  try {
    const db = await getDb();
    const list = [];
    const current = await db.get(
      settings.autosave.storeName,
      settings.autosave.snapshotKey
    );
    if (current?.content) {
      list.push({ ...current, kind: 'current', key: settings.autosave.snapshotKey });
    }
    const keys = await generationKeys(db);
    for (const key of keys.reverse()) {
      const record = await db.get(settings.autosave.storeName, key);
      if (record?.content) list.push({ ...record, key });
    }
    return list;
  } catch (error) {
    console.error('[autosave] could not list snapshots', error);
    return [];
  }
}

/**
 * Wire debounced autosaving to the (replaceable) editor.
 * State key 'autosave' drives the status bar:
 *   { status: 'pending' | 'saved' | 'restored' | 'file-saved' | 'error',
 *     time?: number, name?: string } | null
 */
export function initAutosave(getEditor) {
  let timer = null;

  const write = async () => {
    timer = null;
    try {
      const record = {
        formatVersion: 1,
        appVersion: settings.app.version,
        savedAt: Date.now(),
        fileName: appState.get('file')?.name ?? null,
        docSettings: appState.get('docSettings') ?? null,
        content: getEditor().getJSON(),
      };
      const db = await getDb();
      await db.put(settings.autosave.storeName, record, settings.autosave.snapshotKey);
      appState.set('autosave', { status: 'saved', time: Date.now() });
      // Fire-and-forget: the rotation must never delay the crash snapshot.
      rotateGenerations(record);
    } catch (error) {
      console.error('[autosave] write failed', error);
      appState.set('autosave', { status: 'error' });
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    appState.set('autosave', { status: 'pending' });
    timer = setTimeout(write, settings.autosave.debounceMs);
  };

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  // Flush a pending snapshot immediately when the page is being hidden or
  // closed ("close the tab" must never lose more than the debounce window).
  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      write();
    }
  };

  appState.on('document:updated', schedule);
  appState.on('document:baseline', () => {
    cancel();
    deleteSnapshot();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);

  return { flush };
}
