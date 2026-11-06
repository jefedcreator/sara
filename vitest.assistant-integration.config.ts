import path from "node:path";
import { defineConfig } from "vitest/config";

const raw = process.env.ASSISTANT_TEST_DATABASE_URL;
if (!raw) throw new Error("ASSISTANT_TEST_DATABASE_URL is required for assistant integration tests");
let url: URL;
try { url = new URL(raw); } catch { throw new Error("Invalid ASSISTANT_TEST_DATABASE_URL"); }
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/sara_assistant_test') {
  throw new Error("Assistant integration requires localhost/127.0.0.1 and database sara_assistant_test");
}
// Only this explicitly checked URL may reach Prisma. Never load a development .env.
process.env.DATABASE_URL = raw;
process.env.DIRECT_URL = raw;
process.env.SKIP_ENV_VALIDATION = '1';
process.env.NODE_ENV = 'test';
export default defineConfig({
  test: { environment: 'node', include: ['src/backend/services/assistant/approval.integration.test.ts'], fileParallelism: false },
  resolve: { alias: { '@': path.resolve(__dirname, './src'), types: path.resolve(__dirname, './types') } },
});
