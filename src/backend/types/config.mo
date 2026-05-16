module {
  // xAI Voice API voice options
  public type Voice = {
    #eve;
    #ara;
    #rex;
    #sal;
    #leo;
  };

  // Turn detection configuration
  public type TurnDetection = {
    serverVad : Bool;
    threshold : Float;
    silenceDurationMs : Nat;
    prefixPaddingMs : Nat;
  };

  // Audio format options
  public type AudioFormat = {
    #pcmu;
    #pcm;
    #pcma;
  };

  // Sample rate options
  public type SampleRate = {
    #hz8000;
    #hz16000;
    #hz22050;
    #hz24000;
    #hz32000;
    #hz44100;
    #hz48000;
  };

  // Tool enablement options
  public type ToolsEnabled = {
    webSearch : Bool;
    xSearch : Bool;
    functionCalling : Bool;
  };

  // Call preset — user-configurable call template
  public type CallPreset = {
    id : Nat;
    ownerId : Principal;
    name : Text;
    systemPrompt : Text;
    voice : Voice;
    voiceId : ?Text;
    turnDetection : TurnDetection;
    audioFormat : AudioFormat;
    sampleRate : SampleRate;
    toolsEnabled : ToolsEnabled;
  };

  // Stable storage shape. Voice IDs are stored separately to keep upgrades compatible.
  public type StoredCallPreset = {
    id : Nat;
    ownerId : Principal;
    name : Text;
    systemPrompt : Text;
    voice : Voice;
    turnDetection : TurnDetection;
    audioFormat : AudioFormat;
    sampleRate : SampleRate;
    toolsEnabled : ToolsEnabled;
  };

  // Input type for creating/updating a preset (no id, no ownerId)
  public type CallPresetInput = {
    name : Text;
    systemPrompt : Text;
    voice : Voice;
    voiceId : ?Text;
    turnDetection : TurnDetection;
    audioFormat : AudioFormat;
    sampleRate : SampleRate;
    toolsEnabled : ToolsEnabled;
  };

  public type CallPresetMutationResult = {
    #ok : CallPreset;
    #err : Text;
  };

  public type AnsweringPresetStatus = {
    #pendingVerification;
    #verified;
  };

  public type AnsweringCaptureOptions = {
    saveTranscript : Bool;
    recordAudio : Bool;
    consentConfirmed : Bool;
  };

  public type AnsweringPreset = {
    id : Nat;
    ownerId : Principal;
    name : Text;
    phoneNumber : Text;
    systemPrompt : Text;
    voice : Voice;
    voiceId : ?Text;
    turnDetection : TurnDetection;
    audioFormat : AudioFormat;
    sampleRate : SampleRate;
    toolsEnabled : ToolsEnabled;
    captureOptions : AnsweringCaptureOptions;
    enabled : Bool;
    verificationStatus : AnsweringPresetStatus;
    webhookSecret : Text;
    createdAt : Int;
    updatedAt : Int;
    verifiedAt : ?Int;
    lastIncomingAt : ?Int;
  };

  // Stable storage shape. Voice IDs are stored separately to keep upgrades compatible.
  public type StoredAnsweringPreset = {
    id : Nat;
    ownerId : Principal;
    name : Text;
    phoneNumber : Text;
    systemPrompt : Text;
    voice : Voice;
    turnDetection : TurnDetection;
    audioFormat : AudioFormat;
    sampleRate : SampleRate;
    toolsEnabled : ToolsEnabled;
    captureOptions : AnsweringCaptureOptions;
    enabled : Bool;
    verificationStatus : AnsweringPresetStatus;
    webhookSecret : Text;
    createdAt : Int;
    updatedAt : Int;
    verifiedAt : ?Int;
    lastIncomingAt : ?Int;
  };

  public type AnsweringPresetInput = {
    name : Text;
    phoneNumber : Text;
    systemPrompt : Text;
    voice : Voice;
    voiceId : ?Text;
    turnDetection : TurnDetection;
    audioFormat : AudioFormat;
    sampleRate : SampleRate;
    toolsEnabled : ToolsEnabled;
    captureOptions : AnsweringCaptureOptions;
    enabled : Bool;
    webhookSecret : Text;
  };

  public type AnsweringPresetMutationResult = {
    #ok : AnsweringPreset;
    #err : Text;
  };

  public type TwilioLine = {
    phoneNumber : Text;
    name : Text;
    enabled : Bool;
  };

  public type TwilioLineInput = {
    phoneNumber : Text;
    name : Text;
    enabled : Bool;
  };

  public type TwilioLineMutationResult = {
    #ok : [TwilioLine];
    #err : Text;
  };

  // Admin-stored service credentials
  public type AdminConfig = {
    var xaiApiKey : Text;
    var twilioAccountSid : Text;
    var twilioAuthToken : Text;
    var twilioFromNumber : Text;
  };
};
