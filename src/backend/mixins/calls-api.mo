import Runtime "mo:core/Runtime";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Text "mo:core/Text";
import AccessControl "mo:caffeineai-authorization/access-control";
import CallsLib "../lib/calls";
import ConfigLib "../lib/config";
import CallTypes "../types/calls";
import Common "../types/common";

mixin (
  accessControlState : AccessControl.AccessControlState,
  callsState : CallsLib.State,
  answeringLiveState : CallsLib.AnsweringLiveState,
  configState : ConfigLib.State,
  callPresetVoiceIds : ConfigLib.VoiceIdState,
) {
  let MAX_CALL_TRANSCRIPT_CHARS : Nat = 20_000;

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
  public shared ({ caller }) func twilioWebhook(
    callSid : Text,
    callStatus : Text,
  ) : async Text {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    CallsLib.addSystemLog(callsState, #info, "Twilio webhook: " # callSid # " status=" # callStatus, null);
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Say>Connecting you to the AI assistant. Please wait.</Say><Pause length=\"120\"/></Response>";
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
    let isAdmin = AccessControl.isAdmin(accessControlState, caller);
    switch (CallsLib.getCallRecord(callsState, callId)) {
      case null { return false };
      case (?record) {
        if (not Principal.equal(record.userId, caller) and not isAdmin) {
          return false;
        };
      };
    };
    if (not isAdmin) {
      switch (status) {
        case (#failed) {};
        case _ { return false };
      };
      switch (transcript) {
        case null {};
        case (?_) { return false };
      };
    };
    switch (transcript) {
      case null {};
      case (?text) {
        if (text.toArray().size() > MAX_CALL_TRANSCRIPT_CHARS) {
          return false;
        };
      };
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

  public shared ({ caller }) func registerAnsweringLiveSessionForServer(
    session : CallTypes.AnsweringLiveSession,
  ) : async Bool {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    CallsLib.registerAnsweringLiveSession(answeringLiveState, session);
    true;
  };

  public shared ({ caller }) func finishAnsweringLiveSessionForServer(
    sessionId : Text,
  ) : async Bool {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    CallsLib.removeAnsweringLiveSession(answeringLiveState, sessionId);
  };

  public query ({ caller }) func listMyAnsweringLiveSessions() : async [CallTypes.AnsweringLiveSession] {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    CallsLib.listAnsweringLiveSessionsForUser(answeringLiveState, caller);
  };
};
