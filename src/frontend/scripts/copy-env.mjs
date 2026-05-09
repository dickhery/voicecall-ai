import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const source = resolve("env.json");
const destination = resolve("dist/env.json");

if (!existsSync(source)) {
  throw new Error(`Missing ${source}. Copy env.example.json to env.json first.`);
}

function isUnset(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return !normalized || normalized === "undefined";
}

function isPlaceholder(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return (
    isUnset(normalized) ||
    normalized.includes("replace-with") ||
    normalized.includes("example.com") ||
    normalized.includes("your-cloudflare") ||
    normalized.includes("yourdomain")
  );
}

function isLocalUrl(value) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(
    String(value || ""),
  );
}

function looksLikeMainnetOrigin(value) {
  return /^https:\/\/[^/]+\.(icp0\.io|ic0\.app)$/i.test(String(value || ""));
}

const env = JSON.parse(readFileSync(source, "utf8"));
const requiredKeys = [
  "backend_host",
  "backend_canister_id",
  "project_id",
  "ii_derivation_origin",
  "storage_gateway_url",
  "voice_server_url",
];

for (const key of requiredKeys) {
  if (isPlaceholder(env[key])) {
    throw new Error(
      `${source} has an invalid ${key}. Run pnpm configure:frontend:local or pnpm configure:frontend:ic before building.`,
    );
  }
}

if (
  looksLikeMainnetOrigin(env.ii_derivation_origin) &&
  isLocalUrl(env.voice_server_url)
) {
  throw new Error(
    `${source} points at a mainnet IC frontend but voice_server_url is local. Use your Cloudflare Tunnel or deployed server URL.`,
  );
}

if (
  looksLikeMainnetOrigin(env.ii_derivation_origin) &&
  !String(env.voice_server_url).startsWith("https://")
) {
  throw new Error(
    `${source} points at a mainnet IC frontend but voice_server_url is not https.`,
  );
}

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
