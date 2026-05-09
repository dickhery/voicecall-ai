import Runtime "mo:core/Runtime";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import AccessControl "mo:caffeineai-authorization/access-control";
import BillingLib "../lib/billing";
import CallsLib "../lib/calls";
import ConfigLib "../lib/config";
import BillingTypes "../types/billing";
import CallTypes "../types/calls";

mixin (
  accessControlState : AccessControl.AccessControlState,
  billingState : BillingLib.State,
  callsState : CallsLib.State,
  configState : ConfigLib.State,
) {
  public query ({ caller }) func getMyBillingStatus() : async BillingTypes.BillingStatus {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    BillingLib.getBillingStatus(billingState, caller);
  };

  public query func getBillingPackages() : async [BillingTypes.BillingPackage] {
    BillingLib.packages();
  };

  public shared ({ caller }) func createPurchaseIntent(
    packageId : Text,
  ) : async BillingTypes.CreatePurchaseIntentResult {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    let mode : BillingTypes.StripeMode = if (AccessControl.isAdmin(accessControlState, caller)) {
      #test;
    } else {
      #live;
    };
    BillingLib.createPurchaseIntent(billingState, caller, packageId, mode);
  };

  public query ({ caller }) func getPurchaseIntentForServer(
    purchaseIntentId : Text,
  ) : async ?BillingTypes.PurchaseIntentPublic {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    BillingLib.getPurchaseIntent(billingState, purchaseIntentId);
  };

  public shared ({ caller }) func creditPaidSeconds(
    stripeSessionId : Text,
    purchaseIntentId : Text,
    user : Principal,
    seconds : Nat,
    mode : BillingTypes.StripeMode,
  ) : async BillingTypes.BillingMutationResult {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    let result = BillingLib.creditPaidSeconds(
      billingState,
      stripeSessionId,
      purchaseIntentId,
      user,
      seconds,
      mode,
    );
    switch (result) {
      case (#ok(_)) {
        CallsLib.addSystemLog(
          callsState,
          #info,
          "Credited " # debug_show(seconds) # " paid seconds for " # Principal.toText(user),
          null,
        );
      };
      case (#err(message)) {
        CallsLib.addSystemLog(callsState, #warn, "Stripe credit rejected: " # message, null);
      };
    };
    result;
  };

  public shared ({ caller }) func reserveCall(
    input : CallTypes.InitiateCallInput,
  ) : async BillingTypes.ReserveCallResult {
    if (not AccessControl.hasPermission(accessControlState, caller, #user)) {
      Runtime.trap("Unauthorized: must be logged in");
    };
    switch (ConfigLib.getPreset(configState, input.presetId)) {
      case null { return #err("Preset not found") };
      case (?preset) {
        if (not Principal.equal(preset.ownerId, caller) and not AccessControl.isAdmin(accessControlState, caller)) {
          return #err("Preset not found");
        };
      };
    };

    let available = BillingLib.getAvailableSeconds(billingState, caller);
    if (available == 0) {
      return #err("You need prepaid phone time before starting a call.");
    };

    let callRecord = CallsLib.createCallRecord(
      callsState,
      caller,
      input.recipientPhone,
      input.presetId,
    );
    let reservation = BillingLib.createReservation(
      billingState,
      caller,
      input.recipientPhone,
      input.presetId,
      callRecord.id,
    );
    switch (reservation) {
      case (#ok(reserved)) {
        CallsLib.addSystemLog(
          callsState,
          #info,
          "Reserved " # debug_show(reserved.allowedSeconds) # " paid seconds for call " # debug_show(callRecord.id),
          ?callRecord.id,
        );
      };
      case (#err(message)) {
        ignore CallsLib.updateCallRecord(
          callsState,
          callRecord.id,
          #failed,
          null,
          ?Time.now(),
          ?message,
        );
      };
    };
    reservation;
  };

  public shared ({ caller }) func verifyCallReservation(
    reservationId : Text,
    callToken : Text,
  ) : async BillingTypes.ReserveCallResult {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    BillingLib.verifyCallReservation(billingState, reservationId, callToken);
  };

  public shared ({ caller }) func markReservationStarted(
    reservationId : Text,
    callSid : Text,
  ) : async BillingTypes.BillingMutationResult {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    let result = BillingLib.markReservationStarted(billingState, reservationId, callSid);
    switch (result) {
      case (#ok(_)) {
        switch (BillingLib.getReservation(billingState, reservationId)) {
          case null {};
          case (?reservation) {
            ignore CallsLib.updateCallRecord(
              callsState,
              reservation.callId,
              #inProgress,
              ?callSid,
              null,
              null,
            );
          };
        };
      };
      case _ {};
    };
    result;
  };

  public shared ({ caller }) func cancelCallReservation(
    reservationId : Text,
    reason : Text,
  ) : async BillingTypes.BillingMutationResult {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    let result = BillingLib.cancelReservation(billingState, reservationId, reason);
    switch (result) {
      case (#ok(_)) {
        switch (BillingLib.getReservation(billingState, reservationId)) {
          case null {};
          case (?reservation) {
            ignore CallsLib.updateCallRecord(
              callsState,
              reservation.callId,
              #failed,
              reservation.callSid,
              ?Time.now(),
              ?reason,
            );
          };
        };
      };
      case _ {};
    };
    result;
  };

  public shared ({ caller }) func finishCallAndDebit(
    reservationId : Text,
    usedSeconds : Nat,
    callSid : ?Text,
    transcript : ?Text,
  ) : async BillingTypes.BillingMutationResult {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    let result = BillingLib.finishCallAndDebit(
      billingState,
      reservationId,
      usedSeconds,
      callSid,
      transcript,
    );
    switch (result) {
      case (#ok(_)) {
        switch (BillingLib.getReservation(billingState, reservationId)) {
          case null {};
          case (?reservation) {
            ignore CallsLib.updateCallRecord(
              callsState,
              reservation.callId,
              #completed,
              callSid,
              ?Time.now(),
              transcript,
            );
          };
        };
        switch (callSid) {
          case (?sid) {
            CallsLib.addSystemLog(
              callsState,
              #info,
              "Finished paid call " # sid # " after " # debug_show(usedSeconds) # " seconds",
              null,
            );
          };
          case null {};
        };
      };
      case (#err(message)) {
        CallsLib.addSystemLog(callsState, #warn, "Call debit rejected: " # message, null);
      };
    };
    result;
  };
};
