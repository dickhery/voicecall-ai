import Map "mo:core/Map";
import List "mo:core/List";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Text "mo:core/Text";
import Char "mo:core/Char";
import Array "mo:core/Array";
import Order "mo:core/Order";
import Time "mo:core/Time";
import Types "../types/config";
import Common "../types/common";

module {
  public type State = {
    adminConfig : Types.AdminConfig;
    presets : Map.Map<Common.PresetId, Types.CallPreset>;
    nextPresetId : { var value : Nat };
  };

  public type TwilioLineState = Map.Map<Text, Types.TwilioLine>;

  public type AnsweringState = {
    presets : Map.Map<Common.PresetId, Types.AnsweringPreset>;
    presetIdsByOwner : Map.Map<Principal, List.List<Common.PresetId>>;
    presetIdByWebhookSecret : Map.Map<Text, Common.PresetId>;
    presetIdByPhoneNumber : Map.Map<Text, Common.PresetId>;
    nextAnsweringPresetId : { var value : Nat };
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

  public func initTwilioLineState() : TwilioLineState {
    Map.empty<Text, Types.TwilioLine>();
  };

  public func initAnsweringState() : AnsweringState {
    {
      presets = Map.empty<Common.PresetId, Types.AnsweringPreset>();
      presetIdsByOwner = Map.empty<Principal, List.List<Common.PresetId>>();
      presetIdByWebhookSecret = Map.empty<Text, Common.PresetId>();
      presetIdByPhoneNumber = Map.empty<Text, Common.PresetId>();
      nextAnsweringPresetId = { var value = 1 };
    };
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

  private func compareAnsweringNewestFirst(a : Types.AnsweringPreset, b : Types.AnsweringPreset) : Order.Order {
    switch (Int.compare(b.createdAt, a.createdAt)) {
      case (#equal) { Nat.compare(b.id, a.id) };
      case (order) { order };
    };
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

  private func isWebhookSecretChar(c : Char) : Bool {
    let code = c.toNat32();
    (code >= 48 and code <= 57) or
    (code >= 65 and code <= 90) or
    (code >= 97 and code <= 122) or
    c == '-' or c == '_';
  };

  private func isValidWebhookSecret(secret : Text) : Bool {
    let chars = secret.toArray();
    let size = chars.size();
    if (size < 32 or size > 160) {
      return false;
    };
    var i = 0;
    while (i < size) {
      if (not isWebhookSecretChar(chars[i])) {
        return false;
      };
      i += 1;
    };
    true;
  };

  private func sanitizeAnsweringInput(input : Types.AnsweringPresetInput) : {
    #ok : Types.AnsweringPresetInput;
    #err : Text;
  } {
    let name = input.name.trim(#char ' ');
    let prompt = input.systemPrompt.trim(#char ' ');
    if (name == "") {
      return #err("Preset name is required.");
    };
    if (prompt == "") {
      return #err("AI answering instructions are required.");
    };
    if (not isE164(input.phoneNumber)) {
      return #err("Twilio phone number must be E.164 format, for example +15551234567.");
    };
    if (not isValidWebhookSecret(input.webhookSecret)) {
      return #err("Webhook verification secret is invalid.");
    };
    if (
      (input.captureOptions.saveTranscript or input.captureOptions.recordAudio) and
      not input.captureOptions.consentConfirmed
    ) {
      return #err("Confirm caller consent before saving transcripts or recordings.");
    };
    #ok({
      input with
      name = name;
      systemPrompt = prompt;
      audioFormat = #pcmu;
      sampleRate = #hz8000;
      toolsEnabled = {
        webSearch = input.toolsEnabled.webSearch;
        xSearch = input.toolsEnabled.xSearch;
        functionCalling = false;
      };
    });
  };

  private func getExistingPendingAnsweringPreset(
    state : AnsweringState,
    owner : Principal,
  ) : ?Types.AnsweringPreset {
    for (preset in state.presets.values()) {
      if (
        Principal.equal(preset.ownerId, owner) and
        preset.verificationStatus == #pendingVerification
      ) {
        return ?preset;
      };
    };
    null;
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

  public func createAnsweringPreset(
    state : AnsweringState,
    owner : Principal,
    input : Types.AnsweringPresetInput,
  ) : Types.AnsweringPresetMutationResult {
    switch (getExistingPendingAnsweringPreset(state, owner)) {
      case (?_) {
        return #err("Finish verifying your pending Twilio number before creating another answering preset.");
      };
      case null {};
    };
    switch (sanitizeAnsweringInput(input)) {
      case (#err(message)) { #err(message) };
      case (#ok(cleanInput)) {
        switch (state.presetIdByPhoneNumber.get(cleanInput.phoneNumber)) {
          case (?_) { return #err("That Twilio phone number is already assigned to an answering preset.") };
          case null {};
        };
        switch (state.presetIdByWebhookSecret.get(cleanInput.webhookSecret)) {
          case (?_) { return #err("Webhook verification secret is already in use.") };
          case null {};
        };

        let id = state.nextAnsweringPresetId.value;
        state.nextAnsweringPresetId.value += 1;
        let now = Time.now();
        let preset : Types.AnsweringPreset = {
          id;
          ownerId = owner;
          name = cleanInput.name;
          phoneNumber = cleanInput.phoneNumber;
          systemPrompt = cleanInput.systemPrompt;
          voice = cleanInput.voice;
          turnDetection = cleanInput.turnDetection;
          audioFormat = #pcmu;
          sampleRate = #hz8000;
          toolsEnabled = cleanInput.toolsEnabled;
          captureOptions = cleanInput.captureOptions;
          enabled = cleanInput.enabled;
          verificationStatus = #pendingVerification;
          webhookSecret = cleanInput.webhookSecret;
          createdAt = now;
          updatedAt = now;
          verifiedAt = null;
          lastIncomingAt = null;
        };

        state.presets.add(id, preset);
        state.presetIdByWebhookSecret.add(preset.webhookSecret, id);
        state.presetIdByPhoneNumber.add(preset.phoneNumber, id);
        switch (state.presetIdsByOwner.get(owner)) {
          case null {
            let ids = List.empty<Common.PresetId>();
            ids.add(id);
            state.presetIdsByOwner.add(owner, ids);
          };
          case (?ids) { ids.add(id) };
        };
        #ok(preset);
      };
    };
  };

  public func listAnsweringPresetsForUser(
    state : AnsweringState,
    owner : Principal,
  ) : [Types.AnsweringPreset] {
    let presets = List.empty<Types.AnsweringPreset>();
    switch (state.presetIdsByOwner.get(owner)) {
      case null {};
      case (?ids) {
        ids.forEach(func(id) {
          switch (state.presets.get(id)) {
            case null {};
            case (?preset) { presets.add(preset) };
          };
        });
      };
    };
    Array.sort(presets.toArray(), compareAnsweringNewestFirst);
  };

  public func getAnsweringPreset(
    state : AnsweringState,
    id : Common.PresetId,
  ) : ?Types.AnsweringPreset {
    state.presets.get(id);
  };

  public func getAnsweringPresetForServer(
    state : AnsweringState,
    webhookSecret : Text,
    phoneNumber : Text,
  ) : ?Types.AnsweringPreset {
    switch (state.presetIdByWebhookSecret.get(webhookSecret)) {
      case null { null };
      case (?id) {
        switch (state.presets.get(id)) {
          case null { null };
          case (?preset) {
            if (preset.phoneNumber == phoneNumber) { ?preset } else { null };
          };
        };
      };
    };
  };

  public func getAnsweringPresetForIncoming(
    state : AnsweringState,
    webhookSecret : Text,
    phoneNumber : Text,
  ) : { #ok : Types.AnsweringPreset; #err : Text } {
    switch (getAnsweringPresetForServer(state, webhookSecret, phoneNumber)) {
      case null { #err("Answering preset was not found for this Twilio number.") };
      case (?preset) {
        if (preset.verificationStatus != #verified) {
          return #err("Answering preset phone number is not verified yet.");
        };
        if (not preset.enabled) {
          return #err("Answering service is turned off for this preset.");
        };
        #ok(preset);
      };
    };
  };

  public func updateAnsweringPreset(
    state : AnsweringState,
    caller : Principal,
    id : Common.PresetId,
    input : Types.AnsweringPresetInput,
  ) : Types.AnsweringPresetMutationResult {
    switch (state.presets.get(id)) {
      case null { #err("Answering preset not found.") };
      case (?existing) {
        if (not Principal.equal(existing.ownerId, caller)) {
          Runtime.trap("Unauthorized: not the owner");
        };
        switch (sanitizeAnsweringInput(input)) {
          case (#err(message)) { #err(message) };
          case (#ok(cleanInput)) {
            if (cleanInput.phoneNumber != existing.phoneNumber) {
              switch (state.presetIdByPhoneNumber.get(cleanInput.phoneNumber)) {
                case (?otherId) {
                  if (otherId != id) {
                    return #err("That Twilio phone number is already assigned to an answering preset.");
                  };
                };
                case null {};
              };
            };
            if (cleanInput.webhookSecret != existing.webhookSecret) {
              switch (state.presetIdByWebhookSecret.get(cleanInput.webhookSecret)) {
                case (?otherId) {
                  if (otherId != id) {
                    return #err("Webhook verification secret is already in use.");
                  };
                };
                case null {};
              };
            };

            let phoneChanged = cleanInput.phoneNumber != existing.phoneNumber;
            if (phoneChanged) {
              state.presetIdByPhoneNumber.remove(existing.phoneNumber);
              state.presetIdByPhoneNumber.add(cleanInput.phoneNumber, id);
            };
            if (cleanInput.webhookSecret != existing.webhookSecret) {
              state.presetIdByWebhookSecret.remove(existing.webhookSecret);
              state.presetIdByWebhookSecret.add(cleanInput.webhookSecret, id);
            };

            let updated : Types.AnsweringPreset = {
              id = existing.id;
              ownerId = existing.ownerId;
              name = cleanInput.name;
              phoneNumber = cleanInput.phoneNumber;
              systemPrompt = cleanInput.systemPrompt;
              voice = cleanInput.voice;
              turnDetection = cleanInput.turnDetection;
              audioFormat = #pcmu;
              sampleRate = #hz8000;
              toolsEnabled = cleanInput.toolsEnabled;
              captureOptions = cleanInput.captureOptions;
              enabled = if (phoneChanged) { false } else { cleanInput.enabled };
              verificationStatus = if (phoneChanged) { #pendingVerification } else { existing.verificationStatus };
              webhookSecret = cleanInput.webhookSecret;
              createdAt = existing.createdAt;
              updatedAt = Time.now();
              verifiedAt = if (phoneChanged) { null } else { existing.verifiedAt };
              lastIncomingAt = existing.lastIncomingAt;
            };
            state.presets.add(id, updated);
            #ok(updated);
          };
        };
      };
    };
  };

  public func deleteAnsweringPreset(
    state : AnsweringState,
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
        state.presetIdByWebhookSecret.remove(existing.webhookSecret);
        state.presetIdByPhoneNumber.remove(existing.phoneNumber);
        true;
      };
    };
  };

  public func setAnsweringPresetEnabled(
    state : AnsweringState,
    caller : Principal,
    id : Common.PresetId,
    enabled : Bool,
  ) : Types.AnsweringPresetMutationResult {
    switch (state.presets.get(id)) {
      case null { #err("Answering preset not found.") };
      case (?existing) {
        if (not Principal.equal(existing.ownerId, caller)) {
          Runtime.trap("Unauthorized: not the owner");
        };
        if (enabled and existing.verificationStatus != #verified) {
          return #err("Verify this Twilio number before turning on the answering service.");
        };
        let updated : Types.AnsweringPreset = {
          existing with
          enabled = enabled;
          updatedAt = Time.now();
        };
        state.presets.add(id, updated);
        #ok(updated);
      };
    };
  };

  public func verifyAnsweringPresetForServer(
    state : AnsweringState,
    webhookSecret : Text,
    phoneNumber : Text,
  ) : Types.AnsweringPresetMutationResult {
    if (not isE164(phoneNumber)) {
      return #err("Twilio phone number must be E.164 format.");
    };
    switch (getAnsweringPresetForServer(state, webhookSecret, phoneNumber)) {
      case null { #err("Answering preset was not found for this Twilio number.") };
      case (?existing) {
        let now = Time.now();
        let updated : Types.AnsweringPreset = {
          existing with
          verificationStatus = #verified;
          verifiedAt = ?now;
          updatedAt = now;
        };
        state.presets.add(existing.id, updated);
        #ok(updated);
      };
    };
  };

  public func markAnsweringPresetIncoming(
    state : AnsweringState,
    id : Common.PresetId,
  ) {
    switch (state.presets.get(id)) {
      case null {};
      case (?existing) {
        state.presets.add(id, { existing with lastIncomingAt = ?Time.now() });
      };
    };
  };
};
