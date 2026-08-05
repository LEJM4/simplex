// src/io/db.js
// ---------------------------------------------------------------------------
// Shared IndexedDB access (one database, one key-value object store).
// Used by autosave snapshots and the "recent files" list.
// ---------------------------------------------------------------------------

import { openDB } from 'idb';

import { settings } from '../config/settings.js';

let dbPromise = null;

export function getDb() {
  dbPromise ??= openDB(settings.autosave.dbName, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(settings.autosave.storeName)) {
        db.createObjectStore(settings.autosave.storeName);
      }
    },
  });
  return dbPromise;
}
