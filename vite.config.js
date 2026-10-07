import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],

  // Required so the packaged Electron app
  // can load Vite assets from local files.
  base: "./"
});