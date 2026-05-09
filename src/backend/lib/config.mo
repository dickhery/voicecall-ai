import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import Iter "mo:core/Iter";
import Types "../types/config";
import Common "../types/common";

module {
  public type State = {
    adminConfig : Types.AdminConfig;
    presets : Map.Map<Common.PresetId, Types.CallPreset>;
    nextPresetId : { var value : Nat };
  };

  public func initState() : State {
    {
      adminConfig = {
        var xaiApiKey = "";
        var twilioAccountSid = "";
        var twilioAuthToken = "";
        var twilioFromNumber = "";
      };
      presets = Map.empty<Common.PresetId, Types.CallPreset>();
      nextPresetId = { var value = 1 };
    };
  };

  // Admin config
  public func getAdminConfig(state : State) : {
    twilioAccountSid : Text;
    twilioFromNumber : Text;
    hasXaiKey : Bool;
    hasTwilioAuth : Bool;
  } {
    {
      twilioAccountSid = state.adminConfig.twilioAccountSid;
      twilioFromNumber = state.adminConfig.twilioFromNumber;
      hasXaiKey = state.adminConfig.xaiApiKey != "";
      hasTwilioAuth = state.adminConfig.twilioAuthToken != "";
    };
  };

  public func setAdminConfig(
    state : State,
    xaiApiKey : Text,
    twilioAccountSid : Text,
    twilioAuthToken : Text,
    twilioFromNumber : Text,
  ) {
    // Empty string means "keep existing value" — prevents partial saves from wiping other fields
    if (xaiApiKey != "") {
      state.adminConfig.xaiApiKey := xaiApiKey;
    };
    if (twilioAccountSid != "") {
      state.adminConfig.twilioAccountSid := twilioAccountSid;
    };
    if (twilioAuthToken != "") {
      state.adminConfig.twilioAuthToken := twilioAuthToken;
    };
    if (twilioFromNumber != "") {
      state.adminConfig.twilioFromNumber := twilioFromNumber;
    };
  };

  public func getXaiApiKey(state : State) : Text {
    state.adminConfig.xaiApiKey;
  };

  public func getTwilioCredentials(state : State) : {
    accountSid : Text;
    authToken : Text;
    fromNumber : Text;
  } {
    {
      accountSid = state.adminConfig.twilioAccountSid;
      authToken = state.adminConfig.twilioAuthToken;
      fromNumber = state.adminConfig.twilioFromNumber;
    };
  };

  // Preset CRUD
  public func createPreset(
    state : State,
    owner : Principal,
    input : Types.CallPresetInput,
  ) : Types.CallPreset {
    let id = state.nextPresetId.value;
    state.nextPresetId.value += 1;
    let preset : Types.CallPreset = {
      id;
      ownerId = owner;
      name = input.name;
      systemPrompt = input.systemPrompt;
      voice = input.voice;
      turnDetection = input.turnDetection;
      audioFormat = input.audioFormat;
      sampleRate = input.sampleRate;
      toolsEnabled = input.toolsEnabled;
    };
    state.presets.add(id, preset);
    preset;
  };

  public func getPreset(state : State, id : Common.PresetId) : ?Types.CallPreset {
    state.presets.get(id);
  };

  public func listPresetsForUser(
    state : State,
    userId : Principal,
  ) : [Types.CallPreset] {
    state.presets.values()
      .filter(func(p) { Principal.equal(p.ownerId, userId) })
      .toArray();
  };

  public func updatePreset(
    state : State,
    caller : Principal,
    id : Common.PresetId,
    input : Types.CallPresetInput,
  ) : ?Types.CallPreset {
    switch (state.presets.get(id)) {
      case null { null };
      case (?existing) {
        if (not Principal.equal(existing.ownerId, caller)) {
          Runtime.trap("Unauthorized: not the owner");
        };
        let updated : Types.CallPreset = {
          id = existing.id;
          ownerId = existing.ownerId;
          name = input.name;
          systemPrompt = input.systemPrompt;
          voice = input.voice;
          turnDetection = input.turnDetection;
          audioFormat = input.audioFormat;
          sampleRate = input.sampleRate;
          toolsEnabled = input.toolsEnabled;
        };
        state.presets.add(id, updated);
        ?updated;
      };
    };
  };

  public func deletePreset(
    state : State,
    caller : Principal,
    id : Common.PresetId,
  ) : Bool {
    switch (state.presets.get(id)) {
      case null { false };
      case (?existing) {
        if (not Principal.equal(existing.ownerId, caller)) {
          Runtime.trap("Unauthorized: not the owner");
        };
        state.presets.remove(id);
        true;
      };
    };
  };

  public func duplicatePreset(
    state : State,
    caller : Principal,
    id : Common.PresetId,
  ) : ?Types.CallPreset {
    switch (state.presets.get(id)) {
      case null { null };
      case (?existing) {
        let newId = state.nextPresetId.value;
        state.nextPresetId.value += 1;
        let copy : Types.CallPreset = {
          id = newId;
          ownerId = caller;
          name = existing.name # " (copy)";
          systemPrompt = existing.systemPrompt;
          voice = existing.voice;
          turnDetection = existing.turnDetection;
          audioFormat = existing.audioFormat;
          sampleRate = existing.sampleRate;
          toolsEnabled = existing.toolsEnabled;
        };
        state.presets.add(newId, copy);
        ?copy;
      };
    };
  };
};
