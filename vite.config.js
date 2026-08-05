// Vite config — added in phase 6e for the Tauri desktop shell.
// `tauri dev` connects to a FIXED dev-server URL (src-tauri/tauri.conf.json →
// build.devUrl), so the port must never silently bump to 5174.
export default {
  // GitHub Pages serves the app under a sub path (…/<repo>/app/). The deploy
  // workflow computes it from the repository name and passes it here; dev
  // server, desktop build (Tauri) and plain `npm run build` stay on '/'.
  base: process.env.SIMPLEX_BASE || '/',
  clearScreen: false, // keep Tauri's own output visible during desktop:dev
  server: {
    port: 5173,
    strictPort: true,
  },
};
