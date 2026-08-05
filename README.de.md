# Simplex

Ein schneller, schlanker Texteditor als Alltags-Ersatz für Word:
schreiben, formatieren, lokal speichern, DOCX austauschen, als PDF mit
Kopf-/Fußzeilen und Seitenzahlen drucken. **Offline, ohne Cloud, ohne
Anmeldung.** Kein Word-Klon — Ziel sind die 20 % der Funktionen, die 95 %
der Dokumente abdecken.

> English version (main): [README.md](README.md)

## Funktionsumfang

- **Schreiben & Formatieren:** Fett/Kursiv/Unterstrichen/Durchgestrichen,
  Überschriften H1–H3, Zitat, Listen, Ausrichtung inkl. Blocksatz, Schriftart
  und -größe, Textfarbe und Marker, Zeilen- und Absatzabstand (auch freie Werte)
- **Nie Text verlieren:** debounced Autosave in IndexedDB mit
  Wiederherstellung beim nächsten Start; dazu rotierende Sicherungsstände
  (ca. alle 10 Minuten und vor jedem Überschreiben, Desktop zusätzlich mit
  `.bak`-Datei) — jederzeit erreichbar über Datei → Sicherungen
- **Dateien:** eigenes Format `.sdoc` (lesbares JSON, siehe unten),
  Neu/Öffnen/Speichern über die File System Access API, „Zuletzt geöffnet“-Liste
- **DOCX rein und raus:** Export über `docx`, Import über `mammoth`
- **Druck & PDF:** echte Seiten mit Format, Rändern, Kopf-/Fußzeile und
  Seitenzahlen über paged.js (Zahlenformat und Position pro Dokument
  wählbar); Ausgabe über den Browser-Druckdialog
- **Seitenansicht:** der Editor zeigt echte Blätter mit Kopf-/Fußzeile und
  Seitenzahlen, teilt lange Absätze zeilengenau und hält sich an die
  Word-Regeln (Absatzkontrolle, Überschrift bleibt bei ihrem Text, Bilder
  und Tabellen brechen nicht auf) — Seiten ↔ Fortlaufend per Umschalter in
  der Statusleiste oder in den Einstellungen („Dokumentansicht“); „Seite X
  von Y“ steht links neben der Wortzählung
- **Seite einrichten pro Dokument:** Papierformat (A4/A5/Letter) und
  Ausrichtung, Ränder, Kopf-/Fußzeile, Seitenzahlen, Standardschrift,
  „Erste Seite anders“ (Briefkopf: eigene Texte, keine Zahl auf Seite 1)
- **Manueller Seitenumbruch:** Strg+Enter oder Toolbar-Button, reist im
  `.sdoc` und in der DOCX als echter Word-Umbruch mit
- **Alltag:** Tabellen, Bilder (einfügen, ziehen, Größe, Umfluss),
  Suchen & Ersetzen, Wort-/Zeichenzählung, Rechtschreibung (Browser-nativ)
- **Oberfläche:** Deutsch/Englisch live umschaltbar, Hell/Dunkel/System,
  Zoom 50–200 %, einzeilige Toolbar (was nicht passt, wandert ins
  ⋯-Überlaufmenü), vollständige Tastenkürzel-Übersicht (Datei → Tastenkürzel)
- **Inspektionsmodus** (Einstellungen): zeigt an jedem Absatz die
  Schriftgröße, hebt abweichende Größen und Abstände hervor und markiert
  Abweichungen direkt im Text — zum schnellen Finden versehentlicher
  Formatierungsänderungen

## Simplex bekommen

**Im Browser:** https://lejm4.github.io/simplex/ — nichts zu installieren. Die Seite lädt die App,
danach passiert alles lokal: Dokumente bleiben als Dateien auf dem eigenen
Rechner, es gibt keinen Server, kein Konto, keine Telemetrie. Aus Chrome/Edge
heraus als App installierbar (siehe „Als App installieren“).

**Windows-Desktop:** Installer von der Releases-Seite laden: https://github.com/LEJM4/simplex/releases/latest.
Beim ersten Start des Installers zeigt Windows „Der Computer wurde durch
Windows geschützt“ mit „Unbekannter Herausgeber“ (Microsoft Defender
SmartScreen). Grund: Der Installer ist nicht signiert — ein
Code-Signing-Zertifikat kostet laufend Geld und steht für ein freies
Einzelprojekt in keinem Verhältnis. Weg: **„Weitere Informationen“ →
„Trotzdem ausführen“.** Zum Gegenprüfen nennt jeder Release die
SHA-256-Prüfsumme des Installers (PowerShell:
`Get-FileHash .\Simplex_…_x64-setup.exe`).

**Updates:** Die Browser-/PWA-Fassung aktualisiert sich selbst — solange man
online ist, lädt jeder Neustart automatisch die neueste Version; offline
startet der zuletzt geladene Stand. Die Desktop-App hat **kein**
Auto-Update: neue Version = neuen Installer von der Releases-Seite
ausführen. Einstellungen, „Zuletzt geöffnet“ und Dokumente bleiben dabei
erhalten (Dokumente sind ohnehin normale Dateien auf der Platte).

## Unterstützte Umgebungen

- **Chrome/Edge (primär):** voller Funktionsumfang inkl. echtem
  Datei-Speichern (File System Access API), PWA-Installation und
  Datei-Doppelklick bei installierter PWA
- **Firefox (sekundär):** voll nutzbar mit dokumentierten Fallbacks — Öffnen
  über die Dateiauswahl, Speichern als Download, keine „Zuletzt
  geöffnet“-Liste, keine PWA-Dateizuordnung
- **Windows-Desktop (Tauri-Installer):** voller Funktionsumfang plus native
  Dialoge, direktes Strg+S auf den Dateipfad, `.bak`-Sicherungskopie und
  Explorer-Doppelklick; getestet unter Windows 10/11. Nur Windows —
  macOS/Linux sind aus dem Quelltext baubar, aber ungetestet und ohne
  fertige Pakete.
- **Safari:** ungetestet
- **Rechtschreibung:** nutzt die Wörterbücher des Browsers. Chrome prüft nur
  Sprachen, die unter *Einstellungen → Sprachen → Rechtschreibprüfung*
  aktiviert sind — fehlt dort Deutsch, werden deutsche Texte nicht geprüft.
- **Dark Mode:** gestaltet den App-Rahmen um; das Blatt bleibt bewusst weißes
  Papier (WYSIWYG für Druck und DOCX)

## Dateiformat `.sdoc`

Eine lesbar formatierte JSON-Datei (UTF-8): `formatVersion`, Metadaten,
Dokument-Einstellungen (Ränder, Kopf-/Fußzeile, Seitenzahlen, Seitenformat,
Standardschrift, erste Seite) und der Inhalt als Tiptap-JSON. Bilder liegen
als Base64 im Dokument. Das ist ein bewusster Tausch: Transparenz — mit
jedem Texteditor lesbar, diff- und skriptbar, im Notfall ohne Simplex
rettbar — gegen Dateigröße bei bildlastigen Dokumenten.

**Format-Versprechen (v1, eingefroren):** `formatVersion: 1` ist seit der
Veröffentlichung eingefroren — jede künftige Simplex-Version liest
v1-Dateien. Format-Änderungen kämen nur als neue `formatVersion` mit
eigener Lese-Weiche; öffnet eine ältere Simplex-Version eine solche Datei,
sagt sie das klar („stammt aus einer neueren Version, bitte aktualisieren“)
statt sie fälschlich für ungültig zu erklären. Dateien aus Version 0.3.0
(ZIP-Container) werden per Magic-Byte-Erkennung weiterhin geöffnet,
gespeichert wird ausschließlich JSON.

## Erwartungen an den DOCX-Austausch

**Export (Simplex → Word):** deckungsgleich mit dem Funktionsumfang —
Formate, Farben, Schriften, Tabellen, Bilder, Links, Einzüge, Abstände,
Seitenformat und -ausrichtung, Kopf-/Fußzeile mit Seitenzahlen inklusive
„Erste Seite anders“ reisen mit.

**Import (Word → Simplex):** Struktur- und Texttreue — Überschriften,
Listen, Zeichenformate, Tabellen, Bilder, Links, Hoch-/Tiefstellung,
Einzüge, manuelle Seitenumbrüche und die Standardschrift des Dokuments
kommen an. Konzeptbedingt verloren gehen: Farben, abweichende
Schriften/-größen im Text, Absatz-Ausrichtung und das Seitenformat (der
Import startet als A4 hoch) — ein Dialog weist auf nicht abbildbare
Formatierungen hin. Kurz: Inhalt ja, pixelgenaues Layout nein.

## Schnellstart (Entwicklung)

Voraussetzung: Node.js ≥ 20.19

```bash
npm ci
npm run dev       # Entwicklung mit Hot-Reload
npm run build     # Produktions-Build nach dist/
npm run preview   # gebauten Stand lokal ansehen
```

## Veröffentlichung (GitHub Pages)

Jeder Push auf `main` läuft durch `.github/workflows/deploy.yml`: erst das
Test-Gate (beide Suiten müssen grün sein), dann der Build mit einem
Basis-Pfad, den der Workflow **aus dem Repo-Namen berechnet** (Projekt-Repo
→ `/<name>/app/`, ein `<user>.github.io`-Repo → `/app/`) — ein
Repo-Umbenennen braucht keine Code-Änderung. Die Site wird als Landing auf
der Wurzel plus App unter `/app/` zusammengesetzt und im Pages-Actions-Modus
deployt (kein `docs/`-Ordner, kein Jekyll). Einmalig im Repo zu prüfen:
Settings → Pages → Source: **GitHub Actions** (der Workflow versucht das
Aktivieren selbst). Lokal bleibt alles beim Alten: `npm run build`, der
Dev-Server und der Desktop-Build laufen auf `/`.

## Als App installieren (PWA)

Im gebauten Zustand (`npm run build` + `npm run preview` bzw. auf einem
Webserver) lässt sich Simplex aus Chrome/Edge heraus installieren
(Adressleiste → „Installieren“): eigenes Fenster, Icon im Startmenü/Dock,
offline nutzbar. Offline-Fähigkeit greift ab dem zweiten Besuch (der
Service Worker übernimmt erst nach seiner Installation). Updates: solange
man online ist, lädt jeder Neustart automatisch die neueste Version
(Navigation ist network-first — die App kann nicht heimlich veralten).
Doppelklick auf `.sdoc`-Dateien öffnet die installierte App direkt
(File-Handling, Chrome/Edge). Im Dev-Server (`npm run dev`) ist der Service
Worker bewusst deaktiviert.

## Desktop-App (Tauri)

Dieselbe Codebasis läuft als natives Desktop-Programm (Phase 6e). Einmalige
Voraussetzungen: **Windows:** Rust über [rustup](https://rustup.rs) und die
Visual-Studio-Build-Tools („Desktopentwicklung mit C++“); die
WebView2-Runtime ist auf Windows 10/11 vorinstalliert. **Linux:**
`build-essential`, `libwebkit2gtk-4.1-dev`, `libssl-dev`. **macOS:** Xcode
Command Line Tools.

```bash
npm ci
npm run desktop:dev     # Entwicklung (erster Rust-Build dauert einige Minuten)
npm run desktop:build   # Installer/Binary → src-tauri/target/release/bundle/
```

Auf dem Desktop laufen Öffnen/Speichern und der DOCX-Austausch über native
Dialoge, Strg+S schreibt direkt auf den bekannten Pfad, und „Zuletzt
geöffnet“ übersteht Neustarts (persisted-scope). Doppelklick auf `.sdoc`
im Datei-Manager öffnet die installierte App (die Zuordnung registriert der
Installer; auf macOS ist die Übergabe noch nicht verdrahtet — geparkt wie
die übrigen Mac-Themen); läuft die App bereits, übernimmt das laufende
Fenster die Datei statt einer zweiten Instanz. Fenstergröße und -position
werden gemerkt. Der Service Worker ist im Desktop bewusst deaktiviert.

**Funktionstest Desktop** (auf dem Zielrechner unter Windows bestätigt,
2026-07-28 — als Regressions-Checkliste nach Änderungen behalten):
1. Tippen, Strg+S → nativer Dialog, Datei liegt auf der Platte
2. App schließen, neu starten → „Zuletzt geöffnet“ vorhanden, Eintrag öffnet
   ohne Nachfrage
3. Strg+S auf bekannter Datei → speichert direkt, ohne Dialog
4. Bild aus dem Explorer ins Dokument ziehen → wird eingefügt
5. **Strg+P** → nach der Vorschau öffnet sich der System-Druckdialog
   („Als PDF speichern“ inklusive)
6. Titelleiste zeigt „• Name – Simplex“ bei ungespeicherten Änderungen
7. Datei → Als Word exportieren → nativer Dialog, `.docx` entsteht und
   öffnet in Word
8. Datei → Word importieren → nativer Dialog, Inhalt erscheint im Editor
9. (installierte App) Doppelklick auf `.sdoc` im Explorer → App startet
   mit der Datei; erneuter Doppelklick bei laufender App → dasselbe Fenster
   wird fokussiert und öffnet die Datei (keine zweite Instanz)
10. Fenster verschieben/vergrößern, App schließen und neu starten →
    Geometrie ist wiederhergestellt

## Sprachen

Englisch ist Standard (seit 1.0.0), Deutsch wird parallel gepflegt und ist in den Einstellungen live umschaltbar. Eine weitere Sprache
ergänzen: Sprachdatei in `src/i18n/` anlegen, in `src/i18n/index.js`
registrieren, nativen Namen in `src/config/settings.js` eintragen. Ein
Dev-Check warnt in der Konsole, wenn Keys zwischen den Sprachen fehlen.

## Projektstruktur

```
src/
  config/settings.js    alle Tunables — nichts ist hartkodiert
  core/                 Tiptap-Setup, App-State/Event-Bus, Theme, Extensions
  i18n/                 t()-Helfer + eine Datei pro Sprache
  ui/                   Toolbar, Statusleiste, Dialoge, Such-Panel
  io/                   .sdoc, Autosave, DOCX-Import/-Export, Druck/PDF
  styles/               App-Chrome, Editor-Blatt, Druck
```

## Entwicklungs-Leitplanken

Alle Bibliotheksversionen sind exakt gepinnt (Tiptap 3.29.1, siehe
`package.json`). Jeder sichtbare UI-Text läuft über `t('key')`. Module
kommunizieren über den zentralen Event-Bus (`core/appState.js`), nie über
direkte Querverweise. Undo/Redo läuft ausschließlich über die
Tiptap-History — kein Feature darf sie umgehen. Änderungen stehen im
[CHANGELOG](CHANGELOG.md).

**Performance:** `npm run longdoc` erzeugt ein reproduzierbares Testdokument
(`beispiele/langtest.sdoc`, ~120 A4-Seiten, 42 000+ Wörter), `npm run bench`
misst die Hot-Paths (Öffnen, Zählung, Autosave-Snapshot, Suche) headless in
Node. Die Live-Zählung ist gedrosselt (`settings.statusbar.countUpdateMs`)
und läuft nur bei Inhaltsänderungen — bei 120 Seiten kostet ein Durchlauf
rund 4 ms. Die Seitenberechnung liegt im Bench bei 0,39 ms für ein
vollständiges Dokument (132 Seiten) und 0,01 ms für den Tipp-Fall, weil der
Scheduler ab der Änderungsstelle rechnet und in die alte Umbruchliste
konvergiert; die DOM-Messung selbst ist nur im Browser beurteilbar.

**Tests:** `npm run test:pages` prüft headless den Seitenumbruch-Regelkern
(16 Regelfälle) plus Editor-, DOCX-, Sicherungs-, Seitenformat-, Erste-Seite-
Formatgate-, Saat-, Rand-Klick- und Pages-Basis-Integration (142 Checks
gesamt). `npm run test:ui` fährt die Chrome-Struktur-Smokes (98 Checks): Toolbar und Statusleiste bauen in de und
en ohne Konsolenausgabe, jeder Knopf löst sein Kommando am echten Editor aus,
Dialoge öffnen und schließen, Disabled-Zustände (Undo leer, Einzug-Grenzen,
Umbruch in Tabellen). Bewusst ohne Layout-Prüfungen — jsdom hat keine
Layout-Engine, alle Rechtecke sind 0×0. Die Test-Helfer `jsdom` und
`fake-indexeddb` sind seit 0.29.2 exakt gepinnte devDependencies — `npm ci`
installiert sie mit, und das Lockfile friert auch ihre transitiven Pakete ein
(Lehre aus 0.29.0/0.29.1: eine am Prüftag erschienene Version von jsdoms
Selector-Engine brach den Harness auf frischen Installationen).

## Lizenz

Simplex ist freie Software unter der **GNU General Public License v3.0**
(siehe [LICENSE](LICENSE)): nutzen, studieren, ändern und weitergeben ist
ausdrücklich erwünscht — wer Simplex (auch verändert) weitergibt, muss den
Quelltext unter derselben Lizenz verfügbar machen.

Copyright (C) 2026 LEJM4

Alle eingesetzten Bibliotheken stehen unter permissiven, GPL-kompatiblen
Lizenzen (MIT, BSD-2-Clause, ISC, Apache-2.0).
