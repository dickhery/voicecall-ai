module {
  public type CallStatus = {
    #pending;
    #inProgress;
    #completed;
    #failed;
  };

  // Call history log entry
  public type CallRecord = {
    id : Nat;
    userId : Principal;
    recipientPhone : Text;
    presetId : Nat;
    startTime : Int;
    var endTime : ?Int;
    var status : CallStatus;
    var callSid : ?Text;
    var transcript : ?Text;
  };

  // Shared (immutable) version for API responses
  public type CallRecordPublic = {
    id : Nat;
    userId : Principal;
    recipientPhone : Text;
    presetId : Nat;
    startTime : Int;
    endTime : ?Int;
    status : CallStatus;
    callSid : ?Text;
    transcript : ?Text;
  };

  // Input for initiating a call
  public type InitiateCallInput = {
    recipientPhone : Text;
    presetId : Nat;
  };

  // Response from initiating a call
  public type InitiateCallResult = {
    #ok : { callId : Nat; callSid : Text };
    #err : Text;
  };

  // Ephemeral token response
  public type EphemeralTokenResult = {
    #ok : { token : Text; websocketUrl : Text };
    #err : Text;
  };

  // System log entry
  public type SystemLog = {
    timestamp : Int;
    level : { #info; #warn; #error_ };
    message : Text;
    callId : ?Nat;
  };
};
