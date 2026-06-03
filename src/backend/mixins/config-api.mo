import Runtime "mo:core/Runtime";
import Principal "mo:core/Principal";
import AccessControl "mo:caffeineai-authorization/access-control";
import ConfigLib "../lib/config";
import ConfigTypes "../types/config";
import Common "../types/common";

mixin (
  accessControlState : AccessControl.AccessControlState,
  configState : ConfigLib.State,
  callPresetVoiceIds : ConfigLib.VoiceIdState,
  twilioLineState : ConfigLib.TwilioLineState,
  answeringState : ConfigLib.AnsweringState,
  answeringPresetVoiceIds : ConfigLib.VoiceIdState,
) {
  // Admin: view current service config (masked secrets)
  public query ({ caller }) func getAdminConfig() : async {
    twilioAccountSid : Text;
    twilioFromNumber : Text;
    twilioPhoneNumbers : [ConfigTypes.TwilioLine];
    hasXaiKey : Bool;
    hasTwilioAuth : Bool;
  } {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: admin only");
    };
    ConfigLib.getAdminConfig(configState, twilioLineState);
  };

  // Admin: update all service credentials at once
  public shared ({ caller }) func setAdminConfig(
    xaiApiKey : Text,
    twilioAccountSid : Text,
    twilioAuthToken : Text,
    twilioFromNumber : Text,
  ) : async () {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: admin only");
    };
    ConfigLib.setAdminConfig(configState, twilioLineState, xaiApiKey, twilioAccountSid, twilioAuthToken, twilioFromNumber);
  };

  public shared ({ caller }) func setTwilioLine(
    input : ConfigTypes.TwilioLineInput,
  ) : async ConfigTypes.TwilioLineMutationResult {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: admin only");
    };
    ConfigLib.setTwilioLine(configState, twilioLineState, input);
  };

  public shared ({ caller }) func removeTwilioLine(
    phoneNumber : Text,
  ) : async ConfigTypes.TwilioLineMutationResult {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: admin only");
    };
    ConfigLib.removeTwilioLine(configState, twilioLineState, phoneNumber);
  };

  public shared ({ caller }) func setTwilioLineEnabled(
    phoneNumber : Text,
    enabled : Bool,
  ) : async ConfigTypes.TwilioLineMutationResult {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: admin only");
    };
    ConfigLib.setTwilioLineEnabled(configState, twilioLineState, phoneNumber, enabled);
  };

  public query ({ caller }) func getTwilioLineNumbersForServer() : async [Text] {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    ConfigLib.listEnabledTwilioNumbers(configState, twilioLineState);
  };

  // Preset CRUD
  public shared ({ caller }) func createPreset(
    input : ConfigTypes.CallPresetInput,
  ) : async ConfigTypes.CallPreset {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ConfigLib.createPreset(configState, callPresetVoiceIds, caller, input);
  };

  public query ({ caller }) func getPreset(
    id : Common.PresetId,
  ) : async ?ConfigTypes.CallPreset {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    switch (ConfigLib.getPreset(configState, callPresetVoiceIds, id)) {
      case null { null };
      case (?preset) {
        if (Principal.equal(preset.ownerId, caller) or AccessControl.isAdmin(accessControlState, caller)) {
          ?preset;
        } else {
          null;
        };
      };
    };
  };

  public query ({ caller }) func getPresetForServer(
    id : Common.PresetId,
  ) : async ?ConfigTypes.CallPreset {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    ConfigLib.getPreset(configState, callPresetVoiceIds, id);
  };

  public query ({ caller }) func listMyPresets() : async [ConfigTypes.CallPreset] {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ConfigLib.listPresetsForUser(configState, callPresetVoiceIds, caller);
  };

  public shared ({ caller }) func updatePreset(
    id : Common.PresetId,
    input : ConfigTypes.CallPresetInput,
  ) : async ?ConfigTypes.CallPreset {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ConfigLib.updatePreset(configState, callPresetVoiceIds, caller, id, input);
  };

  public shared ({ caller }) func updatePresetInstructions(
    id : Common.PresetId,
    systemPrompt : Text,
  ) : async ConfigTypes.CallPresetMutationResult {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ConfigLib.updatePresetInstructions(configState, callPresetVoiceIds, caller, id, systemPrompt);
  };

  public shared ({ caller }) func deletePreset(
    id : Common.PresetId,
  ) : async Bool {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ConfigLib.deletePreset(configState, callPresetVoiceIds, caller, id);
  };

  public shared ({ caller }) func duplicatePreset(
    id : Common.PresetId,
  ) : async ?ConfigTypes.CallPreset {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    switch (ConfigLib.getPreset(configState, callPresetVoiceIds, id)) {
      case null { null };
      case (?preset) {
        if (Principal.equal(preset.ownerId, caller) or AccessControl.isAdmin(accessControlState, caller)) {
          ConfigLib.duplicatePreset(configState, callPresetVoiceIds, caller, id);
        } else {
          null;
        };
      };
    };
  };

  public shared ({ caller }) func createAnsweringPreset(
    input : ConfigTypes.AnsweringPresetInput,
  ) : async ConfigTypes.AnsweringPresetMutationResult {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ConfigLib.createAnsweringPreset(answeringState, answeringPresetVoiceIds, caller, input);
  };

  public query ({ caller }) func listMyAnsweringPresets() : async [ConfigTypes.AnsweringPreset] {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ConfigLib.listAnsweringPresetsForUser(answeringState, answeringPresetVoiceIds, caller);
  };

  public query ({ caller }) func getAnsweringPreset(
    id : Common.PresetId,
  ) : async ?ConfigTypes.AnsweringPreset {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    switch (ConfigLib.getAnsweringPreset(answeringState, answeringPresetVoiceIds, id)) {
      case null { null };
      case (?preset) {
        if (not Principal.equal(preset.ownerId, caller) and not AccessControl.isAdmin(accessControlState, caller)) {
          Runtime.trap("Unauthorized: can only view your own answering presets");
        };
        ?preset;
      };
    };
  };

  public shared ({ caller }) func updateAnsweringPreset(
    id : Common.PresetId,
    input : ConfigTypes.AnsweringPresetInput,
  ) : async ConfigTypes.AnsweringPresetMutationResult {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ConfigLib.updateAnsweringPreset(answeringState, answeringPresetVoiceIds, caller, id, input);
  };

  public shared ({ caller }) func updateAnsweringPresetInstructions(
    id : Common.PresetId,
    systemPrompt : Text,
  ) : async ConfigTypes.AnsweringPresetMutationResult {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ConfigLib.updateAnsweringPresetInstructions(answeringState, answeringPresetVoiceIds, caller, id, systemPrompt);
  };

  public shared ({ caller }) func deleteAnsweringPreset(
    id : Common.PresetId,
  ) : async Bool {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ConfigLib.deleteAnsweringPreset(answeringState, answeringPresetVoiceIds, caller, id);
  };

  public shared ({ caller }) func setAnsweringPresetEnabled(
    id : Common.PresetId,
    enabled : Bool,
  ) : async ConfigTypes.AnsweringPresetMutationResult {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ConfigLib.setAnsweringPresetEnabled(answeringState, answeringPresetVoiceIds, caller, id, enabled);
  };

  public query ({ caller }) func getAnsweringPresetForServer(
    webhookSecret : Text,
    phoneNumber : Text,
  ) : async ?ConfigTypes.AnsweringPreset {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    ConfigLib.getAnsweringPresetForServer(answeringState, answeringPresetVoiceIds, webhookSecret, phoneNumber);
  };

  public shared ({ caller }) func verifyAnsweringPresetForServer(
    webhookSecret : Text,
    phoneNumber : Text,
  ) : async ConfigTypes.AnsweringPresetMutationResult {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    ConfigLib.verifyAnsweringPresetForServer(answeringState, answeringPresetVoiceIds, webhookSecret, phoneNumber);
  };
};
