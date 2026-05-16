import AccessControl "mo:caffeineai-authorization/access-control";
import MixinAuthorization "mo:caffeineai-authorization/MixinAuthorization";
import ConfigLib "lib/config";
import CallsLib "lib/calls";
import BillingLib "lib/billing";
import ConfigApi "mixins/config-api";
import CallsApi "mixins/calls-api";
import BillingApi "mixins/billing-api";

persistent actor {
  // Authorization state (first authenticated user becomes admin)
  let accessControlState = AccessControl.initState();
  include MixinAuthorization(accessControlState);

  // Domain state
  let configState = ConfigLib.initState();
  let callPresetVoiceIds = ConfigLib.initVoiceIdState();
  let twilioLineState = ConfigLib.initTwilioLineState();
  let answeringState = ConfigLib.initAnsweringState();
  let answeringPresetVoiceIds = ConfigLib.initVoiceIdState();
  let callsState = CallsLib.initState();
  let answeringLiveState = CallsLib.initAnsweringLiveState();
  let billingState = BillingLib.initState();

  // Domain mixins
  include ConfigApi(accessControlState, configState, callPresetVoiceIds, twilioLineState, answeringState, answeringPresetVoiceIds);
  include CallsApi(accessControlState, callsState, answeringLiveState, configState, callPresetVoiceIds);
  include BillingApi(accessControlState, billingState, callsState, configState, callPresetVoiceIds, answeringState, answeringPresetVoiceIds);
};
