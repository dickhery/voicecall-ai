import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mode = (process.argv[2] || "local").toLowerCase();
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function readDotEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [rawKey, ...rawValue] = trimmed.split("=");
    const value = rawValue.join("=").trim().replace(/^["']|["']$/g, "");
    out[rawKey.trim()] = value;
  }
  return out;
}

function getArg(name) {
  const prefix = `--${name}=`;
  const exact = `--${name}`;
  for (let i = 0; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === exact) return process.argv[i + 1];
  }
  return undefined;
}

function normalizeUrl(value, defaultProtocol = "https") {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed || trimmed === "undefined") return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${defaultProtocol}://${trimmed}`;
}

function isLocalUrl(value) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(value);
}

function isPlaceholderValue(value) {
  const normalized = String(value || "").toLowerCase();
  return (
    !normalized ||
    normalized === "undefined" ||
    normalized.includes("replace-with") ||
    normalized.includes("example.com") ||
    normalized.includes("your-cloudflare") ||
    normalized.includes("yourdomain")
  );
}

function loadMappings(targetMode) {
  const path =
    targetMode === "ic"
      ? resolve(root, ".icp/data/mappings/ic.ids.json")
      : resolve(root, ".icp/cache/mappings/local.ids.json");
  const mappings = readJson(path);
  if (isPlaceholderValue(mappings?.backend)) {
    throw new Error(
      `Missing backend canister ID in ${path}. Deploy or create the backend canister first.`,
    );
  }
  return { path, mappings };
}

function resolveVoiceServerUrl(targetMode, existingEnv) {
  const serverEnv = readDotEnv(resolve(root, "src/server/.env"));
  const fromArg = getArg("voice-server-url");
  const fromEnv = process.env.VOICE_SERVER_URL;
  const fromServerHost = serverEnv.HOSTNAME && !isPlaceholderValue(serverEnv.HOSTNAME)
    ? normalizeUrl(serverEnv.HOSTNAME, "https")
    : "";
  const fromExisting = !isPlaceholderValue(existingEnv.voice_server_url)
    ? existingEnv.voice_server_url
    : "";
  const fallback = targetMode === "local" ? "http://localhost:3000" : "";

  const url = normalizeUrl(
    fromArg || fromEnv || fromServerHost || fromExisting || fallback,
    targetMode === "local" ? "http" : "https",
  );

  if (targetMode === "ic" && (!url || isLocalUrl(url))) {
    throw new Error(
      [
        "Mainnet frontend needs a public voice server URL.",
        "Run this command with your Cloudflare/Render/Railway/Fly URL:",
        "pnpm configure:frontend:ic -- --voice-server-url https://voice.example.com",
      ].join("\n"),
    );
  }

  if (targetMode === "ic" && isPlaceholderValue(url)) {
    throw new Error(
      [
        "Mainnet frontend still has a placeholder voice server URL.",
        "Run this command with your real Cloudflare/Render/Railway/Fly URL:",
        "pnpm configure:frontend:ic -- --voice-server-url https://your-real-host",
      ].join("\n"),
    );
  }

  return url;
}

if (!["local", "ic"].includes(mode)) {
  throw new Error("Usage: node scripts/configure-frontend-env.mjs <local|ic> [--voice-server-url URL]");
}

const envPath = resolve(root, "src/frontend/env.json");
const existingEnv = readJson(envPath, {});
const { mappings } = loadMappings(mode);
const frontendId = mappings.frontend;
const voiceServerUrl = resolveVoiceServerUrl(mode, existingEnv);

if (isPlaceholderValue(frontendId)) {
  throw new Error(
    `Missing frontend canister ID for ${mode}. Deploy/create the frontend once, then rerun this script.`,
  );
}

const frontendUrl =
  mode === "ic"
    ? `https://${frontendId}.icp0.io`
    : `http://${frontendId}.localhost:8000`;

const nextEnv = {
  backend_host: mode === "ic" ? "https://icp-api.io" : "http://127.0.0.1:8000",
  backend_canister_id: mappings.backend,
  project_id: existingEnv.project_id && existingEnv.project_id !== "undefined"
    ? existingEnv.project_id
    : "voicecall-ai",
  ii_derivation_origin: frontendUrl,
  storage_gateway_url:
    existingEnv.storage_gateway_url && existingEnv.storage_gateway_url !== "undefined"
      ? existingEnv.storage_gateway_url
      : "https://blob.caffeine.ai",
  voice_server_url: voiceServerUrl,
};

writeFileSync(envPath, `${JSON.stringify(nextEnv, null, 2)}\n`);

console.log(`Wrote ${envPath}`);
console.log(`Backend canister: ${mappings.backend}`);
console.log(`Frontend canister: ${frontendId}`);
console.log(`Open frontend at: ${frontendUrl}`);
console.log(`Voice server URL: ${voiceServerUrl}`);
