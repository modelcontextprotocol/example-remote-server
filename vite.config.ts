import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "path";

const input = process.env.INPUT;
if (!input) {
  throw new Error("INPUT environment variable is required");
}

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  root: path.dirname(input),
  build: {
    outDir: path.resolve("dist/apps"),
    emptyOutDir: false,
    rollupOptions: {
      input: input,
    },
  },
});
