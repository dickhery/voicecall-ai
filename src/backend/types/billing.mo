module {
  public type StripeMode = {
    #test;
    #live;
  };

  public type PurchaseIntentStatus = {
    #pending;
    #paid;
    #canceled;
  };

  public type CallReservationStatus = {
    #reserved;
    #active;
    #finished;
    #canceled;
  };

  public type BillingPackage = {
    id : Text;
    name : Text;
    amountCents : Nat;
    seconds : Nat;
  };

  public type BillingStatus = {
    balanceSeconds : Nat;
    reservedSeconds : Nat;
    availableSeconds : Nat;
    packages : [BillingPackage];
  };

  public type PurchaseIntent = {
    id : Text;
    user : Principal;
    packageId : Text;
    amountCents : Nat;
    seconds : Nat;
    mode : StripeMode;
    createdAt : Int;
    var status : PurchaseIntentStatus;
    var stripeSessionId : ?Text;
    var paidAt : ?Int;
  };

  public type PurchaseIntentPublic = {
    id : Text;
    user : Principal;
    packageId : Text;
    amountCents : Nat;
    seconds : Nat;
    mode : StripeMode;
    createdAt : Int;
    status : PurchaseIntentStatus;
    stripeSessionId : ?Text;
    paidAt : ?Int;
  };

  public type CreatePurchaseIntentResult = {
    #ok : PurchaseIntentPublic;
    #err : Text;
  };

  public type CallReservation = {
    id : Text;
    callId : Nat;
    user : Principal;
    recipientPhone : Text;
    presetId : Nat;
    allowedSeconds : Nat;
    callToken : Text;
    createdAt : Int;
    expiresAt : Int;
    var status : CallReservationStatus;
    var startedAt : ?Int;
    var finishedAt : ?Int;
    var usedSeconds : ?Nat;
    var billedSeconds : ?Nat;
    var callSid : ?Text;
    var transcript : ?Text;
    var canceledReason : ?Text;
  };

  public type CallReservationPublic = {
    id : Text;
    callId : Nat;
    user : Principal;
    recipientPhone : Text;
    presetId : Nat;
    allowedSeconds : Nat;
    callToken : ?Text;
    createdAt : Int;
    expiresAt : Int;
    status : CallReservationStatus;
    startedAt : ?Int;
    finishedAt : ?Int;
    usedSeconds : ?Nat;
    billedSeconds : ?Nat;
    callSid : ?Text;
    transcript : ?Text;
    canceledReason : ?Text;
  };

  public type ReserveCallResult = {
    #ok : CallReservationPublic;
    #err : Text;
  };

  public type BillingMutationResult = {
    #ok : Bool;
    #err : Text;
  };
};
