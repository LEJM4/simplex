# Simplex

A fast, lean text editor that replaces Word for everyday writing: write,
format, save locally, exchange DOCX, print to PDF with headers, footers and
page numbers. **Offline, no cloud, no account.** Not a Word clone: the goal
is the 20% of features that cover 95% of real documents.

> Deutsche Fassung: [README.de.md](README.de.md)

## What it does

- **Writing & formatting:** bold/italic/underline/strikethrough, headings
  H1–H3, block quote, lists, alignment including justified, font family and
  size, text color and highlighter, line and paragraph spacing (free values
  too)
- **Never lose text:** debounced autosave to IndexedDB with recovery on the
  next start, plus rotating backup generations (about every 10 minutes and
  before every overwrite; the desktop additionally writes a `.bak` file).
  Always available under File → Backups
- **Files:** own `.sdoc` format (readable JSON, see below), new/open/save
  through the File System Access API, recent-files list
- **DOCX in and out:** export via `docx`, import via `mammoth`
- **Print & PDF:** real pages with paper size, margins, header/footer and
  page numbers via paged.js (number format and position per document);
  output through the browser's print dialog
- **Page view:** the editor shows real sheets with header/footer and page
  numbers, splits long paragraphs line by line and follows Word's rules
  (widow/orphan control, headings stay with their text, images and tables
  don't break apart). Pages ↔ continuous via the status bar toggle or in
  Settings ("Document view"); "Page X of Y" sits next to the word count
- **Page setup per document:** paper size (A4/A5/Letter) and orientation,
  margins, header/footer, page numbers, default font, "different first
  page" (letterhead: its own texts, no number on page 1)
- **Manual page break:** Ctrl+Enter or toolbar button; travels in `.sdoc`
  and DOCX as a real Word page break
- **Everyday things:** tables, images (insert, drag, resize, text wrap),
  find & replace, word/character count, spell check (browser native)
- **Interface:** English/German switchable live, light/dark/system theme,
  zoom 50–200%, a single-row toolbar (whatever doesn't fit moves into the
  ⋯ overflow menu), a full keyboard-shortcut overview (File → Keyboard
  shortcuts)
- **Inspect mode** (Settings): shows the font size next to every paragraph,
  highlights deviating sizes and spacing and marks deviations right in the
  text. Useful for finding accidental formatting changes fast

## Get Simplex

**In the browser:** https://lejm4.github.io/simplex/ — nothing to install.
The page loads the app, after that everything happens locally: documents
live as files on your own machine, there is no server, no account, no
telemetry. Installable as an app from Chrome/Edge (see "Install as an
app").

**Windows desktop:** download the installer from the releases page:
https://github.com/LEJM4/simplex/releases/latest. On first run Windows
shows "Windows protected your PC" with "Unknown publisher" (Microsoft
Defender SmartScreen). The reason: the installer isn't signed, and a
code-signing certificate costs recurring money that is out of proportion
for a free one-person project. The way through: **"More info" → "Run
anyway".** To verify the download, every release lists the installer's
SHA-256 checksum (PowerShell: `Get-FileHash .\Simplex_…_x64-setup.exe`).

**Updates:** the browser/PWA version updates itself. While you are online,
every restart loads the latest version; offline, the last loaded state
starts. The desktop app has **no** auto-update: new version = run a new
installer from the releases page. Settings, the recent-files list and your
documents survive the update (documents are plain files on disk anyway).

## Supported environments

- **Chrome/Edge (primary):** full feature set including real file saving
  (File System Access API), PWA install and file double-click with the
  installed PWA
- **Firefox (secondary):** fully usable with documented fallbacks — open
  via the file picker, save as download, no recent-files list, no PWA file
  association
- **Windows desktop (Tauri installer):** full feature set plus native
  dialogs, direct Ctrl+S to the file path, `.bak` backup copy and Explorer
  double-click; tested on Windows 10/11. Windows only — macOS/Linux build
  from source but are untested and come without ready-made packages.
- **Safari:** untested
- **Spell check:** uses the browser's dictionaries. Chrome only checks
  languages enabled under *Settings → Languages → Spell check*; if German
  is missing there, German text won't be checked.
- **Dark mode:** restyles the app chrome; the sheet deliberately stays
  white paper (WYSIWYG for print and DOCX)

## The `.sdoc` file format

A readably formatted JSON file (UTF-8): `formatVersion`, metadata, document
settings (margins, header/footer, page numbers, paper size, default font,
first page) and the content as Tiptap JSON. Images are stored as Base64
inside the document. That is a deliberate trade: transparency — readable in
any text editor, diffable, scriptable, recoverable without Simplex in an
emergency — against file size for image-heavy documents.

**Format promise (v1, frozen):** `formatVersion: 1` is frozen since the
release; every future Simplex version reads v1 files. Format changes would
only come as a new `formatVersion` with its own read path. If an older
Simplex opens such a file, it says so clearly ("comes from a newer version,
please update") instead of wrongly calling the file invalid. Files from
version 0.3.0 (ZIP container) still open via magic-byte detection; saving
is JSON only.

## What to expect from DOCX exchange

**Export (Simplex → Word):** matches the feature set. Formats, colors,
fonts, tables, images, links, indents, spacing, paper size and orientation,
header/footer with page numbers including "different first page" all travel
along.

**Import (Word → Simplex):** faithful in structure and text. Headings,
lists, character formats, tables, images, links, super/subscript, indents,
manual page breaks and the document's default font arrive. Lost by design:
colors, deviating fonts and sizes inside the text, paragraph alignment and
the paper size (imports start as A4 portrait). A dialog points out
formatting that couldn't be mapped. In short: content yes, pixel-perfect
layout no.

## Quick start (development)

Requirement: Node.js ≥ 20.19

```bash
npm ci
npm run dev       # development with hot reload
npm run build     # production build to dist/
npm run preview   # inspect the built state locally
```

## Deployment (GitHub Pages)

Every push to `main` runs through `.github/workflows/deploy.yml`: first the
test gate (both suites must be green), then a build with a base path the
workflow **computes from the repository name** (project repo →
`/<name>/app/`, a `<user>.github.io` repo → `/app/`) — renaming the repo
needs no code change. The site is assembled as the landing page on the root
plus the app under `/app/` and deployed in Pages' Actions mode (no `docs/`
folder, no Jekyll). One-time repo check: Settings → Pages → Source:
**GitHub Actions**. Locally nothing changes: `npm run build`, the dev
server and the desktop build all run on `/`.

## Install as an app (PWA)

In the built state (`npm run build` + `npm run preview`, or on a web
server) Simplex installs from Chrome/Edge (address bar → "Install"): its
own window, an icon in the start menu/dock, works offline. Offline
capability starts with the second visit (the service worker takes over only
after its installation). Updates: while online, every restart loads the
latest version (navigation is network-first — the app can't silently go
stale). Double-clicking `.sdoc` files opens the installed app directly
(file handling, Chrome/Edge). The service worker is deliberately disabled
in the dev server (`npm run dev`).

## Desktop app (Tauri)

The same code base runs as a native desktop program. One-time requirements:
**Windows:** Rust via [rustup](https://rustup.rs) and the Visual Studio
Build Tools ("Desktop development with C++"); the WebView2 runtime is
preinstalled on Windows 10/11. **Linux:** `build-essential`,
`libwebkit2gtk-4.1-dev`, `libssl-dev`. **macOS:** Xcode Command Line Tools.

```bash
npm ci
npm run desktop:dev     # development (the first Rust build takes a few minutes)
npm run desktop:build   # installer/binary → src-tauri/target/release/bundle/
```

On the desktop, open/save and the DOCX exchange use native dialogs, Ctrl+S
writes straight to the known path, and the recent-files list survives
restarts (persisted scope). Double-clicking `.sdoc` in the file manager
opens the installed app (the installer registers the association; on macOS
the hand-over isn't wired yet — parked with the other Mac topics). If the
app is already running, the existing window takes the file instead of a
second instance. Window size and position are remembered. The service
worker is deliberately disabled on the desktop.

**Desktop function test** (confirmed on the target machine under Windows,
2026-07-28 — keep as a regression checklist after changes):

1. Type, Ctrl+S → native dialog, the file is on disk
2. Close the app, restart → the recent-files list is there, its entry opens
   without asking
3. Ctrl+S on a known file → saves directly, no dialog
4. Drag an image from Explorer into the document → it is inserted
5. **Ctrl+P** → after the preview, the system print dialog opens ("Save as
   PDF" included)
6. The title bar shows "• Name – Simplex" for unsaved changes
7. File → Export as Word → native dialog, a `.docx` is created and opens in
   Word
8. File → Import Word → native dialog, the content appears in the editor
9. (installed app) Double-click a `.sdoc` in Explorer → the app starts with
   the file; a second double-click while it runs → the same window is
   focused and opens the file (no second instance)
10. Move/resize the window, close and restart → the geometry is restored

## Languages

English is the default; German is maintained in parallel and switchable
live under Settings. Adding another language: create a language file in
`src/i18n/`, register it in `src/i18n/index.js`, add its native name in
`src/config/settings.js`. A dev check warns in the console when keys are
missing between languages.

## Project structure

```
src/
  config/settings.js    all tunables — nothing is hardcoded
  core/                 Tiptap setup, app state/event bus, theme, extensions
  i18n/                 t() helper + one file per language
  ui/                   toolbar, status bar, dialogs, search panel
  io/                   .sdoc, autosave, DOCX import/export, print/PDF
  styles/               app chrome, editor sheet, print
```

## Development guardrails

All library versions are pinned exactly (Tiptap 3.29.1, see
`package.json`). Every visible UI string goes through `t('key')`. Modules
talk via the central event bus (`core/appState.js`), never through direct
cross-references. Undo/redo runs exclusively through the Tiptap history —
no feature may bypass it. Changes are recorded in the
[CHANGELOG](CHANGELOG.md) (kept in German, the project's working language).

**Performance:** `npm run longdoc` generates a reproducible test document
(`beispiele/langtest.sdoc`, ~120 A4 pages, 42,000+ words), `npm run bench`
measures the hot paths (open, counting, autosave snapshot, search) headless
in Node. The live count is throttled (`settings.statusbar.countUpdateMs`)
and only runs on content changes; at 120 pages one pass costs about 4 ms.
Page computation benches at 0.39 ms for a full document (132 pages) and
0.01 ms for the typing case, because the scheduler starts at the change
position and converges into the old break list; the DOM measuring itself
can only be judged in a browser.

**Tests:** `npm run test:pages` checks the page-break rule core headless
(16 rule cases) plus editor, DOCX, backups, paper-size, first-page,
format-gate, pending-marks, margin-click and Pages-base integration (142
checks in total). `npm run test:ui` runs the chrome structure smokes (98
checks): toolbar and status bar build in de and en without console output,
every button fires its command against a real editor, dialogs open and
close, disabled states hold (empty undo history, indent limits, page breaks
inside tables). Deliberately no layout checks — jsdom has no layout engine,
every rect is 0×0. The test helpers `jsdom` and `fake-indexeddb` are
exactly pinned devDependencies since 0.29.2: `npm ci` installs them, and
the lockfile freezes their transitive packages too (lesson from
0.29.0/0.29.1, when a same-day release of jsdom's selector engine broke the
harness on fresh installs).

## License

Simplex is free software under the **GNU General Public License v3.0**
(see [LICENSE](LICENSE)): using, studying, changing and passing it on is
explicitly welcome. Whoever distributes Simplex, modified or not, must make
the source available under the same license.

Copyright (C) 2026 LEJM4

All libraries used are under permissive, GPL-compatible licenses (MIT,
BSD-2-Clause, ISC, Apache-2.0).
