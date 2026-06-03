import Runtime "mo:core/Runtime";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Random "mo:core/Random";
import Text "mo:core/Text";
import Blob "mo:core/Blob";
import Nat8 "mo:core/Nat8";
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
  callPresetVoiceIds : ConfigLib.VoiceIdState,
  answeringState : ConfigLib.AnsweringState,
  answeringPresetVoiceIds : ConfigLib.VoiceIdState,
) {
  let ANSWERING_PRESET_ID_OFFSET : Nat = 1_000_000_000;

  private func byteToHex(byte : Nat8) : Text {
    let alphabet = "0123456789abcdef".toArray();
    let value = byte.toNat();
    Text.fromChar(alphabet[value / 16]) # Text.fromChar(alphabet[value % 16]);
  };

  private func randomCallToken() : async Text {
    let entropy = await Random.blob();
    var token = "ct_";
    for (byte in entropy.toArray().values()) {
      token #= byteToHex(byte);
    };
    token;
  };

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
          "Credited " # debug_show(seconds) # " paid seconds for " # user.toText(),
          null,
        );
      };
      case (#err(message)) {
        CallsLib.addSystemLog(callsState, #warn, "Stripe credit rejected: " # message, null);
      };
    };
    result;
  };

  public shared ({ caller }) func adminAddPromoMinutes(
    user : Principal,
    minutes : Nat,
  ) : async BillingTypes.BillingMutationResult {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: admin only");
    };
    let result = BillingLib.creditPromoMinutes(billingState, user, minutes);
    switch (result) {
      case (#ok(_)) {
        CallsLib.addSystemLog(
          callsState,
          #info,
          "Added " # debug_show(minutes) # " promo minutes for " # user.toText(),
          null,
        );
      };
      case (#err(message)) {
        CallsLib.addSystemLog(callsState, #warn, "Promo credit rejected: " # message, null);
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
    let callToken = await randomCallToken();
    switch (ConfigLib.getPreset(configState, callPresetVoiceIds, input.presetId)) {
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
      callToken,
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

  public shared ({ caller }) func reserveIncomingAnsweringCall(
    webhookSecret : Text,
    callerPhone : Text,
    twilioToNumber : Text,
    callSid : Text,
  ) : async BillingTypes.ReserveCallResult {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    let callToken = await randomCallToken();
    switch (ConfigLib.getAnsweringPresetForIncoming(answeringState, answeringPresetVoiceIds, webhookSecret, twilioToNumber)) {
      case (#err(message)) { return #err(message) };
      case (#ok(preset)) {
        let available = BillingLib.getAvailableSeconds(billingState, preset.ownerId);
        if (available == 0) {
          return #err("No prepaid phone time is available for this answering preset.");
        };

        let callPresetId = preset.id + ANSWERING_PRESET_ID_OFFSET;
        let callRecord = CallsLib.createCallRecord(
          callsState,
          preset.ownerId,
          callerPhone,
          callPresetId,
        );
        let reservation = BillingLib.createReservation(
          billingState,
          preset.ownerId,
          callerPhone,
          callPresetId,
          callRecord.id,
          callToken,
        );
        switch (reservation) {
          case (#ok(reserved)) {
            switch (BillingLib.markReservationStarted(billingState, reserved.id, callSid)) {
              case (#ok(_)) {
                ignore CallsLib.updateCallRecord(
                  callsState,
                  callRecord.id,
                  #inProgress,
                  ?callSid,
                  null,
                  null,
                );
                ConfigLib.markAnsweringPresetIncoming(answeringState, preset.id);
                CallsLib.addSystemLog(
                  callsState,
                  #info,
                  "Started " # debug_show(reserved.allowedSeconds) # " paid seconds for incoming answering call " # callSid,
                  ?callRecord.id,
                );
                switch (BillingLib.getReservation(billingState, reserved.id)) {
                  case (?startedReservation) {
                    return #ok(BillingLib.toReservationPublic(startedReservation, false));
                  };
                  case null {
                    return #err("Reservation not found after starting incoming call");
                  };
                };
              };
              case (#err(message)) {
                ignore BillingLib.cancelReservation(billingState, reserved.id, message);
                ignore CallsLib.updateCallRecord(
                  callsState,
                  callRecord.id,
                  #failed,
                  ?callSid,
                  ?Time.now(),
                  ?message,
                );
                CallsLib.addSystemLog(
                  callsState,
                  #warn,
                  "Incoming answering reservation could not be started: " # message,
                  ?callRecord.id,
                );
                return #err(message);
              };
            };
          };
          case (#err(message)) {
            ignore CallsLib.updateCallRecord(
              callsState,
              callRecord.id,
              #failed,
              ?callSid,
              ?Time.now(),
              ?message,
            );
          };
        };
        reservation;
      };
    };
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

  public shared ({ caller }) func extendCallReservationForServer(
    reservationId : Text,
  ) : async BillingTypes.ReserveCallResult {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    let result = BillingLib.extendReservation(billingState, reservationId);
    switch (result) {
      case (#ok(reservation)) {
        CallsLib.addSystemLog(
          callsState,
          #info,
          "Extended paid call reservation " # reservation.id # " to " # debug_show(reservation.allowedSeconds) # " seconds",
          ?reservation.callId,
        );
      };
      case (#err(message)) {
        CallsLib.addSystemLog(callsState, #warn, "Call reservation extension rejected: " # message, null);
      };
    };
    result;
  };

  public query ({ caller }) func listOpenCallReservationsForServer(
    limit : Nat,
  ) : async [BillingTypes.CallReservationPublic] {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    BillingLib.listOpenReservations(billingState, limit);
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
            switch (reservation.status) {
              case (#canceled) {
                ignore CallsLib.updateCallRecord(
                  callsState,
                  reservation.callId,
                  #failed,
                  reservation.callSid,
                  ?Time.now(),
                  ?reason,
                );
              };
              case (#finished) {};
              case (#reserved) {};
              case (#active) {};
            };
          };
        };
      };
      case _ {};
    };
    result;
  };

  public shared ({ caller }) func cancelCallReservationByCallSidForServer(
    callSid : Text,
    reason : Text,
  ) : async BillingTypes.BillingMutationResult {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    let result = BillingLib.cancelReservationByCallSid(billingState, callSid, reason);
    switch (result) {
      case (#ok(_)) {
        switch (BillingLib.getReservationByCallSid(billingState, callSid)) {
          case null {};
          case (?reservation) {
            switch (reservation.status) {
              case (#canceled) {
                ignore CallsLib.updateCallRecord(
                  callsState,
                  reservation.callId,
                  #failed,
                  ?callSid,
                  ?Time.now(),
                  ?reason,
                );
                CallsLib.addSystemLog(
                  callsState,
                  #info,
                  "Canceled paid call reservation for " # callSid # ": " # reason,
                  ?reservation.callId,
                );
              };
              case (#finished) {};
              case (#reserved) {};
              case (#active) {};
            };
          };
        };
      };
      case (#err(message)) {
        CallsLib.addSystemLog(
          callsState,
          #warn,
          "CallSid reservation cancel rejected: " # message,
          null,
        );
      };
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
            let finalCallSid = switch (callSid) {
              case (?sid) { ?sid };
              case null { reservation.callSid };
            };
            let finalTranscript = switch (transcript) {
              case (?text) { ?text };
              case null { reservation.transcript };
            };
            ignore CallsLib.updateCallRecord(
              callsState,
              reservation.callId,
              #completed,
              finalCallSid,
              ?Time.now(),
              finalTranscript,
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

  public shared ({ caller }) func finishCallByCallSidForServer(
    callSid : Text,
    usedSeconds : Nat,
    transcript : ?Text,
  ) : async BillingTypes.BillingMutationResult {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: server admin only");
    };
    let result = BillingLib.finishCallByCallSidAndDebit(
      billingState,
      callSid,
      usedSeconds,
      transcript,
    );
    switch (result) {
      case (#ok(_)) {
        switch (BillingLib.getReservationByCallSid(billingState, callSid)) {
          case null {};
          case (?reservation) {
            switch (reservation.status) {
              case (#finished) {
                let finalTranscript = switch (transcript) {
                  case (?text) { ?text };
                  case null { reservation.transcript };
                };
                ignore CallsLib.updateCallRecord(
                  callsState,
                  reservation.callId,
                  #completed,
                  ?callSid,
                  ?Time.now(),
                  finalTranscript,
                );
              };
              case (#canceled) {
                ignore CallsLib.updateCallRecord(
                  callsState,
                  reservation.callId,
                  #failed,
                  ?callSid,
                  reservation.finishedAt,
                  reservation.canceledReason,
                );
              };
              case (#reserved) {};
              case (#active) {};
            };
            CallsLib.addSystemLog(
              callsState,
              #info,
              "Finished paid call by CallSid " # callSid # " after " # debug_show(usedSeconds) # " seconds",
              ?reservation.callId,
            );
          };
        };
      };
      case (#err(message)) {
        CallsLib.addSystemLog(callsState, #warn, "CallSid debit rejected: " # message, null);
      };
    };
    result;
  };
};
