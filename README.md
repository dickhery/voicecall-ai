# VoiceCall AI

VoiceCall AI is an IC-hosted app with a separate Node.js voice bridge for Twilio Media Streams and xAI Realtime Voice.

The Twilio error happened because the old code generated this webhook URL:

```text
https://<twilio-account-sid>.icp0.io/twilio-webhook
```

That is not a valid IC canister URL. Twilio reached the IC gateway, but the gateway could not resolve a canister, so it returned `canister_id_not_resolved` instead of TwiML XML.

This version keeps the IC canister for auth, presets, and history, but moves these live network calls to `src/server`:

- Twilio REST `calls.create`
- Twilio TwiML `/twiml`
- Twilio Media Streams WebSocket `/media`
- xAI Realtime Voice WebSocket

References:

- Twilio Media Streams overview: https://www.twilio.com/docs/voice/media-streams
- Twilio Stream TwiML: https://www.twilio.com/docs/voice/twiml/stream
- Twilio WebSocket message format: https://www.twilio.com/docs/voice/media-streams/websocket-messages
- xAI Voice Agent API: https://docs.x.ai/developers/model-capabilities/audio/voice-agent

## Project Layout

```text
src/backend      Motoko canister: auth, presets, call history
src/frontend     Vite frontend deployed as an IC asset canister
src/server       Windows-friendly Node.js Twilio/xAI bridge
icp.yaml         icp-cli deployment config
```

## Where To Put Canister IDs

For a new deployment, `icp deploy` writes IDs under:

```text
.icp/data/mappings/
```

Do not delete that folder after deployment.

If you already have existing mainnet canisters, copy the example file:

```powershell
New-Item -ItemType Directory -Force .icp\data\mappings
Copy-Item .icp\data\mappings\ic.ids.example.json .icp\data\mappings\ic.ids.json
notepad .icp\data\mappings\ic.ids.json
```

Then replace the placeholders with the real IDs:

```json
{
  "backend": "aaaaa-aaaaa-aaaaa-aaaaa-cai",
  "frontend": "bbbbb-bbbbb-bbbbb-bbbbb-cai"
}
```

The current Caffeine frontend also reads runtime settings from:

```text
src/frontend/env.json
```

Use `src/frontend/env.example.json` as the template. Set:

- `backend_canister_id`: your Motoko backend canister ID
- `backend_host`: `https://icp0.io` for mainnet, or your local IC gateway for local development
- `ii_derivation_origin`: usually `https://<frontend-canister-id>.icp0.io`
- `voice_server_url`: your Cloudflare Tunnel or deployed Node server URL

## Windows Setup

Open PowerShell as your normal user.

### 1. Install tools

```powershell
winget install OpenJS.NodeJS.LTS
corepack enable
corepack prepare pnpm@latest --activate
npm install -g @icp-sdk/icp-cli @icp-sdk/ic-wasm ic-mops
```

Verify:

```powershell
node --version
pnpm --version
icp --version
ic-wasm --version
mops --version
```

Use Node.js 22 or newer.

### 2. Install project dependencies

```powershell
cd C:\path\to\voicecall-ai
pnpm install --prefer-offline
mops install
```

### 3. Configure the voice server

```powershell
Copy-Item src\server\.env.example src\server\.env
notepad src\server\.env
```

Fill these values:

```text
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+13366098857
XAI_API_KEY=xai-...
HOSTNAME=
FRONTEND_ORIGIN=*
```

Leave `HOSTNAME` blank until your tunnel is running.

### 4. Start a Cloudflare Tunnel

Quick test tunnel:

```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:3000
```

Cloudflare prints a public URL like:

```text
https://example-random.trycloudflare.com
```

Put that in `src\server\.env`:

```text
HOSTNAME=example-random.trycloudflare.com
```

You can include `https://`; the server accepts both forms.

For a permanent domain, use Cloudflare’s named tunnel flow:

```powershell
cloudflared tunnel login
cloudflared tunnel create voicecall-ai
cloudflared tunnel route dns voicecall-ai voice.yourdomain.com
cloudflared tunnel run voicecall-ai
```

Then set:

```text
HOSTNAME=voice.yourdomain.com
```

### 5. Start the voice server

Use a second PowerShell window:

```powershell
cd C:\path\to\voicecall-ai
pnpm server:start
```

Check health:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Expected:

```text
ok                : True
publicHost        : your-tunnel-host
twilioConfigured  : True
xaiConfigured     : True
```

## Configure the Frontend

Copy the template:

```powershell
Copy-Item src\frontend\env.example.json src\frontend\env.json
notepad src\frontend\env.json
```

For local server testing, set:

```json
{
  "voice_server_url": "http://localhost:3000"
}
```

For an IC-hosted frontend calling your Windows server through Cloudflare, set:

```json
{
  "voice_server_url": "https://example-random.trycloudflare.com"
}
```

Also set `backend_canister_id` before building the frontend.

Until `backend_canister_id` is set, the login page can render, but the browser console will report `CANISTER_ID_BACKEND is not set` and authenticated backend calls will not work.

## Local IC Deploy

Start the local IC network:

```powershell
icp network start -d
```

Deploy the backend first:

```powershell
icp deploy backend
$backendId = (icp canister status backend --id-only).Trim()
$backendId
```

Edit `src\frontend\env.json`:

```json
{
  "backend_host": "http://127.0.0.1:8000",
  "backend_canister_id": "<backendId from previous command>",
  "project_id": "voicecall-ai",
  "ii_derivation_origin": "http://localhost:8000",
  "storage_gateway_url": "https://blob.caffeine.ai",
  "voice_server_url": "http://localhost:3000"
}
```

Deploy the frontend:

```powershell
icp deploy frontend
$frontendId = (icp canister status frontend --id-only).Trim()
"http://$frontendId.localhost:8000"
```

Open the printed URL in your browser.

## Mainnet IC Deploy

Set a named identity and verify funds:

```powershell
icp identity list
icp identity default <your-identity-name>
icp identity principal
icp token balance -n ic
icp cycles balance -n ic
```

Deploy the backend:

```powershell
icp deploy -e ic backend
$backendId = (icp canister status -e ic --id-only backend).Trim()
$backendId
```

Edit `src\frontend\env.json`:

```json
{
  "backend_host": "https://icp0.io",
  "backend_canister_id": "<backendId>",
  "project_id": "voicecall-ai",
  "ii_derivation_origin": "https://<frontend-canister-id>.icp0.io",
  "storage_gateway_url": "https://blob.caffeine.ai",
  "voice_server_url": "https://your-cloudflare-or-server-host"
}
```

If this is the first frontend deploy and you do not know the frontend ID yet, deploy once, get the ID, update `ii_derivation_origin`, and deploy the frontend again:

```powershell
icp deploy -e ic frontend
$frontendId = (icp canister status -e ic --id-only frontend).Trim()
$frontendId
notepad src\frontend\env.json
icp deploy -e ic frontend
```

Open:

```text
https://<frontendId>.icp0.io
```

## Test an End-To-End Call

1. Keep the Windows voice server running.
2. Keep the Cloudflare tunnel running.
3. Open the IC frontend.
4. Sign in with Internet Identity.
5. Create a preset with `PCMU` and `8,000 Hz`.
6. Enter a recipient phone number in E.164 format, for example `+17753794797`.
7. Start the call.

The frontend creates an IC history record, then calls:

```text
POST <voice_server_url>/initiate-call
```

The server calls Twilio. Twilio then calls:

```text
POST https://<HOSTNAME>/twiml
WSS  wss://<HOSTNAME>/media
```

The `/media` WebSocket bridges Twilio audio to xAI and sends xAI audio back to Twilio as `audio/pcmu` at 8 kHz.

## Twilio Notes

- Do not use the old `https://<accountSid>.icp0.io/twilio-webhook` URL.
- For outbound calls made by the app, you do not need to manually set a Twilio console webhook; the server passes the TwiML URL in `calls.create`.
- On a Twilio trial account, destination numbers usually must be verified.
- If you turn on `VALIDATE_TWILIO_SIGNATURE=true`, test after your public tunnel URL is stable.

## Useful Commands

Frontend:

```powershell
pnpm --dir src/frontend typecheck
pnpm --dir src/frontend build
```

Backend:

```powershell
# From the repository root, where mops.toml lives
mops build
```

Server:

```powershell
pnpm --dir src/server start
```

All packages:

```powershell
pnpm typecheck
pnpm build
```
