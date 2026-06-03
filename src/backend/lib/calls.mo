import Map "mo:core/Map";
import List "mo:core/List";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import Int "mo:core/Int";
import Array "mo:core/Array";
import Order "mo:core/Order";
import Text "mo:core/Text";
import Iter "mo:core/Iter";
import Types "../types/calls";
import Common "../types/common";

module {
  public type State = {
    callRecords : Map.Map<Common.CallId, Types.CallRecord>;
    userCallIndex : Map.Map<Principal, List.List<Common.CallId>>;
    nextCallId : { var value : Nat };
    systemLogs : List.List<Types.SystemLog>;
  };

  public type AnsweringLiveState = {
    activeSessions : Map.Map<Text, Types.AnsweringLiveSession>;
  };

  public func initState() : State {
    {
      callRecords = Map.empty<Common.CallId, Types.CallRecord>();
      userCallIndex = Map.empty<Principal, List.List<Common.CallId>>();
      nextCallId = { var value = 1 };
      systemLogs = List.empty<Types.SystemLog>();
    };
  };

  public func initAnsweringLiveState() : AnsweringLiveState {
    {
      activeSessions = Map.empty<Text, Types.AnsweringLiveSession>();
    };
  };

  public func toPublic(record : Types.CallRecord) : Types.CallRecordPublic {
    {
      id = record.id;
      userId = record.userId;
      recipientPhone = record.recipientPhone;
      presetId = record.presetId;
      startTime = record.startTime;
      endTime = record.endTime;
      status = record.status;
      callSid = record.callSid;
      transcript = record.transcript;
    };
  };

  public func createCallRecord(
    state : State,
    userId : Principal,
    recipientPhone : Text,
    presetId : Nat,
  ) : Types.CallRecord {
    let id = state.nextCallId.value;
    state.nextCallId.value += 1;
    let record : Types.CallRecord = {
      id;
      userId;
      recipientPhone;
      presetId;
      startTime = Time.now();
      var endTime = null;
      var status = #pending;
      var callSid = null;
      var transcript = null;
    };
    state.callRecords.add(id, record);
    switch (state.userCallIndex.get(userId)) {
      case null {
        let userList = List.empty<Common.CallId>();
        userList.add(id);
        state.userCallIndex.add(userId, userList);
      };
      case (?userList) { userList.add(id) };
    };
    record;
  };

  public func getCallRecord(
    state : State,
    id : Common.CallId,
  ) : ?Types.CallRecord {
    state.callRecords.get(id);
  };

  public func updateCallRecord(
    state : State,
    id : Common.CallId,
    status : Types.CallStatus,
    callSid : ?Text,
    endTime : ?Int,
    transcript : ?Text,
  ) : Bool {
    switch (state.callRecords.get(id)) {
      case null { false };
      case (?record) {
        record.status := status;
        switch (callSid) {
          case (?value) { record.callSid := ?value };
          case null {};
        };
        switch (endTime) {
          case (?value) { record.endTime := ?value };
          case null {};
        };
        switch (transcript) {
          case (?value) { record.transcript := ?value };
          case null {};
        };
        true;
      };
    };
  };

  private func compareCallsNewestFirst(a : Types.CallRecordPublic, b : Types.CallRecordPublic) : Order.Order {
    switch (Int.compare(b.startTime, a.startTime)) {
      case (#equal) { Nat.compare(b.id, a.id) };
      case (order) { order };
    };
  };

  public func listCallsForUser(
    state : State,
    userId : Principal,
  ) : [Types.CallRecordPublic] {
    switch (state.userCallIndex.get(userId)) {
      case null { [] };
      case (?ids) {
        let buf = List.empty<Types.CallRecordPublic>();
        ids.forEach(func(cid) {
          switch (state.callRecords.get(cid)) {
            case null {};
            case (?r) { buf.add(toPublic(r)) };
          };
        });
        buf.toArray().sort(compareCallsNewestFirst);
      };
    };
  };

  public func listAllCalls(state : State) : [Types.CallRecordPublic] {
    let buf = List.empty<Types.CallRecordPublic>();
    state.callRecords.forEach(func(_k, r) { buf.add(toPublic(r)) });
    buf.toArray().sort(compareCallsNewestFirst);
  };

  public func addSystemLog(
    state : State,
    level : { #info; #warn; #error_ },
    message : Text,
    callId : ?Nat,
  ) {
    let entry : Types.SystemLog = {
      timestamp = Time.now();
      level;
      message;
      callId;
    };
    state.systemLogs.add(entry);
  };

  public func getSystemLogs(state : State, limit : Nat) : [Types.SystemLog] {
    let total = state.systemLogs.size();
    let start : Nat = if (total > limit) { total - limit } else { 0 };
    state.systemLogs.sliceToArray(start, total).reverse();
  };

  public func registerAnsweringLiveSession(
    state : AnsweringLiveState,
    session : Types.AnsweringLiveSession,
  ) {
    state.activeSessions.add(session.sessionId, session);
  };

  public func removeAnsweringLiveSession(
    state : AnsweringLiveState,
    sessionId : Text,
  ) : Bool {
    switch (state.activeSessions.get(sessionId)) {
      case null { false };
      case (?_) {
        state.activeSessions.remove(sessionId);
        true;
      };
    };
  };

  public func listAnsweringLiveSessionsForUser(
    state : AnsweringLiveState,
    userId : Principal,
  ) : [Types.AnsweringLiveSession] {
    state.activeSessions.values()
      .filter(func(session) { Principal.equal(session.userId, userId) })
      .toArray();
  };
};
