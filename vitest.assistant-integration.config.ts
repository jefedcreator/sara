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
delete process.env.SKIP_ENV_VALIDATION;
Object.assign(process.env, { NODE_ENV: 'test' });
process.env.CLOUDINARY_API_KEY = 'offline-integration';
process.env.CLOUDINARY_API_SECRET = 'offline-integration';
process.env.CLOUDINARY_CLOUD_NAME = 'offline-integration';
process.env.OPENAI_API_KEY = 'offline-integration-key';
process.env.ASSISTANT_ENABLED = 'true';
process.env.ASSISTANT_DAILY_LIMIT = '100';
process.env.OPENAI_ASSISTANT_MODEL = 'gpt-5.4-mini';
process.env.OPENAI_TRANSCRIBE_MODEL = 'whisper-1';
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: { environment: 'node', include: ['src/backend/services/assistant/approval.integration.test.ts'], fileParallelism: false },
  resolve: { alias: { '@': path.resolve(__dirname, './src'), types: path.resolve(__dirname, './types') } },
});
