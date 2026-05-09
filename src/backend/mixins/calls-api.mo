import Runtime "mo:core/Runtime";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Text "mo:core/Text";
import Blob "mo:core/Blob";
import Array "mo:core/Array";
import Nat8 "mo:core/Nat8";
import OutCall "mo:caffeineai-http-outcalls/outcall";
import AccessControl "mo:caffeineai-authorization/access-control";
import CallsLib "../lib/calls";
import ConfigLib "../lib/config";
import CallTypes "../types/calls";
import Common "../types/common";
import Char "mo:core/Char";
import Error "mo:core/Error";

mixin (
  accessControlState : AccessControl.AccessControlState,
  callsState : CallsLib.State,
  configState : ConfigLib.State,
) {
  // Transform callback for IC HTTP outcalls (must be query)
  public query func transform(
    input : OutCall.TransformationInput
  ) : async OutCall.TransformationOutput {
    OutCall.transform(input);
  };

  // Create an on-chain call record before the external voice server places the
  // Twilio call. Real-time Twilio/xAI traffic cannot reliably run from the IC.
  public shared ({ caller }) func initiateCall(
    input : CallTypes.InitiateCallInput,
  ) : async CallTypes.InitiateCallResult {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ignore input;
    #err("Billing is enabled. Reserve prepaid phone time with reserveCall before starting a call.");
  };

  // Twilio webhook: accept TwiML callback and return XML to keep call alive
  // The browser connects directly to xAI using the ephemeral token for AI audio.
  public shared func twilioWebhook(
    callSid : Text,
    callStatus : Text,
  ) : async Text {
    CallsLib.addSystemLog(callsState, #info, "Twilio webhook: " # callSid # " status=" # callStatus, null);
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Say>Connecting you to the AI assistant. Please wait.</Say><Pause length=\"120\"/></Response>";
  };

  // Ephemeral token endpoint: request session token from xAI
  public shared ({ caller }) func getEphemeralToken(
    presetId : Common.PresetId,
  ) : async CallTypes.EphemeralTokenResult {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    let xaiKey = ConfigLib.getXaiApiKey(configState);
    if (xaiKey == "") {
      return #err("xAI API key not configured. Admin must set credentials first.");
    };
    // Verify the preset exists (we don't embed its config in the token request)
    switch (ConfigLib.getPreset(configState, presetId)) {
      case null { return #err("Preset not found") };
      case (?_) {};
    };

    // Only expires_after is accepted by /v1/realtime/client_secrets.
    // Session config (voice, instructions, turn_detection, tools) is applied
    // via session.update on the WebSocket after connection — not here.
    let headers : [OutCall.Header] = [
      { name = "Content-Type"; value = "application/json" },
      { name = "Authorization"; value = "Bearer " # xaiKey },
    ];

    try {
      // xAI ephemeral token endpoint: POST /v1/realtime/client_secrets
      // Response: { "value": "<token>", "expires_at": ..., ... }
      // IMPORTANT: only send expires_after — no model/voice/session fields.
      let responseText = await OutCall.httpPostRequest(
        "https://api.x.ai/v1/realtime/client_secrets",
        headers,
        "{\"expires_after\":{\"seconds\":300}}",
        transform,
      );
      // The response has a top-level "value" field containing the ephemeral token
      let token = switch (extractJsonField(responseText, "value")) {
        case null { return #err("Unexpected xAI response: " # responseText) };
        case (?t) { t };
      };
      // Browser WebSocket auth uses subprotocol: xai-client-secret.<token>
      // The frontend will construct the full WS URL with the model param
      let wsUrl = "wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-1.0";
      #ok({ token; websocketUrl = wsUrl });
    } catch (e) {
      CallsLib.addSystemLog(callsState, #error_, "xAI token error: " # e.message(), null);
      #err("Failed to get ephemeral token: " # e.message());
    };
  };

  // Update call record on completion/failure (called by client)
  public shared ({ caller }) func updateCallStatus(
    callId : Common.CallId,
    status : CallTypes.CallStatus,
    transcript : ?Text,
  ) : async Bool {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    let endTime : ?Int = switch status {
      case (#completed) { ?Time.now() };
      case (#failed) { ?Time.now() };
      case _ { null };
    };
    CallsLib.updateCallRecord(callsState, callId, status, null, endTime, transcript);
  };

  // Call history for authenticated user
  public query ({ caller }) func listMyCalls() : async [CallTypes.CallRecordPublic] {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    CallsLib.listCallsForUser(callsState, caller);
  };

  public query ({ caller }) func getCallRecord(
    id : Common.CallId,
  ) : async ?CallTypes.CallRecordPublic {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    switch (CallsLib.getCallRecord(callsState, id)) {
      case null { null };
      case (?r) {
        if (not Principal.equal(r.userId, caller) and not AccessControl.isAdmin(accessControlState, caller)) {
          Runtime.trap("Unauthorized: can only view your own calls");
        };
        ?CallsLib.toPublic(r);
      };
    };
  };

  // Admin: list all users' calls
  public query ({ caller }) func adminListAllCalls() : async [CallTypes.CallRecordPublic] {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: admin only");
    };
    CallsLib.listAllCalls(callsState);
  };

  // Admin: view a specific user's call history
  public query ({ caller }) func adminListUserCalls(
    userId : Principal,
  ) : async [CallTypes.CallRecordPublic] {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: admin only");
    };
    CallsLib.listCallsForUser(callsState, userId);
  };

  // Admin: system logs
  public query ({ caller }) func adminGetSystemLogs(
    limit : Nat,
  ) : async [CallTypes.SystemLog] {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: admin only");
    };
    CallsLib.getSystemLogs(callsState, limit);
  };

  // --- Private helpers ---

  // Build tools JSON array fragment based on toolsEnabled flags
  private func buildToolsJson(tools : { webSearch : Bool; xSearch : Bool; functionCalling : Bool }) : Text {
    var parts : [Text] = [];
    if (tools.webSearch) {
      parts := parts.concat(["{\"type\":\"web_search\"}"]);
    };
    if (tools.xSearch) {
      parts := parts.concat(["{\"type\":\"x_search\"}"]);
    };
    if (tools.functionCalling) {
      parts := parts.concat(["{\"type\":\"function_calling\"}"]);
    };
    parts.values().join(",");
  };

  // Escape special characters in JSON string values
  private func escapeJson(text : Text) : Text {
    var result = "";
    for (c in text.chars()) {
      result #= switch (c) {
        case ('\\') { "\\\\" };
        case ('\t') { "\\t" };
        case ('\n') { "\\n" };
        case ('\r') { "\\r" };
        case (_) {
          if (c.toNat32() == 34) { "\\\"" } else { c.toText() };
        };
      };
    };
    result;
  };

  // Simple extraction of a JSON string field value (handles simple flat JSON)
  private func extractJsonField(json : Text, field : Text) : ?Text {
    let quoteChar = Char.fromNat32(34); // '"'
    let needle = quoteChar.toText() # field # quoteChar.toText() # ":" # quoteChar.toText();
    var segments = json.split(#text needle);
    switch (segments.next()) {
      case null { null };
      case (?_first) {
        switch (segments.next()) {
          case null { null };
          case (?afterNeedle) {
            let chars = afterNeedle.toArray();
            var i = 0;
            var value = "";
            var escaped = false;
            var done = false;
            while (i < chars.size() and not done) {
              let c = chars[i];
              if (escaped) {
                value #= c.toText();
                escaped := false;
              } else if (c == '\\') {
                escaped := true;
              } else if (c == quoteChar) {
                done := true;
              } else {
                value #= c.toText();
              };
              i += 1;
            };
            if (done) { ?value } else { null };
          };
        };
      };
    };
  };

  // Float to text representation
  private func floatToText(f : Float) : Text {
    debug_show(f);
  };

  // Base64 encode a UTF-8 string (for HTTP Basic auth header)
  private func encodeBase64(input : Text) : Text {
    let alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let alphaArr = alphabet.toArray();
    let bytes = input.encodeUtf8().toArray();
    let n = bytes.size();
    var result = "";
    var i = 0;
    while (i + 2 < n) {
      let b0 = bytes[i].toNat();
      let b1 = bytes[i + 1].toNat();
      let b2 = bytes[i + 2].toNat();
      result #= Text.fromChar(alphaArr[b0 / 4]);
      result #= Text.fromChar(alphaArr[((b0 % 4) * 16) + (b1 / 16)]);
      result #= Text.fromChar(alphaArr[((b1 % 16) * 4) + (b2 / 64)]);
      result #= Text.fromChar(alphaArr[b2 % 64]);
      i += 3;
    };
    if (i + 1 == n) {
      let b0 = bytes[i].toNat();
      result #= Text.fromChar(alphaArr[b0 / 4]);
      result #= Text.fromChar(alphaArr[(b0 % 4) * 16]);
      result #= "==";
    } else if (i + 2 == n) {
      let b0 = bytes[i].toNat();
      let b1 = bytes[i + 1].toNat();
      result #= Text.fromChar(alphaArr[b0 / 4]);
      result #= Text.fromChar(alphaArr[((b0 % 4) * 16) + (b1 / 16)]);
      result #= Text.fromChar(alphaArr[(b1 % 16) * 4]);
      result #= "=";
    };
    result;
  };
};
