import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Next.js loads .env automatically; vitest doesn't. Importing a route module
// can transitively import src/env.js (e.g. via a service like cloudinaryService),
// which validates required env vars at import time — so they need to be in
// process.env before any test file is loaded.
Object.assign(process.env, loadEnv("test", process.cwd(), ""));
// Session JWTs need a secret; tests without a .env still sign and verify.
// `||=`: an empty AUTH_SECRET counts as unset, as it does in src/env.js.
// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
process.env.AUTH_SECRET ||= "test-auth-secret";

export default defineConfig({
  // tsconfig's "jsx": "preserve" is for Next, which compiles JSX itself; left
  // alone, vite passes it through and can't run a .tsx module (the email
  // templates). Compile it here with the automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
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
