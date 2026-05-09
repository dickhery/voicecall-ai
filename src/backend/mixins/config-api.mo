import Runtime "mo:core/Runtime";
import AccessControl "mo:caffeineai-authorization/access-control";
import ConfigLib "../lib/config";
import ConfigTypes "../types/config";
import Common "../types/common";

mixin (
  accessControlState : AccessControl.AccessControlState,
  configState : ConfigLib.State,
) {
  // Admin: view current service config (masked secrets)
  public query ({ caller }) func getAdminConfig() : async {
    twilioAccountSid : Text;
    twilioFromNumber : Text;
    hasXaiKey : Bool;
    hasTwilioAuth : Bool;
  } {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: admin only");
    };
    ConfigLib.getAdminConfig(configState);
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
    ConfigLib.setAdminConfig(configState, xaiApiKey, twilioAccountSid, twilioAuthToken, twilioFromNumber);
  };

  // Preset CRUD
  public shared ({ caller }) func createPreset(
    input : ConfigTypes.CallPresetInput,
  ) : async ConfigTypes.CallPreset {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ConfigLib.createPreset(configState, caller, input);
  };

  public query ({ caller }) func getPreset(
    id : Common.PresetId,
  ) : async ?ConfigTypes.CallPreset {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ConfigLib.getPreset(configState, id);
  };

  public query ({ caller }) func listMyPresets() : async [ConfigTypes.CallPreset] {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ConfigLib.listPresetsForUser(configState, caller);
  };

  public shared ({ caller }) func updatePreset(
    id : Common.PresetId,
    input : ConfigTypes.CallPresetInput,
  ) : async ?ConfigTypes.CallPreset {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ConfigLib.updatePreset(configState, caller, id, input);
  };

  public shared ({ caller }) func deletePreset(
    id : Common.PresetId,
  ) : async Bool {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ConfigLib.deletePreset(configState, caller, id);
  };

  public shared ({ caller }) func duplicatePreset(
    id : Common.PresetId,
  ) : async ?ConfigTypes.CallPreset {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    ConfigLib.duplicatePreset(configState, caller, id);
  };
};
