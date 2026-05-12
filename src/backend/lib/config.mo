import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import Iter "mo:core/Iter";
import Text "mo:core/Text";
import Char "mo:core/Char";
import Array "mo:core/Array";
import Order "mo:core/Order";
import Types "../types/config";
import Common "../types/common";

module {
  public type State = {
    adminConfig : Types.AdminConfig;
    presets : Map.Map<Common.PresetId, Types.CallPreset>;
    nextPresetId : { var value : Nat };
  };

  public type TwilioLineState = Map.Map<Text, Types.TwilioLine>;

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

  public func initTwilioLineState() : TwilioLineState {
    Map.empty<Text, Types.TwilioLine>();
  };

  private func isDigit(c : Char) : Bool {
    let code = c.toNat32();
    code >= 48 and code <= 57;
  };

  private func isNonZeroDigit(c : Char) : Bool {
    let code = c.toNat32();
    code >= 49 and code <= 57;
  };

  private func isE164(phoneNumber : Text) : Bool {
    let chars = phoneNumber.toArray();
    let size = chars.size();
    if (size < 3 or size > 16) {
      return false;
    };
    if (chars[0] != '+') {
      return false;
    };
    if (not isNonZeroDigit(chars[1])) {
      return false;
    };
    var i = 2;
    while (i < size) {
      if (not isDigit(chars[i])) {
        return false;
      };
      i += 1;
    };
    true;
  };

  private func compareLines(a : Types.TwilioLine, b : Types.TwilioLine) : Order.Order {
    Text.compare(a.phoneNumber, b.phoneNumber);
  };

  private func withPresetDefaults(preset : Types.CallPreset) : Types.CallPreset {
    {
      preset with
      audioFormat = #pcmu;
      sampleRate = #hz8000;
      toolsEnabled = {
        webSearch = false;
        xSearch = false;
        functionCalling = false;
      };
    };
  };

  private func legacyTwilioLine(state : State) : ?Types.TwilioLine {
    let phoneNumber = state.adminConfig.twilioFromNumber;
    if (phoneNumber == "" or not isE164(phoneNumber)) {
      return null;
    };
    ?{
      phoneNumber;
      name = "Primary line";
      enabled = true;
    };
  };

  private func sanitizeLineInput(input : Types.TwilioLineInput) : {
    #ok : Types.TwilioLine;
    #err : Text;
  } {
    if (not isE164(input.phoneNumber)) {
      return #err("Phone number must be E.164 format, for example +15551234567.");
    };
    #ok({
      phoneNumber = input.phoneNumber;
      name = if (input.name == "") { input.phoneNumber } else { input.name };
      enabled = input.enabled;
    });
  };

  public func listTwilioLines(
    state : State,
    twilioLineState : TwilioLineState,
  ) : [Types.TwilioLine] {
    let configured = twilioLineState.values().toArray();
    if (configured.size() == 0) {
      switch (legacyTwilioLine(state)) {
        case null { [] };
        case (?line) { [line] };
      };
    } else {
      Array.sort(configured, compareLines);
    };
  };

  public func listEnabledTwilioNumbers(
    state : State,
    twilioLineState : TwilioLineState,
  ) : [Text] {
    listTwilioLines(state, twilioLineState)
      .values()
      .filter(func(line) { line.enabled })
      .map(func(line) { line.phoneNumber })
      .toArray();
  };

  // Admin config
  public func getAdminConfig(
    state : State,
    twilioLineState : TwilioLineState,
  ) : {
    twilioAccountSid : Text;
    twilioFromNumber : Text;
    twilioPhoneNumbers : [Types.TwilioLine];
    hasXaiKey : Bool;
    hasTwilioAuth : Bool;
  } {
    {
      twilioAccountSid = state.adminConfig.twilioAccountSid;
      twilioFromNumber = state.adminConfig.twilioFromNumber;
      twilioPhoneNumbers = listTwilioLines(state, twilioLineState);
      hasXaiKey = state.adminConfig.xaiApiKey != "";
      hasTwilioAuth = state.adminConfig.twilioAuthToken != "";
    };
  };

  public func setAdminConfig(
    state : State,
    twilioLineState : TwilioLineState,
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
      if (isE164(twilioFromNumber)) {
        twilioLineState.add(twilioFromNumber, {
          phoneNumber = twilioFromNumber;
          name = "Primary line";
          enabled = true;
        });
      };
    };
  };

  public func setTwilioLine(
    state : State,
    twilioLineState : TwilioLineState,
    input : Types.TwilioLineInput,
  ) : Types.TwilioLineMutationResult {
    switch (sanitizeLineInput(input)) {
      case (#err(message)) { #err(message) };
      case (#ok(line)) {
        twilioLineState.add(line.phoneNumber, line);
        if (state.adminConfig.twilioFromNumber == "") {
          state.adminConfig.twilioFromNumber := line.phoneNumber;
        };
        #ok(listTwilioLines(state, twilioLineState));
      };
    };
  };

  public func removeTwilioLine(
    state : State,
    twilioLineState : TwilioLineState,
    phoneNumber : Text,
  ) : Types.TwilioLineMutationResult {
    if (not isE164(phoneNumber)) {
      return #err("Phone number must be E.164 format, for example +15551234567.");
    };
    switch (twilioLineState.get(phoneNumber)) {
      case null {
        if (state.adminConfig.twilioFromNumber == phoneNumber) {
          state.adminConfig.twilioFromNumber := "";
        };
        #ok(listTwilioLines(state, twilioLineState));
      };
      case (?_) {
        twilioLineState.remove(phoneNumber);
        if (state.adminConfig.twilioFromNumber == phoneNumber) {
          state.adminConfig.twilioFromNumber := "";
        };
        #ok(listTwilioLines(state, twilioLineState));
      };
    };
  };

  public func setTwilioLineEnabled(
    state : State,
    twilioLineState : TwilioLineState,
    phoneNumber : Text,
    enabled : Bool,
  ) : Types.TwilioLineMutationResult {
    if (not isE164(phoneNumber)) {
      return #err("Phone number must be E.164 format, for example +15551234567.");
    };
    switch (twilioLineState.get(phoneNumber)) {
      case null {
        switch (legacyTwilioLine(state)) {
          case (?line) {
            if (line.phoneNumber == phoneNumber) {
              twilioLineState.add(phoneNumber, { line with enabled });
              return #ok(listTwilioLines(state, twilioLineState));
            };
          };
          case null {};
        };
        #err("Twilio line not found");
      };
      case (?line) {
        twilioLineState.add(phoneNumber, { line with enabled });
        #ok(listTwilioLines(state, twilioLineState));
      };
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
    let preset : Types.CallPreset = withPresetDefaults({
      id;
      ownerId = owner;
      name = input.name;
      systemPrompt = input.systemPrompt;
      voice = input.voice;
      turnDetection = input.turnDetection;
      audioFormat = input.audioFormat;
      sampleRate = input.sampleRate;
      toolsEnabled = input.toolsEnabled;
    });
    state.presets.add(id, preset);
    preset;
  };

  public func getPreset(state : State, id : Common.PresetId) : ?Types.CallPreset {
    switch (state.presets.get(id)) {
      case null { null };
      case (?preset) { ?withPresetDefaults(preset) };
    };
  };

  public func listPresetsForUser(
    state : State,
    userId : Principal,
  ) : [Types.CallPreset] {
    state.presets.values()
      .filter(func(p) { Principal.equal(p.ownerId, userId) })
      .map(withPresetDefaults)
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
        let updated : Types.CallPreset = withPresetDefaults({
          id = existing.id;
          ownerId = existing.ownerId;
          name = input.name;
          systemPrompt = input.systemPrompt;
          voice = input.voice;
          turnDetection = input.turnDetection;
          audioFormat = input.audioFormat;
          sampleRate = input.sampleRate;
          toolsEnabled = input.toolsEnabled;
        });
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
        let copy : Types.CallPreset = withPresetDefaults({
          id = newId;
          ownerId = caller;
          name = existing.name # " (copy)";
          systemPrompt = existing.systemPrompt;
          voice = existing.voice;
          turnDetection = existing.turnDetection;
          audioFormat = existing.audioFormat;
          sampleRate = existing.sampleRate;
          toolsEnabled = existing.toolsEnabled;
        });
        state.presets.add(newId, copy);
        ?copy;
      };
    };
  };
};
