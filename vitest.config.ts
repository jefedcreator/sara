import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Next.js loads .env automatically; vitest doesn't. Importing a route module
// can transitively import src/env.js (e.g. via a service like cloudinaryService),
// which validates required env vars at import time — so they need to be in
// process.env before any test file is loaded.
Object.assign(process.env, loadEnv("test", process.cwd(), ""));

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      types: path.resolve(__dirname, "./types"),
    },
  },
});
