#!/usr/bin/env node
// Syncs models from https://api.mistral.ai/v1/models into your OpenCode config.
// Requires Node 18+ (built-in fetch). No dependencies.

import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

if (has("help")) {
  console.log(`Usage: node sync-mistral-models.mjs [options]

Options:
  --config <path>     OpenCode config file (default: ~/.config/opencode/opencode.json)
  --provider <id>     Provider id in the config (default: mistral-api)
  --tools-only        Only add models that support function calling
  --no-aliases        Don't add alias ids such as mistral-large-latest
  --all               Don't filter out embedding/OCR/audio/moderation models
  --dry-run           Show what would change without writing anything
  --help              Show this message

Environment:
  MISTRAL_API_KEY     Your Mistral API key (required)`);
  process.exit(0);
}

const providerId = opt("provider", "mistral-api");
const configPath = opt("config", join(homedir(), ".config", "opencode", "opencode.json"));
const dryRun = has("dry-run");
const apiKey = process.env.MISTRAL_API_KEY;

if (!apiKey) {
  console.error("MISTRAL_API_KEY is not set. Export it first:\n  export MISTRAL_API_KEY=your-key");
  process.exit(1);
}

// 1. Fetch the model list
const res = await fetch("https://api.mistral.ai/v1/models", {
  headers: { Authorization: `Bearer ${apiKey}` },
});
if (!res.ok) {
  console.error(`Mistral API returned ${res.status} ${res.statusText}`);
  console.error((await res.text()).slice(0, 500));
  process.exit(1);
}
const body = await res.json();
const apiModels = Array.isArray(body) ? body : body.data ?? [];

// 2. Filter to models OpenCode can actually chat with
const NON_CHAT = /(embed|ocr|moderation|voxtral|transcribe|tts|timestral|shieldstral)/i;

function isUsable(m) {
  if (has("all")) return true;
  if (m.capabilities?.completion_chat === false) return false;
  if (NON_CHAT.test(m.id)) return false;
  if (has("tools-only") && m.capabilities?.function_calling !== true) return false;
  return true;
}

const wanted = new Map(); // id -> display name
for (const m of apiModels.filter(isUsable)) {
  wanted.set(m.id, m.name || m.id);
  if (!has("no-aliases") && Array.isArray(m.aliases)) {
    for (const alias of m.aliases) {
      if (!wanted.has(alias)) wanted.set(alias, m.name ? `${m.name} (${alias})` : alias);
    }
  }
}

// 3. Load the existing config (or start a new one)
let config;
let fileExisted = true;
try {
  config = JSON.parse(await readFile(configPath, "utf8"));
} catch (err) {
  if (err.code === "ENOENT") {
    fileExisted = false;
    config = { $schema: "https://opencode.ai/config.json" };
  } else {
    console.error(`Could not parse ${configPath}: ${err.message}`);
    console.error("This script only handles plain JSON. If the file has comments (JSONC), remove them first.");
    process.exit(1);
  }
}

// 4. Merge into provider.<id>.models without touching existing entries
config.provider ??= {};
config.provider[providerId] ??= {
  npm: "@ai-sdk/openai-compatible",
  name: "Mistral",
  options: {
    baseURL: "https://api.mistral.ai/v1",
    apiKey: "{env:MISTRAL_API_KEY}",
  },
};
const provider = config.provider[providerId];
provider.models ??= {};

const added = [];
const kept = [];
for (const [id, name] of wanted) {
  if (provider.models[id]) {
    kept.push(id);
  } else {
    provider.models[id] = { name };
    added.push(id);
  }
}

// 5. Report and write
console.log(`Mistral returned ${apiModels.length} models; ${wanted.size} usable after filtering.`);
console.log(`Added ${added.length}, already present ${kept.length}.`);
if (added.length) console.log("\nNew models:\n  " + added.join("\n  "));

if (dryRun) {
  console.log("\nDry run: nothing written.");
  process.exit(0);
}

if (added.length === 0 && fileExisted) {
  console.log("\nConfig already up to date.");
  process.exit(0);
}

if (fileExisted) {
  await copyFile(configPath, `${configPath}.bak`);
} else {
  await mkdir(dirname(configPath), { recursive: true });
}
await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
console.log(`\nWrote ${configPath}${fileExisted ? ` (backup: ${configPath}.bak)` : ""}`);
