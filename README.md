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
- Stripe Checkout Session creation and webhook fulfillment

## What Went Wrong In The Latest Deploy

The deployed frontend canister is:

```text
2nukr-cyaaa-aaaak-qy2ja-cai
```

Open it through the certified asset gateway:

```text
https://2nukr-cyaaa-aaaak-qy2ja-cai.icp0.io
```

Do not use this as the browser URL:

```text
https://2nukr-cyaaa-aaaak-qy2ja-cai.icp-api.io
```

`icp-api.io` is the IC API endpoint used by agents and CLI tooling. Browser-hosted asset canisters should use `https://<canister-id>.icp0.io` or `https://<canister-id>.ic0.app`.

The other issue was `src/frontend/env.json`: it still had `undefined` backend settings and `http://localhost:3000` as the voice server when the frontend was built. Run the configuration command in this README before deploying the frontend so the asset canister receives the correct backend canister ID and public voice server URL.

References:

- Twilio Media Streams overview: https://www.twilio.com/docs/voice/media-streams
- Twilio Stream TwiML: https://www.twilio.com/docs/voice/twiml/stream
- Twilio WebSocket message format: https://www.twilio.com/docs/voice/media-streams/websocket-messages
- xAI Voice Agent API: https://docs.x.ai/developers/model-capabilities/audio/voice-agent

## Project Layout

```text
src/backend      Motoko canister: auth, presets, call history, phone-time balances
src/frontend     Vite frontend deployed as an IC asset canister
src/server       Windows-friendly Node.js Twilio/xAI/Stripe bridge
icp.yaml         icp-cli deployment config
```

## Prepaid Phone Time

The app now sells prepaid phone time and enforces it before and during calls.

Packages:

```text
$5  = 45 minutes
$10 = 90 minutes
$20 = 180 minutes
```

Payment flow:

1. The logged-in user selects a package in the dashboard.
2. The frontend creates a `purchaseIntent` in the IC backend.
3. The Node server creates a Stripe Checkout Session.
4. Stripe calls the Node webhook after payment.
5. The Node server verifies the webhook and credits seconds in the IC backend.
6. Before a call starts, the frontend reserves paid seconds in the IC backend.
7. `/initiate-call` refuses to dial unless the reservation token verifies.
8. The Node server ends the Twilio call when the reserved paid time runs out.

Admin users receive Stripe test-mode Checkout Sessions. Non-admin users receive live-mode Checkout Sessions.

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

Use the helper scripts rather than editing this file by hand:

```powershell
pnpm configure:frontend:local
pnpm configure:frontend:ic -- --voice-server-url https://your-public-voice-server
```

The helper reads canister IDs from `.icp/data/mappings/`, writes `src/frontend/env.json`, and prints the URL you should open.

If you do edit `src/frontend/env.json` directly, set:

- `backend_canister_id`: your Motoko backend canister ID
- `backend_host`: `https://icp-api.io` for mainnet, or your local IC gateway for local development
- `voice_server_url`: your Cloudflare Tunnel or deployed Node server URL

The frontend build now fails if `src/frontend/env.json` still contains `undefined`, `replace-with...`, or a local voice server URL for a mainnet frontend. That is intentional: it prevents another upload with a broken runtime config.

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
TWILIO_PHONE_NUMBERS=+13366098857,+17016077987
XAI_API_KEY=xai-...
HOSTNAME=
FRONTEND_ORIGIN=https://2nukr-cyaaa-aaaak-qy2ja-cai.icp0.io
FRONTEND_CANISTER_ID=2nukr-cyaaa-aaaak-qy2ja-cai
BACKEND_CANISTER_ID=2dwhz-ziaaa-aaaak-qy2ia-cai
BACKEND_HOST=https://icp-api.io
STRIPE_TEST_SECRET_KEY=sk_test_...
STRIPE_TEST_WEBHOOK_SECRET=whsec_...
STRIPE_LIVE_SECRET_KEY=sk_live_...
STRIPE_LIVE_WEBHOOK_SECRET=whsec_...
```

Leave `HOSTNAME` blank until your tunnel is running.

For local-only testing, you may temporarily use `FRONTEND_ORIGIN=*`. For production, keep it restricted to your IC frontend. The server normalizes trailing slashes, so both of these work:

```text
FRONTEND_ORIGIN=https://2nukr-cyaaa-aaaak-qy2ja-cai.icp0.io
FRONTEND_ORIGIN=https://2nukr-cyaaa-aaaak-qy2ja-cai.icp0.io/
```

`FRONTEND_CANISTER_ID` is optional, but useful because the server will allow both `https://<id>.icp0.io` and `https://<id>.ic0.app`.

Create the server identity that the Node service uses to credit payments and verify reservations:

```powershell
node src\server\scripts\create-ic-server-identity.mjs
```

Copy the printed `ICP_SERVER_IDENTITY_JSON=...` line into `src\server\.env`. Copy the printed principal too; after the backend is deployed, your admin identity must grant that principal admin access:

```powershell
icp canister call -e ic backend assignCallerUserRole '(principal "SERVER_PRINCIPAL_HERE", variant { admin })'
```

You can also do this from the app: open **Admin Dashboard**, find **Payment Server**, and click **Authorize Server**. This grants the Node voice server permission to read purchase intents, credit phone time after Stripe webhooks, and read the enabled Twilio line list.

`TWILIO_PHONE_NUMBER` remains supported as a single-line fallback. For multiple outbound lines, set `TWILIO_PHONE_NUMBERS` or add numbers in **Admin Dashboard > Twilio Configuration > Outbound Lines**. Each enabled number is treated as one outbound line; when every line is busy, new paid call reservations wait in FIFO order until a line is released.

In Stripe, create two webhook endpoints:

```text
https://voicecall.richardhery.com/stripe/webhook/test
https://voicecall.richardhery.com/stripe/webhook/live
```

Add these webhook events:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
```

Put each endpoint's signing secret into the matching `STRIPE_TEST_WEBHOOK_SECRET` or `STRIPE_LIVE_WEBHOOK_SECRET` value.

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
cors.allowedOrigins includes https://voicecallai.online
twilioConfigured  : True
xaiConfigured     : True
```

From the MacBook, test the public CORS path after the Windows server is restarted:

```bash
curl -i -H "Origin: https://voicecallai.online" https://voicecall.richardhery.com/health
```

The response headers must include:

```text
Access-Control-Allow-Origin: https://voicecallai.online
```

### 6. Update and restart the NSSM service

If the server is already installed as the `VoiceCallAI` Windows service, pull the latest GitHub code and restart it with:

```powershell
cd C:\Projects\voicecall-ai
powershell -ExecutionPolicy Bypass -File .\scripts\update-voicecall-service.ps1
```

The script runs `git pull --ff-only`, installs dependencies, checks `server.js`, restarts NSSM, and verifies both local and public `/health` with the IC frontend `Origin` header.

Manual NSSM restart commands:

```powershell
cd C:\Projects\voicecall-ai
git pull --ff-only origin main
pnpm install --prefer-offline
node --check .\src\server\server.js
C:\Tools\nssm\nssm.exe set VoiceCallAI AppDirectory C:\Projects\voicecall-ai\src\server
C:\Tools\nssm\nssm.exe set VoiceCallAI AppParameters server.js
C:\Tools\nssm\nssm.exe restart VoiceCallAI
C:\Tools\nssm\nssm.exe status VoiceCallAI
```

Then verify:

```powershell
Invoke-WebRequest `
  -Uri https://voicecall.richardhery.com/health `
  -Headers @{ Origin = "https://voicecallai.online" } `
  -UseBasicParsing
```

The JSON should include:

```text
serverVersion: 2026-05-09-stripe-prepaid-minutes
```

## Configure the Frontend

For local server testing, deploy/create both local canisters first, then run:

```powershell
pnpm configure:frontend:local
```

For an IC-hosted frontend calling your Windows server through Cloudflare, run:

```powershell
pnpm configure:frontend:ic -- --voice-server-url https://example-random.trycloudflare.com
```

Replace the example URL with your actual Cloudflare Tunnel URL. This writes all of `src\frontend\env.json`, including the backend canister ID, frontend origin, and voice server URL.

Until `backend_canister_id` and `voice_server_url` are set, the login page can render, but authenticated backend calls and phone calls will not work.

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

Create the frontend canister if it does not exist yet, so `icp` can allocate its local canister ID without uploading stale assets:

```powershell
icp canister create frontend
```

Now generate the frontend runtime config and redeploy the frontend with that config:

```powershell
pnpm configure:frontend:local
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

Use `-n ic` for token and cycle commands. Without `-n ic`, `icp cycles balance` can show your local network balance, which is why the first balance in your transcript looked much larger than the balance available for mainnet canister creation.

Deploy the backend:

```powershell
icp deploy -e ic backend
$backendId = (icp canister status -e ic --id-only backend).Trim()
$backendId
```

If this is the first frontend deploy and you do not know the frontend ID yet, create the frontend canister first:

```powershell
icp canister create -e ic frontend
$frontendId = (icp canister status -e ic --id-only frontend).Trim()
$frontendId
```

Generate the frontend runtime config with your public voice server URL, then deploy the frontend:

```powershell
pnpm configure:frontend:ic -- --voice-server-url https://your-cloudflare-or-server-host
icp deploy -e ic frontend
```

For the deployment shown in your terminal, open:

```text
https://2nukr-cyaaa-aaaak-qy2ja-cai.icp0.io
```

For any future deployment, use:

```text
https://<frontendId>.icp0.io
```

If Chrome shows a certificate warning on `*.icp-api.io`, you are on the wrong host for the frontend. Switch the address to `*.icp0.io` or `*.ic0.app`.

## Custom Domain

The frontend canister is prepared for:

```text
https://voicecallai.online
https://www.voicecallai.online
```

The deployed frontend canister ID is:

```text
2nukr-cyaaa-aaaak-qy2ja-cai
```

The IC custom-domain verifier needs these files in the asset canister:

```text
src/frontend/public/.well-known/ic-domains
src/frontend/public/.well-known/ii-alternative-origins
```

`ic-domains` proves the canister is willing to serve the custom domains. `ii-alternative-origins` lets Internet Identity keep using the existing `https://2nukr-cyaaa-aaaak-qy2ja-cai.icp0.io` principal derivation origin when users sign in from the custom domain.

Before registering the domain, rebuild and redeploy the frontend:

```powershell
pnpm configure:frontend:ic -- --voice-server-url https://voicecall.richardhery.com
icp deploy -e ic frontend
```

Then confirm the deployed files are visible:

```powershell
curl -sL https://2nukr-cyaaa-aaaak-qy2ja-cai.icp0.io/.well-known/ic-domains
curl -sL https://2nukr-cyaaa-aaaak-qy2ja-cai.icp0.io/.well-known/ii-alternative-origins
```

In Namecheap Advanced DNS, remove the parking and redirect records, then add IC records for both the apex and `www` host:

```text
ALIAS  @                    voicecallai.online.icp1.io
CNAME  _acme-challenge      _acme-challenge.voicecallai.online.icp2.io
TXT    _canister-id         2nukr-cyaaa-aaaak-qy2ja-cai

ALIAS  www                  www.voicecallai.online.icp1.io
CNAME  _acme-challenge.www  _acme-challenge.www.voicecallai.online.icp2.io
TXT    _canister-id.www     2nukr-cyaaa-aaaak-qy2ja-cai
```

After DNS propagates, validate and register each host:

```powershell
curl -sL -X GET https://icp0.io/custom-domains/v1/voicecallai.online/validate
curl -sL -X POST https://icp0.io/custom-domains/v1/voicecallai.online
curl -sL -X GET https://icp0.io/custom-domains/v1/www.voicecallai.online/validate
curl -sL -X POST https://icp0.io/custom-domains/v1/www.voicecallai.online
```

Poll until each returns `registration_status` as `registered`:

```powershell
curl -sL -X GET https://icp0.io/custom-domains/v1/voicecallai.online
curl -sL -X GET https://icp0.io/custom-domains/v1/www.voicecallai.online
```

Update the Windows voice server `.env` so browser calls and Stripe returns use the custom domain, then restart the service:

```text
FRONTEND_ORIGIN=https://voicecallai.online,https://www.voicecallai.online,https://2nukr-cyaaa-aaaak-qy2ja-cai.icp0.io
FRONTEND_URL=https://voicecallai.online
FRONTEND_CANISTER_ID=2nukr-cyaaa-aaaak-qy2ja-cai
```

## Test an End-To-End Call

1. Keep the Windows voice server running.
2. Keep the Cloudflare tunnel running.
3. Open the IC frontend.
4. Sign in with Internet Identity.
5. Create a preset.
6. Buy phone time from the dashboard.
7. Enter a recipient phone number in E.164 format, for example `+17753794797`.
8. Start the call.

The frontend reserves paid seconds in the IC backend, then calls:

```text
POST <voice_server_url>/initiate-call
```

The server verifies the paid reservation and calls Twilio. Twilio then calls:

```text
POST https://<HOSTNAME>/twiml
WSS  wss://<HOSTNAME>/media
```

The `/media` WebSocket bridges Twilio audio to xAI and sends xAI audio back to Twilio as `audio/pcmu` at 8 kHz.

## Twilio Notes

- Do not use the old `https://<accountSid>.icp0.io/twilio-webhook` URL.
- For outbound calls made by the app, you do not need to manually set a Twilio console webhook; the server passes the TwiML URL in `calls.create`.
- Add every outbound caller ID you want to use to the same Twilio account, then add it to the app as an enabled outbound line.
- On a Twilio trial account, destination numbers usually must be verified.
- If you turn on `VALIDATE_TWILIO_SIGNATURE=true`, test after your public tunnel URL is stable.

## CSP Notes

The IC asset canister serves a strict Content Security Policy from:

```text
src/frontend/public/.ic-assets.json5
```

If `voice_server_url` changes, add the new origin to both `connect-src` and `media-src` before redeploying the frontend. The build checks this now, so a mismatched CSP fails locally instead of letting the deployed browser block `/health`, `/initiate-call`, live monitoring, or recording playback.

## CORS Notes

The Windows Node server also enforces CORS. If the browser console says `No 'Access-Control-Allow-Origin' header`, check `src/server/.env` on the Windows PC:

```text
FRONTEND_ORIGIN=https://voicecallai.online,https://www.voicecallai.online,https://2nukr-cyaaa-aaaak-qy2ja-cai.icp0.io
FRONTEND_CANISTER_ID=2nukr-cyaaa-aaaak-qy2ja-cai
```

Restart the server after changing `.env` or pulling new server code. The `/health` response includes the active CORS allow list.

## Useful Commands

Frontend:

```powershell
pnpm --dir src/frontend typecheck
pnpm --dir src/frontend build
```

Backend:

```powershell
icp build backend
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
