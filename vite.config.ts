import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "safari15",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      input: {
        planner: "index.html",
        wallpaper: "wallpaper.html",
        launcher: "launcher.html",
      },
    },
  },
});
