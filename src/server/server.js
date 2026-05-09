import "dotenv/config";
import http from "node:http";
import crypto from "node:crypto";
import cors from "cors";
import express from "express";
import twilio from "twilio";
import WebSocket, { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 3000);
const XAI_MODEL = process.env.XAI_MODEL || "grok-voice-think-fast-1.0";
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const STREAM_MARK_PREFIX = "xai-audio";

const app = express();
app.set("trust proxy", true);

const allowOrigins = (process.env.FRONTEND_ORIGIN || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowAllOrigins = allowOrigins.length === 0 || allowOrigins.includes("*");

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowAllOrigins || allowOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
  }),
);
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false }));

const requiredEnv = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "XAI_API_KEY",
];

const callSessions = new Map();
const callsBySid = new Map();

const twilioClient =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;
const { VoiceResponse } = twilio.twiml;

function log(level, message, meta = {}) {
  const entry = {
    level,
    message,
    ...meta,
    at: new Date().toISOString(),
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function getPublicHost() {
  const raw = process.env.HOSTNAME || process.env.PUBLIC_URL || "";
  if (!raw.trim()) return "";
  const withProtocol = raw.includes("://") ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol).host;
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^wss?:\/\//, "").replace(/\/.*$/, "");
  }
}

function getPublicBaseUrl() {
  const host = getPublicHost();
  return host ? `https://${host}` : "";
}

function getPublicWsUrl() {
  const host = getPublicHost();
  return host ? `wss://${host}/media` : "";
}

function requireServerConfig() {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing server environment variables: ${missing.join(", ")}`);
  }
  if (!getPublicHost()) {
    throw new Error("Missing HOSTNAME. Set it to your Cloudflare Tunnel, ngrok, or deployed server host.");
  }
  if (!twilioClient) {
    throw new Error("Twilio client is not configured.");
  }
}

function normalizePhone(phone) {
  const cleaned = String(phone || "").replace(/\s/g, "");
  if (!/^\+[1-9]\d{1,14}$/.test(cleaned)) {
    throw new Error("Phone number must be E.164 format, for example +15551234567.");
  }
  return cleaned;
}

function toPlainPreset(input = {}) {
  const turnDetection = input.turnDetection || {};
  const toolsEnabled = input.toolsEnabled || {};
  return {
    id: String(input.id ?? ""),
    name: String(input.name || "VoiceCall AI"),
    systemPrompt: String(
      input.systemPrompt ||
        "You are a helpful AI phone agent. Be concise, natural, and respectful.",
    ),
    voice: String(input.voice || process.env.XAI_VOICE || "eve"),
    turnDetection: {
      serverVad: turnDetection.serverVad !== false,
      threshold: Number(turnDetection.threshold ?? 0.5),
      silenceDurationMs: Number(turnDetection.silenceDurationMs ?? 500),
      prefixPaddingMs: Number(turnDetection.prefixPaddingMs ?? 200),
    },
    toolsEnabled: {
      webSearch: Boolean(toolsEnabled.webSearch),
      xSearch: Boolean(toolsEnabled.xSearch),
      functionCalling: Boolean(toolsEnabled.functionCalling),
    },
  };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function buildXaiSessionUpdate(preset) {
  const tools = [];
  if (preset.toolsEnabled.webSearch) tools.push({ type: "web_search" });
  if (preset.toolsEnabled.xSearch) tools.push({ type: "x_search" });

  return {
    type: "session.update",
    session: {
      voice: preset.voice,
      instructions: preset.systemPrompt,
      turn_detection: {
        type: "server_vad",
        threshold: clamp(preset.turnDetection.threshold, 0.1, 0.9),
        silence_duration_ms: clamp(preset.turnDetection.silenceDurationMs, 0, 10000),
        prefix_padding_ms: clamp(preset.turnDetection.prefixPaddingMs, 0, 10000),
      },
      audio: {
        input: { format: { type: "audio/pcmu" } },
        output: { format: { type: "audio/pcmu" } },
      },
      tools,
    },
  };
}

function twilioRequestUrl(req) {
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}${req.originalUrl}`;
}

function validateTwilioRequest(req) {
  if (process.env.VALIDATE_TWILIO_SIGNATURE !== "true") return true;
  const signature = req.get("x-twilio-signature");
  if (!signature || !process.env.TWILIO_AUTH_TOKEN) return false;
  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    twilioRequestUrl(req),
    req.body || {},
  );
}

function makeErrorTwiML(message) {
  const response = new VoiceResponse();
  response.say({ voice: "alice" }, message);
  response.hangup();
  return response.toString();
}

function getSessionFromRequest(req) {
  const sessionId = String(req.query.sessionId || req.body.sessionId || "");
  return { sessionId, session: callSessions.get(sessionId) };
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    publicHost: getPublicHost(),
    twilioConfigured: Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_PHONE_NUMBER,
    ),
    xaiConfigured: Boolean(process.env.XAI_API_KEY),
    model: XAI_MODEL,
  });
});

app.post("/initiate-call", async (req, res) => {
  try {
    requireServerConfig();
    const recipientPhone = normalizePhone(req.body.recipientPhone);
    const preset = toPlainPreset(req.body.preset);
    const callId = String(req.body.callId || "");
    const sessionId = crypto.randomUUID();
    const publicBaseUrl = getPublicBaseUrl();
    const twimlUrl = new URL("/twiml", publicBaseUrl);
    twimlUrl.searchParams.set("sessionId", sessionId);

    const statusCallbackUrl = new URL("/call-status", publicBaseUrl);
    statusCallbackUrl.searchParams.set("sessionId", sessionId);

    const session = {
      id: sessionId,
      callId,
      recipientPhone,
      preset,
      createdAt: Date.now(),
      callSid: null,
      streamSid: null,
      transcript: [],
    };
    callSessions.set(sessionId, session);

    const call = await twilioClient.calls.create({
      to: recipientPhone,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: twimlUrl.toString(),
      method: "POST",
      statusCallback: statusCallbackUrl.toString(),
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });

    session.callSid = call.sid;
    callsBySid.set(call.sid, sessionId);
    log("info", "Twilio call created", { callSid: call.sid, callId, sessionId });

    res.json({
      ok: true,
      callSid: call.sid,
      sessionId,
      status: call.status,
    });
  } catch (error) {
    log("error", "Failed to initiate call", { error: error.message });
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/end-call", async (req, res) => {
  try {
    requireServerConfig();
    const callSid = String(req.body.callSid || "");
    if (!/^CA[a-fA-F0-9]{32}$/.test(callSid)) {
      throw new Error("A valid Twilio CallSid is required.");
    }
    await twilioClient.calls(callSid).update({ status: "completed" });
    const sessionId = callsBySid.get(callSid);
    if (sessionId) {
      const session = callSessions.get(sessionId);
      if (session) session.endedAt = Date.now();
    }
    res.json({ ok: true });
  } catch (error) {
    log("error", "Failed to end call", { error: error.message });
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/twiml", (req, res) => {
  res.type("text/xml");
  try {
    if (!validateTwilioRequest(req)) {
      log("warn", "Rejected Twilio webhook with invalid signature");
      res.status(403).send(makeErrorTwiML("Request validation failed."));
      return;
    }

    const publicWsUrl = getPublicWsUrl();
    const { sessionId, session } = getSessionFromRequest(req);
    if (!publicWsUrl || !session) {
      log("warn", "TwiML requested without a matching session", { sessionId });
      res
        .status(200)
        .send(makeErrorTwiML("This call session is not available. Please try again."));
      return;
    }

    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({
      url: publicWsUrl,
      name: `voicecall-ai-${sessionId}`,
    });
    stream.parameter({ name: "sessionId", value: sessionId });
    stream.parameter({ name: "callId", value: session.callId || "" });
    stream.parameter({ name: "presetName", value: session.preset.name });

    res.status(200).send(response.toString());
  } catch (error) {
    log("error", "Failed to generate TwiML", { error: error.message });
    res.status(200).send(makeErrorTwiML("The voice server could not start this call."));
  }
});

app.post("/call-status", (req, res) => {
  if (!validateTwilioRequest(req)) {
    log("warn", "Rejected status callback with invalid signature");
    res.sendStatus(403);
    return;
  }

  const { sessionId, session } = getSessionFromRequest(req);
  if (session) {
    session.lastStatus = req.body.CallStatus;
    session.lastStatusAt = Date.now();
  }
  log("info", "Twilio status callback", {
    sessionId,
    callSid: req.body.CallSid,
    status: req.body.CallStatus,
  });
  res.sendStatus(204);
});

const server = http.createServer(app);
const mediaWss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", "http://localhost");
  if (url.pathname !== "/media") {
    socket.destroy();
    return;
  }
  mediaWss.handleUpgrade(request, socket, head, (ws) => {
    mediaWss.emit("connection", ws, request);
  });
});

mediaWss.on("connection", (twilioWs, request) => {
  let xaiWs = null;
  let session = null;
  let streamSid = null;
  let markCounter = 0;
  let closed = false;

  function closeBoth() {
    if (closed) return;
    closed = true;
    if (xaiWs && xaiWs.readyState === WebSocket.OPEN) xaiWs.close();
    if (twilioWs.readyState === WebSocket.OPEN) twilioWs.close();
  }

  function sendToTwilio(payload) {
    if (twilioWs.readyState === WebSocket.OPEN) {
      twilioWs.send(JSON.stringify(payload));
    }
  }

  function sendInitialGreeting() {
    const greeting = process.env.CALL_GREETING;
    if (!greeting || !xaiWs || xaiWs.readyState !== WebSocket.OPEN) return;
    xaiWs.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: greeting }],
        },
      }),
    );
    xaiWs.send(JSON.stringify({ type: "response.create" }));
  }

  function connectToXai() {
    if (!session) return;
    xaiWs = new WebSocket(
      `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(XAI_MODEL)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        },
      },
    );

    xaiWs.on("open", () => {
      xaiWs.send(JSON.stringify(buildXaiSessionUpdate(session.preset)));
      sendInitialGreeting();
      log("info", "Connected Twilio stream to xAI", {
        streamSid,
        sessionId: session.id,
        callSid: session.callSid,
      });
    });

    xaiWs.on("message", (raw) => {
      let event;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (event.type === "response.output_audio.delta" && event.delta && streamSid) {
        sendToTwilio({
          event: "media",
          streamSid,
          media: { payload: event.delta },
        });
        markCounter += 1;
        sendToTwilio({
          event: "mark",
          streamSid,
          mark: { name: `${STREAM_MARK_PREFIX}-${markCounter}` },
        });
        return;
      }

      if (event.type === "input_audio_buffer.speech_started" && streamSid) {
        sendToTwilio({ event: "clear", streamSid });
        return;
      }

      if (event.type === "response.output_audio_transcript.delta" && event.delta) {
        session.transcript.push({ speaker: "assistant", text: event.delta });
        return;
      }

      if (event.type === "error") {
        log("error", "xAI realtime error", {
          sessionId: session.id,
          error: event.error?.message || JSON.stringify(event.error || event),
        });
      }
    });

    xaiWs.on("close", () => {
      log("info", "xAI WebSocket closed", {
        sessionId: session?.id,
        streamSid,
      });
    });

    xaiWs.on("error", (error) => {
      log("error", "xAI WebSocket error", {
        sessionId: session?.id,
        error: error.message,
      });
      closeBoth();
    });
  }

  twilioWs.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (data.event === "start") {
      streamSid = data.start?.streamSid;
      const sessionId = data.start?.customParameters?.sessionId;
      session = callSessions.get(sessionId);
      if (!session) {
        log("warn", "Media stream started without a matching session", {
          sessionId,
          streamSid,
          remoteAddress: request.socket.remoteAddress,
        });
        closeBoth();
        return;
      }
      session.streamSid = streamSid;
      connectToXai();
      return;
    }

    if (data.event === "media") {
      if (xaiWs && xaiWs.readyState === WebSocket.OPEN && data.media?.payload) {
        xaiWs.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: data.media.payload,
          }),
        );
      }
      return;
    }

    if (data.event === "stop") {
      log("info", "Twilio media stream stopped", {
        sessionId: session?.id,
        streamSid,
      });
      closeBoth();
    }
  });

  twilioWs.on("close", () => {
    if (xaiWs && xaiWs.readyState === WebSocket.OPEN) xaiWs.close();
  });

  twilioWs.on("error", (error) => {
    log("error", "Twilio media WebSocket error", { error: error.message });
    closeBoth();
  });
});

setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [sessionId, session] of callSessions.entries()) {
    if (session.createdAt < cutoff) {
      callSessions.delete(sessionId);
      if (session.callSid) callsBySid.delete(session.callSid);
    }
  }
}, 15 * 60 * 1000).unref();

server.listen(PORT, () => {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  log("info", "VoiceCall AI server listening", {
    port: PORT,
    publicHost: getPublicHost() || null,
    health: `http://localhost:${PORT}/health`,
    missingEnv: missing,
  });
});
