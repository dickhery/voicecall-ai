import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const source = resolve("env.json");
const destination = resolve("dist/env.json");
const assetConfig = resolve("dist/.ic-assets.json5");

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

function getCspDirective(cspText, directive) {
  const match = cspText.match(new RegExp(`${directive}\\s+([^";]+)`));
  return match?.[1] || "";
}

function directiveAllows(cspText, directive, origin) {
  return getCspDirective(cspText, directive).split(/\s+/).includes(origin);
}

const env = JSON.parse(readFileSync(source, "utf8"));
const requiredKeys = [
  "backend_host",
  "backend_canister_id",
  "project_id",
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

const usesMainnetBackend =
  String(env.backend_host || "").replace(/\/+$/, "") === "https://icp-api.io";

if (usesMainnetBackend && isLocalUrl(env.voice_server_url)) {
  throw new Error(
    `${source} points at mainnet IC but voice_server_url is local. Use your Cloudflare Tunnel or deployed server URL.`,
  );
}

if (usesMainnetBackend && !String(env.voice_server_url).startsWith("https://")) {
  throw new Error(
    `${source} points at mainnet IC but voice_server_url is not https.`,
  );
}

if (existsSync(assetConfig)) {
  const voiceOrigin = new URL(env.voice_server_url).origin;
  const assetConfigText = readFileSync(assetConfig, "utf8");
  if (!directiveAllows(assetConfigText, "connect-src", voiceOrigin)) {
    throw new Error(
      `${assetConfig} Content-Security-Policy does not allow ${voiceOrigin}. Add it to connect-src before deploying.`,
    );
  }
  if (!directiveAllows(assetConfigText, "media-src", voiceOrigin)) {
    throw new Error(
      `${assetConfig} Content-Security-Policy does not allow recording playback from ${voiceOrigin}. Add it to media-src before deploying.`,
    );
  }
}

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
