#!/usr/bin/env node
import path from "node:path";
import { createServer, loadEnv } from "vite";

const live = process.argv.includes("--live");
// Ordinary replay has no credentials and makes no paid calls. Only --live loads
// local provider configuration. The fixture dispatcher is used in both modes.
if (live) Object.assign(process.env, loadEnv("development", process.cwd(), ""));
else {
  process.env.SKIP_ENV_VALIDATION = "1";
  process.env.OPENAI_ASSISTANT_MODEL = "gpt-5.4-mini";
}
if (live && !process.env.OPENAI_API_KEY?.trim()) {
  console.error("OPENAI_API_KEY is required for --live; no provider calls made.");
  process.exit(1);
}
const server = await createServer({
  configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": path.resolve("src"), types: path.resolve("types") } },
});
try {
  const { evaluateCases } = await server.ssrLoadModule("/src/backend/services/assistant/evaluation.ts");
  let dependencies;
  if (live) {
    const { getOpenAI } = await server.ssrLoadModule("/src/backend/services/assistant/openai.ts");
    dependencies = { responses: getOpenAI().responses };
  }
  const result = await evaluateCases(undefined, dependencies);
  const failures = new Map(result.failed.map((failure) => [failure.id, failure.reason]));
  for (let n = 1; n <= 30; n += 1) {
    const id = String(n).padStart(2, "0");
    console.log(`${id} ${failures.has(id) ? `FAIL ${failures.get(id)}` : "PASS"}`);
  }
  console.log(`${live ? "Live" : "Replay"}: ${result.passed}/30 passed; input ${result.usage.inputTokens}, cached ${result.usage.cachedTokens}, output ${result.usage.outputTokens} tokens; estimated USD ${result.estimatedCostUsd ?? "unknown"}; ${result.timingsMs.reduce((n, ms) => n + ms, 0)}ms`);
  process.exitCode = result.failed.length ? 1 : 0;
} catch {
  console.error("Evaluation could not start. Check configuration and run yarn typecheck.");
  process.exitCode = 1;
} finally { await server.close(); }
