import AccessControl "mo:caffeineai-authorization/access-control";
import MixinAuthorization "mo:caffeineai-authorization/MixinAuthorization";
import ConfigLib "lib/config";
import CallsLib "lib/calls";
import ConfigApi "mixins/config-api";
import CallsApi "mixins/calls-api";

actor {
  // Authorization state (first authenticated user becomes admin)
  let accessControlState = AccessControl.initState();
  include MixinAuthorization(accessControlState);

  // Domain state
  let configState = ConfigLib.initState();
  let callsState = CallsLib.initState();

  // Domain mixins
  include ConfigApi(accessControlState, configState);
  include CallsApi(accessControlState, callsState, configState);
};
