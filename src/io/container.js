// src/io/container.js
// ---------------------------------------------------------------------------
// The .sdoc file format: ONE pretty-printed JSON file
//   { formatVersion, meta, settings, content (Tiptap JSON) }
// Deliberately transparent — inspectable, diffable and scriptable without
// any unpacking. Images (phase 5) will be embedded as Base64 data URLs.
//
// Legacy: early 0.3.0 builds wrapped the same JSON in a ZIP container.
// parseContainer() sniffs the magic bytes ("PK" = ZIP) and still reads those
// files; new saves are always plain JSON. Should a binary container ever
// come back (v2), the same sniffing keeps every old file openable.
// ---------------------------------------------------------------------------

import { unzipSync, strFromU8 } from 'fflate';

import { settings } from '../config/settings.js';

export const FORMAT_VERSION = 1;

/** Build .sdoc bytes (UTF-8 JSON) from the current document. */
export function createContainer({ content, title = null, docSettings = null }) {
  const documentJson = {
    formatVersion: FORMAT_VERSION,
    meta: {
      app: settings.app.name,
      appVersion: settings.app.version,
      savedAt: new Date().toISOString(),
      title,
    },
    settings: docSettings ?? {}, // document-level settings (margins, header/footer)
    content,
  };

  return new TextEncoder().encode(JSON.stringify(documentJson, null, 2));
}

function validated(documentJson) {
  if (typeof documentJson.formatVersion !== 'number' || !documentJson.content) {
    throw new Error('invalid-container');
  }
  if (documentJson.formatVersion > FORMAT_VERSION) {
    throw new Error('unsupported-version');
  }
  return documentJson;
}

/**
 * Parse .sdoc bytes (plain JSON, or the legacy ZIP envelope). Throws
 * Error('invalid-container') for unreadable input and
 * Error('unsupported-version') for documents from a newer format generation.
 */
export function parseContainer(bytes) {
  const u8 = new Uint8Array(bytes);

  // Legacy ZIP container ("PK\x03\x04").
  if (u8[0] === 0x50 && u8[1] === 0x4b) {
    let raw;
    try {
      raw = unzipSync(u8)['document.json'];
    } catch {
      throw new Error('invalid-container');
    }
    if (!raw) throw new Error('invalid-container');
    try {
      return validated(JSON.parse(strFromU8(raw)));
    } catch (error) {
      if (error.message === 'unsupported-version') throw error;
      throw new Error('invalid-container');
    }
  }

  try {
    return validated(JSON.parse(new TextDecoder().decode(u8)));
  } catch (error) {
    if (error.message === 'unsupported-version') throw error;
    throw new Error('invalid-container');
  }
}
