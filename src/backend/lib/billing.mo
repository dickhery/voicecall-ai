import Map "mo:core/Map";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Int "mo:core/Int";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types/billing";

module {
  private let RESERVATION_TTL_NS : Int = 900_000_000_000;
  private let RESERVATION_CHUNK_SECONDS : Nat = 900;
  private let MAX_RESERVATION_SECONDS : Nat = 14_400;
  private let BILLING_INCREMENT_SECONDS : Nat = 60;

  public type State = {
    balances : Map.Map<Principal, Nat>;
    reservedSecondsByUser : Map.Map<Principal, Nat>;
    purchaseIntents : Map.Map<Text, Types.PurchaseIntent>;
    processedStripeSessions : Map.Map<Text, Bool>;
    callReservations : Map.Map<Text, Types.CallReservation>;
    nextPurchaseIntentId : { var value : Nat };
    nextReservationId : { var value : Nat };
  };

  public func initState() : State {
    {
      balances = Map.empty<Principal, Nat>();
      reservedSecondsByUser = Map.empty<Principal, Nat>();
      purchaseIntents = Map.empty<Text, Types.PurchaseIntent>();
      processedStripeSessions = Map.empty<Text, Bool>();
      callReservations = Map.empty<Text, Types.CallReservation>();
      nextPurchaseIntentId = { var value = 1 };
      nextReservationId = { var value = 1 };
    };
  };

  public func packages() : [Types.BillingPackage] {
    [
      {
        id = "pack_5";
        name = "$5 - 45 minutes";
        amountCents = 500;
        seconds = 45 * 60;
      },
      {
        id = "pack_10";
        name = "$10 - 90 minutes";
        amountCents = 1_000;
        seconds = 90 * 60;
      },
      {
        id = "pack_20";
        name = "$20 - 180 minutes";
        amountCents = 2_000;
        seconds = 180 * 60;
      },
    ];
  };

  public func getPackage(packageId : Text) : ?Types.BillingPackage {
    for (pkg in packages().values()) {
      if (pkg.id == packageId) {
        return ?pkg;
      };
    };
    null;
  };

  public func getBalance(state : State, user : Principal) : Nat {
    switch (state.balances.get(user)) {
      case null { 0 };
      case (?value) { value };
    };
  };

  public func getReservedSeconds(state : State, user : Principal) : Nat {
    switch (state.reservedSecondsByUser.get(user)) {
      case null { 0 };
      case (?value) { value };
    };
  };

  public func getAvailableSeconds(state : State, user : Principal) : Nat {
    let balance = getBalance(state, user);
    let reserved = getReservedSeconds(state, user);
    if (balance > reserved) { balance - reserved } else { 0 };
  };

  public func getBillingStatus(state : State, user : Principal) : Types.BillingStatus {
    let balance = getBalance(state, user);
    let reserved = getReservedSeconds(state, user);
    {
      balanceSeconds = balance;
      reservedSeconds = reserved;
      availableSeconds = if (balance > reserved) { balance - reserved } else { 0 };
      packages = packages();
    };
  };

  public func toPurchaseIntentPublic(intent : Types.PurchaseIntent) : Types.PurchaseIntentPublic {
    {
      id = intent.id;
      user = intent.user;
      packageId = intent.packageId;
      amountCents = intent.amountCents;
      seconds = intent.seconds;
      mode = intent.mode;
      createdAt = intent.createdAt;
      status = intent.status;
      stripeSessionId = intent.stripeSessionId;
      paidAt = intent.paidAt;
    };
  };

  public func toReservationPublic(
    reservation : Types.CallReservation,
    includeToken : Bool,
  ) : Types.CallReservationPublic {
    {
      id = reservation.id;
      callId = reservation.callId;
      user = reservation.user;
      recipientPhone = reservation.recipientPhone;
      presetId = reservation.presetId;
      allowedSeconds = reservation.allowedSeconds;
      callToken = if (includeToken) { ?reservation.callToken } else { null };
      createdAt = reservation.createdAt;
      expiresAt = reservation.expiresAt;
      status = reservation.status;
      startedAt = reservation.startedAt;
      finishedAt = reservation.finishedAt;
      usedSeconds = reservation.usedSeconds;
      billedSeconds = reservation.billedSeconds;
      callSid = reservation.callSid;
      transcript = reservation.transcript;
      canceledReason = reservation.canceledReason;
    };
  };

  public func createPurchaseIntent(
    state : State,
    user : Principal,
    packageId : Text,
    mode : Types.StripeMode,
  ) : Types.CreatePurchaseIntentResult {
    switch (getPackage(packageId)) {
      case null { #err("Unknown phone time package") };
      case (?pkg) {
        let id = "pi_" # state.nextPurchaseIntentId.value.toText();
        state.nextPurchaseIntentId.value += 1;
        let intent : Types.PurchaseIntent = {
          id;
          user;
          packageId = pkg.id;
          amountCents = pkg.amountCents;
          seconds = pkg.seconds;
          mode;
          createdAt = Time.now();
          var status = #pending;
          var stripeSessionId = null;
          var paidAt = null;
        };
        state.purchaseIntents.add(id, intent);
        #ok(toPurchaseIntentPublic(intent));
      };
    };
  };

  public func getPurchaseIntent(
    state : State,
    id : Text,
  ) : ?Types.PurchaseIntentPublic {
    switch (state.purchaseIntents.get(id)) {
      case null { null };
      case (?intent) { ?toPurchaseIntentPublic(intent) };
    };
  };

  public func getReservation(
    state : State,
    id : Text,
  ) : ?Types.CallReservation {
    state.callReservations.get(id);
  };

  public func getReservationByCallSid(
    state : State,
    callSid : Text,
  ) : ?Types.CallReservation {
    for (reservation in state.callReservations.values()) {
      switch (reservation.callSid) {
        case (?existingCallSid) {
          if (existingCallSid == callSid) {
            return ?reservation;
          };
        };
        case null {};
      };
    };
    null;
  };

  public func listOpenReservations(
    state : State,
    limit : Nat,
  ) : [Types.CallReservationPublic] {
    let results = List.empty<Types.CallReservationPublic>();
    for (reservation in state.callReservations.values()) {
      if (results.size() >= limit) {
        return results.toArray();
      };
      switch (reservation.status) {
        case (#reserved) {
          results.add(toReservationPublic(reservation, false));
        };
        case (#active) {
          results.add(toReservationPublic(reservation, false));
        };
        case (#finished) {};
        case (#canceled) {};
      };
    };
    results.toArray();
  };

  public func creditPaidSeconds(
    state : State,
    stripeSessionId : Text,
    purchaseIntentId : Text,
    user : Principal,
    seconds : Nat,
    mode : Types.StripeMode,
  ) : Types.BillingMutationResult {
    if (stripeSessionId == "") {
      return #err("Missing Stripe session ID");
    };
    switch (state.processedStripeSessions.get(stripeSessionId)) {
      case (?_) { return #ok(true) };
      case null {};
    };
    switch (state.purchaseIntents.get(purchaseIntentId)) {
      case null { #err("Purchase intent not found") };
      case (?intent) {
        if (not Principal.equal(intent.user, user)) {
          return #err("Purchase intent user mismatch");
        };
        if (intent.seconds != seconds) {
          return #err("Purchase intent seconds mismatch");
        };
        if (intent.mode != mode) {
          return #err("Purchase intent Stripe mode mismatch");
        };
        switch (intent.status) {
          case (#paid) {
            switch (intent.stripeSessionId) {
              case (?existing) {
                if (existing == stripeSessionId) {
                  state.processedStripeSessions.add(stripeSessionId, true);
                  return #ok(true);
                };
              };
              case null {};
            };
            #err("Purchase intent already paid");
          };
          case (#canceled) { #err("Purchase intent is canceled") };
          case (#pending) {
            let current = getBalance(state, user);
            state.balances.add(user, current + seconds);
            intent.status := #paid;
            intent.stripeSessionId := ?stripeSessionId;
            intent.paidAt := ?Time.now();
            state.processedStripeSessions.add(stripeSessionId, true);
            #ok(true);
          };
        };
      };
    };
  };

  public func creditPromoMinutes(
    state : State,
    user : Principal,
    minutes : Nat,
  ) : Types.BillingMutationResult {
    if (user.isAnonymous()) {
      return #err("Cannot credit the anonymous user");
    };
    if (minutes == 0) {
      return #err("Promo minutes must be greater than zero");
    };

    let seconds = minutes * 60;
    let current = getBalance(state, user);
    state.balances.add(user, current + seconds);
    #ok(true);
  };

  public func createReservation(
    state : State,
    user : Principal,
    recipientPhone : Text,
    presetId : Nat,
    callId : Nat,
    callToken : Text,
  ) : Types.ReserveCallResult {
    let available = getAvailableSeconds(state, user);
    if (available == 0) {
      return #err("You need prepaid phone time before starting a call.");
    };
    let allowedSeconds = Nat.min(available, RESERVATION_CHUNK_SECONDS);
    let idNumber = state.nextReservationId.value;
    state.nextReservationId.value += 1;
    let now = Time.now();
    let id = "res_" # idNumber.toText();
    let reservation : Types.CallReservation = {
      id;
      callId;
      user;
      recipientPhone;
      presetId;
      allowedSeconds;
      callToken;
      createdAt = now;
      expiresAt = now + RESERVATION_TTL_NS;
      var status = #reserved;
      var startedAt = null;
      var finishedAt = null;
      var usedSeconds = null;
      var billedSeconds = null;
      var callSid = null;
      var transcript = null;
      var canceledReason = null;
    };
    let currentlyReserved = getReservedSeconds(state, user);
    state.reservedSecondsByUser.add(user, currentlyReserved + allowedSeconds);
    state.callReservations.add(id, reservation);
    #ok(toReservationPublic(reservation, true));
  };

  public func extendReservation(
    state : State,
    reservationId : Text,
  ) : Types.ReserveCallResult {
    switch (state.callReservations.get(reservationId)) {
      case null { #err("Reservation not found") };
      case (?reservation) {
        switch (reservation.status) {
          case (#active) {};
          case (#reserved) {};
          case (#finished) { return #err("Reservation is already finished") };
          case (#canceled) { return #err("Reservation was canceled") };
        };

        if (reservation.allowedSeconds >= MAX_RESERVATION_SECONDS) {
          return #err("Maximum call reservation has already been reached");
        };

        let available = getAvailableSeconds(state, reservation.user);
        if (available == 0) {
          return #err("No prepaid phone time is available to extend this call.");
        };

        let remainingReservationCapacity = MAX_RESERVATION_SECONDS - reservation.allowedSeconds;
        let additionalSeconds = Nat.min(
          available,
          Nat.min(RESERVATION_CHUNK_SECONDS, remainingReservationCapacity),
        );
        if (additionalSeconds == 0) {
          return #err("No prepaid phone time is available to extend this call.");
        };

        let updatedAllowedSeconds = reservation.allowedSeconds + additionalSeconds;
        let updatedReservation : Types.CallReservation = {
          id = reservation.id;
          callId = reservation.callId;
          user = reservation.user;
          recipientPhone = reservation.recipientPhone;
          presetId = reservation.presetId;
          allowedSeconds = updatedAllowedSeconds;
          callToken = reservation.callToken;
          createdAt = reservation.createdAt;
          expiresAt = reservation.expiresAt;
          var status = reservation.status;
          var startedAt = reservation.startedAt;
          var finishedAt = reservation.finishedAt;
          var usedSeconds = reservation.usedSeconds;
          var billedSeconds = reservation.billedSeconds;
          var callSid = reservation.callSid;
          var transcript = reservation.transcript;
          var canceledReason = reservation.canceledReason;
        };
        state.callReservations.add(reservation.id, updatedReservation);
        let currentlyReserved = getReservedSeconds(state, reservation.user);
        state.reservedSecondsByUser.add(reservation.user, currentlyReserved + additionalSeconds);
        #ok(toReservationPublic(updatedReservation, false));
      };
    };
  };

  public func verifyCallReservation(
    state : State,
    reservationId : Text,
    callToken : Text,
  ) : Types.ReserveCallResult {
    switch (state.callReservations.get(reservationId)) {
      case null { #err("Reservation not found") };
      case (?reservation) {
        if (reservation.callToken != callToken) {
          return #err("Invalid reservation token");
        };
        switch (reservation.status) {
          case (#reserved) {};
          case (#active) { return #err("Reservation is already active") };
          case (#finished) { return #err("Reservation is already finished") };
          case (#canceled) { return #err("Reservation was canceled") };
        };
        let now = Time.now();
        if (now > reservation.expiresAt) {
          ignore cancelReservationInternal(state, reservation, "Reservation expired");
          return #err("Reservation expired");
        };
        reservation.status := #active;
        reservation.startedAt := ?now;
        #ok(toReservationPublic(reservation, false));
      };
    };
  };

  public func markReservationStarted(
    state : State,
    reservationId : Text,
    callSid : Text,
  ) : Types.BillingMutationResult {
    switch (state.callReservations.get(reservationId)) {
      case null { #err("Reservation not found") };
      case (?reservation) {
        let now = Time.now();
        switch (reservation.status) {
          case (#reserved) {
            if (now > reservation.expiresAt) {
              ignore cancelReservationInternal(state, reservation, "Reservation expired");
              return #err("Reservation expired");
            };
            reservation.status := #active;
            reservation.startedAt := ?now;
            reservation.callSid := ?callSid;
            #ok(true);
          };
          case (#active) {
            switch (reservation.startedAt) {
              case null { reservation.startedAt := ?now };
              case (?_) {};
            };
            reservation.callSid := ?callSid;
            #ok(true);
          };
          case (#finished) { #err("Reservation is already finished") };
          case (#canceled) { #err("Reservation was canceled") };
        };
      };
    };
  };

  public func cancelReservation(
    state : State,
    reservationId : Text,
    reason : Text,
  ) : Types.BillingMutationResult {
    switch (state.callReservations.get(reservationId)) {
      case null { #err("Reservation not found") };
      case (?reservation) {
        cancelReservationInternal(state, reservation, reason);
      };
    };
  };

  public func cancelReservationByCallSid(
    state : State,
    callSid : Text,
    reason : Text,
  ) : Types.BillingMutationResult {
    switch (getReservationByCallSid(state, callSid)) {
      case null { #err("Reservation not found for CallSid") };
      case (?reservation) {
        cancelReservationInternal(state, reservation, reason);
      };
    };
  };

  public func finishCallAndDebit(
    state : State,
    reservationId : Text,
    usedSeconds : Nat,
    callSid : ?Text,
    transcript : ?Text,
  ) : Types.BillingMutationResult {
    switch (state.callReservations.get(reservationId)) {
      case null { #err("Reservation not found") };
      case (?reservation) {
        switch (reservation.status) {
          case (#finished) { return #ok(true) };
          case (#canceled) { return #ok(true) };
          case (#reserved) {};
          case (#active) {};
        };

        let roundedSeconds = roundBillableSeconds(usedSeconds);
        let billedSeconds = Nat.min(roundedSeconds, reservation.allowedSeconds);
        releaseReservedSeconds(state, reservation.user, reservation.allowedSeconds);
        let currentBalance = getBalance(state, reservation.user);
        let newBalance = if (currentBalance > billedSeconds) {
          currentBalance - billedSeconds;
        } else {
          0;
        };
        state.balances.add(reservation.user, newBalance);

        reservation.status := #finished;
        reservation.finishedAt := ?Time.now();
        reservation.usedSeconds := ?usedSeconds;
        reservation.billedSeconds := ?billedSeconds;
        switch (callSid) {
          case (?sid) { reservation.callSid := ?sid };
          case null {};
        };
        switch (transcript) {
          case (?text) { reservation.transcript := ?text };
          case null {};
        };
        #ok(true);
      };
    };
  };

  public func finishCallByCallSidAndDebit(
    state : State,
    callSid : Text,
    usedSeconds : Nat,
    transcript : ?Text,
  ) : Types.BillingMutationResult {
    switch (getReservationByCallSid(state, callSid)) {
      case null { #err("Reservation not found for CallSid") };
      case (?reservation) {
        finishCallAndDebit(state, reservation.id, usedSeconds, ?callSid, transcript);
      };
    };
  };

  private func cancelReservationInternal(
    state : State,
    reservation : Types.CallReservation,
    reason : Text,
  ) : Types.BillingMutationResult {
    switch (reservation.status) {
      case (#finished) { return #ok(true) };
      case (#canceled) { return #ok(true) };
      case (#reserved) {};
      case (#active) {};
    };
    releaseReservedSeconds(state, reservation.user, reservation.allowedSeconds);
    reservation.status := #canceled;
    reservation.finishedAt := ?Time.now();
    reservation.canceledReason := ?reason;
    #ok(true);
  };

  private func releaseReservedSeconds(
    state : State,
    user : Principal,
    seconds : Nat,
  ) {
    let current = getReservedSeconds(state, user);
    let updated = if (current > seconds) { current - seconds } else { 0 };
    state.reservedSecondsByUser.add(user, updated);
  };

  private func roundBillableSeconds(seconds : Nat) : Nat {
    if (seconds == 0) {
      0;
    } else {
      ((seconds + BILLING_INCREMENT_SECONDS - 1) / BILLING_INCREMENT_SECONDS) * BILLING_INCREMENT_SECONDS;
    };
  };
};
