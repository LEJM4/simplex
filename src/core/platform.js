// src/core/platform.js — platform detection (point 14, WebKit foundation)
// ---------------------------------------------------------------------------
// classifyPlatform() is a PURE function: same input → same output, no global
// access — which makes it the one headless-provable piece of the WebKit work
// (suite part 13). getPlatform() is the cached runtime snapshot read once
// from the real navigator; applyPlatformClasses() exposes the result as
// plat-* classes on <html>, a deterministic hook for CSS and the follow-up
// points 15–17 that media queries alone cannot give (engine truth is not a
// media feature).
//
// Semantics, pinned once and used everywhere:
//   isMac    — the platform's primary modifier is ⌘. Deliberately TRUE for
//              iOS/iPadOS too: a hardware keyboard on an iPad sends Cmd,
//              so the modifier labels of point 17 hang on this flag.
//   isIOS    — iPhone/iPad/iPod, INCLUDING the iPadOS 13+ masquerade that
//              reports platform "MacIntel" — the tell is maxTouchPoints > 1
//              (no Mac has a touch screen).
//   isTouch  — touch input is AVAILABLE (a capability, not "primary input";
//              primary-input decisions stay in CSS via pointer: coarse).
//   isWebKit — the rendering ENGINE is WebKit. Every iOS browser is (CriOS,
//              FxiOS, EdgiOS are WebKit shells by App Store rule); desktop
//              Blink always carries a "Chrome/" or "Edg/" token, Gecko has
//              no "AppleWebKit/". The Tauri WebView2 is Blink and correctly
//              lands outside.
// ---------------------------------------------------------------------------

/**
 * Pure classification. Every field is optional and type-checked so garbage
 * degrades to false instead of throwing.
 *
 * @param {{ platform?: string, userAgent?: string,
 *           maxTouchPoints?: number, hasTouchEvent?: boolean }} input
 * @returns {{ isMac: boolean, isIOS: boolean, isTouch: boolean, isWebKit: boolean }}
 */
export function classifyPlatform(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const platform = typeof source.platform === 'string' ? source.platform : '';
  const userAgent = typeof source.userAgent === 'string' ? source.userAgent : '';
  const maxTouchPoints = Number.isFinite(source.maxTouchPoints) ? source.maxTouchPoints : 0;
  const hasTouchEvent = source.hasTouchEvent === true;

  const namesIosDevice =
    /iPhone|iPad|iPod/.test(platform) || /iPhone|iPad|iPod/.test(userAgent);
  const macLike = platform.startsWith('Mac') || /Macintosh/.test(userAgent);

  const isIOS = namesIosDevice || (macLike && maxTouchPoints > 1);
  const isMac = macLike || isIOS;
  const isTouch = maxTouchPoints > 0 || hasTouchEvent;
  const isWebKit =
    isIOS ||
    (/AppleWebKit\//.test(userAgent) &&
      !/(Chrome|Chromium|Edg|OPR|SamsungBrowser)\//.test(userAgent));

  return { isMac, isIOS, isTouch, isWebKit };
}

let cached = null;

/** Runtime snapshot, read once from the real navigator/window and cached. */
export function getPlatform() {
  if (cached) return cached;
  const nav = globalThis.navigator;
  cached = classifyPlatform(
    nav
      ? {
          platform: nav.platform ?? '',
          userAgent: nav.userAgent ?? '',
          maxTouchPoints: nav.maxTouchPoints ?? 0,
          hasTouchEvent:
            typeof globalThis.window !== 'undefined' && 'ontouchstart' in globalThis.window,
        }
      : {}
  );
  return cached;
}

/**
 * Boot hook: plat-* classes on <html> so CSS and later JS (points 15–17)
 * can branch deterministically. Returns the snapshot for convenience.
 */
export function applyPlatformClasses(root = document.documentElement) {
  const plat = getPlatform();
  root.classList.toggle('plat-mac', plat.isMac);
  root.classList.toggle('plat-ios', plat.isIOS);
  root.classList.toggle('plat-touch', plat.isTouch);
  root.classList.toggle('plat-webkit', plat.isWebKit);
  return plat;
}

/** Test hook (suite part 13): forget the cached runtime snapshot. */
export function resetPlatformCache() {
  cached = null;
}
