import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the built page works from any folder (GitHub Pages, say).
  base: "./",
  server: { port: 4193, strictPort: true },
});
