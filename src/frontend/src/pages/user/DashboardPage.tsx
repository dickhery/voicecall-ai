import { AppLayout } from "@/components/AppLayout";
import { CallStatusBadge } from "@/components/CallStatusBadge";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { getVoiceLabel } from "@/components/VoiceIdSelector";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreatePurchaseIntent,
  useDeletePreset,
  useDuplicatePreset,
  useGetMyBillingStatus,
  useListMyCalls,
  useListMyPresets,
  useUpdatePresetInstructions,
} from "@/hooks/use-backend";
import type { XaiCallStatus } from "@/hooks/use-xai-voice";
import { useXaiVoice } from "@/hooks/use-xai-voice";
import {
  formatPhoneDisplay,
  isValidE164,
  loadRecentPhones,
  normalizeToE164,
  phoneInputHint,
} from "@/lib/phone";
import {
  createCheckoutSession,
  getVoiceServerHealth,
} from "@/lib/voice-server";
import type { CallPreset } from "@/types";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  Copy,
  CreditCard,
  FileText,
  Loader2,
  MessageSquareMore,
  Pencil,
  Phone,
  PhoneOff,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Trash2,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { motion } from "motion/react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
    .toString()
    .padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function formatMinutes(seconds: bigint | number | undefined): string {
  const value = Number(seconds ?? 0);
  return `${Math.floor(value / 60)} min`;
}

function formatCallDuration(start: bigint, end?: bigint): string {
  if (!end) return "—";
  const secs = Number((end - start) / 1_000_000_000n);
  return formatDuration(secs);
}

const STATUS_COLORS: Record<XaiCallStatus, string> = {
  idle: "text-muted-foreground",
  initiating: "text-yellow-400",
  queued: "text-yellow-400",
  connecting: "text-blue-400",
  in_call: "text-primary",
  completed: "text-green-400",
  error: "text-destructive",
};

const STATUS_LABELS: Record<XaiCallStatus, string> = {
  idle: "Idle",
  initiating: "Initiating...",
  queued: "Queued",
  connecting: "Connecting...",
  in_call: "Live",
  completed: "Completed",
  error: "Error",
};
const MAX_AI_INSTRUCTIONS_CHARS = 8000;
const MAX_STEERING_PROMPT_CHARS = 800;
const LOW_BALANCE_SECONDS = 5 * 60;

function StatCard({
  icon,
  label,
  value,
  color,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color?: string;
  loading?: boolean;
}) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {label}
            </p>
            {loading ? (
              <Skeleton className="h-7 w-16 mt-1" />
            ) : (
              <p
                className={`text-2xl font-bold mt-0.5 ${color ?? "text-foreground"}`}
              >
                {value}
              </p>
            )}
          </div>
          <div className="p-2.5 rounded-xl bg-muted/50">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function ActiveCallPanel({
  voice,
  onRequestEnd,
}: {
  voice: ReturnType<typeof useXaiVoice>;
  onRequestEnd: () => void;
}) {
  const {
    status,
    recipient,
    presetName,
    durationSecs,
    remainingSeconds,
    queuePosition,
    errorMessage,
    liveAudioAvailable,
    isListeningLive,
    liveAudioError,
    isSendingSteeringPrompt,
    steeringError,
    liveTranscript,
    isReattaching,
    steerConversation,
    toggleLiveAudio,
    dismissStatus,
  } = voice;
  const [steeringPrompt, setSteeringPrompt] = useState("");
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const isActive =
    status === "in_call" ||
    status === "connecting" ||
    status === "initiating" ||
    status === "queued";
  const canSendSteeringPrompt =
    status === "in_call" &&
    !isSendingSteeringPrompt &&
    steeringPrompt.trim().length > 0;
  const lowPaidTime =
    remainingSeconds != null &&
    remainingSeconds > 0 &&
    remainingSeconds <= 60;

  const handleSteeringSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = steeringPrompt.trim();
    if (!prompt) return;
    try {
      await steerConversation(prompt);
      setSteeringPrompt("");
    } catch {
      // Hook surfaces failure via toast and steeringError.
    }
  };

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [liveTranscript.length]);

  if (status === "idle") return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.3 }}
    >
      <Card
        className="border-primary/40 bg-card relative overflow-hidden"
        data-ocid="dashboard.active_call.card"
      >
        {isActive && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent animate-pulse" />
        )}
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div
                className={`relative flex items-center justify-center w-9 h-9 rounded-full ${
                  status === "in_call"
                    ? "bg-primary/20"
                    : status === "error"
                      ? "bg-destructive/20"
                      : status === "completed"
                        ? "bg-green-500/20"
                        : "bg-muted/50"
                }`}
              >
                {(status === "initiating" ||
                  status === "connecting" ||
                  status === "queued" ||
                  isReattaching) && (
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                )}
                {status === "in_call" && (
                  <>
                    <Phone className="w-4 h-4 text-primary" />
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
                  </>
                )}
                {status === "completed" && (
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                )}
                {status === "error" && (
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-sm font-semibold ${STATUS_COLORS[status]}`}
                  >
                    {isReattaching ? "Reconnecting..." : STATUS_LABELS[status]}
                  </span>
                  {status === "in_call" && (
                    <Badge
                      variant="outline"
                      className="text-xs h-4 px-1 border-primary/40 text-primary font-mono"
                    >
                      {formatDuration(durationSecs)}
                    </Badge>
                  )}
                  {status === "in_call" && remainingSeconds != null && (
                    <Badge
                      variant="outline"
                      className={`text-xs h-4 px-1 font-mono ${
                        lowPaidTime
                          ? "border-amber-500/50 text-amber-400"
                          : "border-border text-muted-foreground"
                      }`}
                      data-ocid="dashboard.active_call.remaining_time"
                    >
                      {formatDuration(remainingSeconds)} left
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground font-mono">
                  {recipient ? formatPhoneDisplay(recipient) : "—"}
                </p>
              </div>
            </div>

            <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
              <Zap className="w-3 h-3" />
              <span className="truncate max-w-[140px]">{presetName}</span>
            </div>

            {status === "queued" && (
              <Badge
                variant="outline"
                className="text-xs border-yellow-500/40 text-yellow-400"
                data-ocid="dashboard.active_call.queue_badge"
              >
                {queuePosition
                  ? `Queue position ${queuePosition}`
                  : "Waiting for free line"}
              </Badge>
            )}
            {status === "in_call" && (
              <Badge
                variant="outline"
                className="text-xs border-primary/40 text-primary"
              >
                Twilio Media Stream
              </Badge>
            )}
            {isListeningLive && (
              <Badge
                variant="outline"
                className="text-xs border-green-500/40 text-green-400"
              >
                Live Audio
              </Badge>
            )}

            {status === "error" && errorMessage && (
              <p className="text-xs text-destructive flex-1">{errorMessage}</p>
            )}
            {status === "queued" && (
              <p className="text-xs text-yellow-500/90 flex-1">
                Your paid reservation is held while waiting. You can cancel
                anytime.
              </p>
            )}
            {liveAudioError && (
              <p className="text-xs text-yellow-500 flex-1">{liveAudioError}</p>
            )}
            {lowPaidTime && status === "in_call" && (
              <p className="text-xs text-amber-400 flex-1">
                Paid time is almost out — the call will end when the balance
                hits zero.
              </p>
            )}

            <div className="flex items-center gap-2 ml-auto shrink-0">
              {(status === "completed" || status === "error") && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={dismissStatus}
                  className="h-8 text-xs"
                  data-ocid="dashboard.active_call.dismiss_button"
                >
                  Dismiss
                </Button>
              )}
              {isActive && liveAudioAvailable && (
                <Button
                  variant={isListeningLive ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => void toggleLiveAudio()}
                  data-ocid="dashboard.active_call.listen_button"
                  className="gap-1.5 h-8 text-xs"
                >
                  {isListeningLive ? (
                    <VolumeX className="w-3.5 h-3.5" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" />
                  )}
                  {isListeningLive ? "Stop Audio" : "Listen Live"}
                </Button>
              )}
              {isActive && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onRequestEnd}
                  data-ocid="dashboard.active_call.end_button"
                  className="gap-1.5 h-8 text-xs"
                >
                  <PhoneOff className="w-3.5 h-3.5" />
                  {status === "queued" ? "Cancel Queue" : "End Call"}
                </Button>
              )}
            </div>
          </div>

          {status === "in_call" && liveTranscript.length > 0 && (
            <div
              className="mt-4 border-t border-border pt-4"
              data-ocid="dashboard.active_call.transcript"
            >
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-primary" />
                Live transcript
              </p>
              <div className="max-h-40 overflow-y-auto rounded-lg bg-muted/30 border border-border p-3 space-y-2 font-mono text-xs">
                {liveTranscript.map((line, idx) => (
                  <div key={`${idx}-${line.speaker}`} className="leading-relaxed">
                    <span
                      className={
                        line.speaker.toLowerCase().includes("assistant") ||
                        line.speaker.toLowerCase().includes("ai")
                          ? "text-primary font-semibold"
                          : "text-muted-foreground font-semibold"
                      }
                    >
                      {line.speaker}:{" "}
                    </span>
                    <span className="text-foreground/90">{line.text}</span>
                  </div>
                ))}
                <div ref={transcriptEndRef} />
              </div>
            </div>
          )}

          {status === "in_call" && (
            <form
              className="mt-4 border-t border-border pt-4"
              onSubmit={handleSteeringSubmit}
              data-ocid="dashboard.active_call.steering_form"
            >
              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="live-steering-prompt"
                    className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"
                  >
                    <MessageSquareMore className="w-3.5 h-3.5 text-primary" />
                    Steer AI
                  </Label>
                  <Textarea
                    id="live-steering-prompt"
                    value={steeringPrompt}
                    onChange={(event) => setSteeringPrompt(event.target.value)}
                    placeholder="Add live guidance"
                    maxLength={MAX_STEERING_PROMPT_CHARS}
                    rows={2}
                    aria-invalid={Boolean(steeringError)}
                    disabled={isSendingSteeringPrompt}
                    data-ocid="dashboard.active_call.steering_input"
                    className="min-h-16 resize-none text-sm"
                  />
                  <div className="flex items-center justify-between gap-3">
                    {steeringError ? (
                      <p
                        className="text-xs text-destructive"
                        data-ocid="dashboard.active_call.steering_error"
                      >
                        {steeringError}
                      </p>
                    ) : (
                      <span className="text-xs text-muted-foreground" />
                    )}
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {steeringPrompt.length}/{MAX_STEERING_PROMPT_CHARS}
                    </span>
                  </div>
                </div>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!canSendSteeringPrompt}
                  data-ocid="dashboard.active_call.steering_send"
                  className="gap-1.5 h-9 md:mb-6"
                >
                  {isSendingSteeringPrompt ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  Send
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function OnboardingChecklist({
  hasBalance,
  hasPreset,
  hasCall,
  onBuy,
  onCreatePreset,
}: {
  hasBalance: boolean;
  hasPreset: boolean;
  hasCall: boolean;
  onBuy: () => void;
  onCreatePreset: () => void;
}) {
  if (hasBalance && hasPreset && hasCall) return null;
  const steps = [
    {
      done: hasBalance,
      label: "Add prepaid phone time",
      action: !hasBalance ? (
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onBuy}>
          Buy time
        </Button>
      ) : null,
    },
    {
      done: hasPreset,
      label: "Create an AI call preset",
      action: !hasPreset ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={onCreatePreset}
        >
          Create preset
        </Button>
      ) : null,
    },
    {
      done: hasCall,
      label: "Place your first call",
      action: null,
    },
  ];

  return (
    <Card
      className="bg-card border-primary/30"
      data-ocid="dashboard.onboarding.card"
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Get started</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {steps.map((step) => (
          <div
            key={step.label}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              {step.done ? (
                <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
              ) : (
                <Circle className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <span
                className={`text-sm ${step.done ? "text-muted-foreground line-through" : "text-foreground"}`}
              >
                {step.label}
              </span>
            </div>
            {step.action}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [recipient, setRecipient] = useState("");
  const [recipientError, setRecipientError] = useState("");
  const [recipientHint, setRecipientHint] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [deletePresetId, setDeletePresetId] = useState<bigint | null>(null);
  const [instructionEditorPreset, setInstructionEditorPreset] =
    useState<CallPreset | null>(null);
  const [instructionDraft, setInstructionDraft] = useState("");
  const [saveTranscript, setSaveTranscript] = useState(false);
  const [recordAudio, setRecordAudio] = useState(false);
  const [capturePermissionConfirmed, setCapturePermissionConfirmed] =
    useState(false);
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const [recentPhones, setRecentPhones] = useState<string[]>([]);
  const billingPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const billingBaselineRef = useRef<number | null>(null);

  const { data: presets, isLoading: presetsLoading } = useListMyPresets();
  const {
    data: calls,
    isLoading: callsLoading,
    refetch: refetchCalls,
  } = useListMyCalls();
  const {
    data: billingStatus,
    isLoading: billingLoading,
    refetch: refetchBilling,
  } = useGetMyBillingStatus();
  const deletePreset = useDeletePreset();
  const duplicatePreset = useDuplicatePreset();
  const updatePresetInstructions = useUpdatePresetInstructions();
  const createPurchaseIntent = useCreatePurchaseIntent();
  const voice = useXaiVoice();
  const [buyingPackageId, setBuyingPackageId] = useState<string | null>(null);

  const healthQuery = useQuery({
    queryKey: ["voiceServerHealth", "dashboard"],
    queryFn: getVoiceServerHealth,
    refetchInterval: 30_000,
    retry: 1,
  });

  const recentCalls = (calls ?? []).slice(0, 5);
  const totalCalls = (calls ?? []).length;
  const callsToday = (calls ?? []).filter((c) => {
    const d = new Date(Number(c.startTime / 1_000_000n));
    const now = new Date();
    return (
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()
    );
  }).length;
  const activePresets = (presets ?? []).length;
  const totalBalanceSeconds = Number(billingStatus?.balanceSeconds ?? 0n);
  const availableSeconds = Number(billingStatus?.availableSeconds ?? 0n);
  const reservedSeconds = Number(billingStatus?.reservedSeconds ?? 0n);
  const lowBalance =
    availableSeconds > 0 && availableSeconds < LOW_BALANCE_SECONDS;

  const selectedPreset =
    (presets ?? []).find((p) => p.id.toString() === selectedPresetId) ?? null;

  const isCallActive =
    voice.status !== "idle" &&
    voice.status !== "completed" &&
    voice.status !== "error";
  const savesCallArtifacts = saveTranscript || recordAudio;
  const trimmedInstructionDraft = instructionDraft.trim();
  const canSaveInstructions =
    instructionEditorPreset !== null &&
    trimmedInstructionDraft.length > 0 &&
    trimmedInstructionDraft.length <= MAX_AI_INSTRUCTIONS_CHARS &&
    trimmedInstructionDraft !== instructionEditorPreset.systemPrompt.trim();

  const bridgeOk = healthQuery.data?.ok === true;
  const bridgeDown = healthQuery.isError || healthQuery.data?.ok === false;

  useEffect(() => {
    setRecentPhones(loadRecentPhones());
  }, []);

  useEffect(() => {
    if (!selectedPresetId && (presets ?? []).length > 0) {
      setSelectedPresetId(presets![0].id.toString());
    }
  }, [presets, selectedPresetId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (!billing) return;

    const clearBillingParams = () => {
      params.delete("billing");
      params.delete("session_id");
      const next = params.toString();
      const url = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", url);
    };

    if (billing === "canceled") {
      toast.info("Checkout canceled");
      clearBillingParams();
      return;
    }

    if (billing === "success") {
      toast.info("Confirming payment…", {
        description: "Waiting for Stripe to credit your phone time.",
      });
      billingBaselineRef.current = Number(
        billingStatus?.balanceSeconds ?? 0n,
      );
      let attempts = 0;
      if (billingPollRef.current) clearInterval(billingPollRef.current);
      billingPollRef.current = setInterval(() => {
        attempts += 1;
        void refetchBilling().then((result) => {
          const nextBalance = Number(result.data?.balanceSeconds ?? 0n);
          const baseline = billingBaselineRef.current ?? 0;
          if (nextBalance > baseline) {
            toast.success("Phone time credited", {
              description: `${formatMinutes(nextBalance)} total balance`,
            });
            if (billingPollRef.current) {
              clearInterval(billingPollRef.current);
              billingPollRef.current = null;
            }
            clearBillingParams();
          } else if (attempts >= 15) {
            toast.message("Payment received", {
              description:
                "Credit is still processing. Refresh balance in a moment if it does not update.",
            });
            if (billingPollRef.current) {
              clearInterval(billingPollRef.current);
              billingPollRef.current = null;
            }
            clearBillingParams();
          }
        });
      }, 2000);
    }

    return () => {
      if (billingPollRef.current) {
        clearInterval(billingPollRef.current);
        billingPollRef.current = null;
      }
    };
    // Only run on mount for return URL handling
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRecipientChange = (value: string) => {
    setRecipient(value);
    setRecipientHint(phoneInputHint(value));
    if (recipientError) setRecipientError("");
  };

  const handleRecipientBlur = () => {
    const normalized = normalizeToE164(recipient);
    if (normalized && normalized !== recipient) {
      setRecipient(normalized);
    }
    const check = normalized || recipient;
    if (check && !isValidE164(check.replace(/\s/g, ""))) {
      setRecipientError("Enter a valid number, e.g. +15551234567");
    } else {
      setRecipientError("");
      setRecipientHint(null);
    }
  };

  const handleCall = async () => {
    if (availableSeconds <= 0) {
      toast.error("Add prepaid phone time before starting a call");
      return;
    }
    if (!recipient || !selectedPreset) {
      toast.error("Enter a recipient number and select a preset");
      return;
    }
    const cleaned = normalizeToE164(recipient.replace(/\s/g, ""));
    if (!isValidE164(cleaned)) {
      setRecipientError("Enter a valid number, e.g. +15551234567");
      return;
    }
    if (savesCallArtifacts && !capturePermissionConfirmed) {
      toast.error("Confirm permission before saving call artifacts");
      return;
    }
    if (bridgeDown) {
      toast.error("Voice bridge is unavailable", {
        description: "Check the system status banner and try again shortly.",
      });
      return;
    }
    setRecipient(cleaned);
    setRecipientError("");
    await voice.startCall(selectedPreset, cleaned, {
      saveTranscript,
      recordAudio,
      permissionConfirmed: capturePermissionConfirmed,
    });
    setRecentPhones(loadRecentPhones());
    refetchBilling();
  };

  const openInstructionEditor = (preset: CallPreset) => {
    setInstructionEditorPreset(preset);
    setInstructionDraft(preset.systemPrompt);
  };

  const savePresetInstructions = async () => {
    if (!instructionEditorPreset) return;
    if (!trimmedInstructionDraft) {
      toast.error("AI instructions are required");
      return;
    }
    if (trimmedInstructionDraft.length > MAX_AI_INSTRUCTIONS_CHARS) {
      toast.error("AI instructions must be 8000 characters or fewer");
      return;
    }
    const result = await updatePresetInstructions.mutateAsync({
      id: instructionEditorPreset.id,
      systemPrompt: trimmedInstructionDraft,
    });
    if (result.__kind__ === "err") {
      toast.error(result.err);
      return;
    }
    toast.success("Preset instructions updated");
    setInstructionEditorPreset(null);
    setInstructionDraft("");
  };

  const handleBuyPackage = async (packageId: string) => {
    setBuyingPackageId(packageId);
    try {
      const intent = await createPurchaseIntent.mutateAsync(packageId);
      if (intent.__kind__ === "err") {
        throw new Error(intent.err);
      }
      const returnUrl = `${window.location.origin}${window.location.pathname}`;
      const session = await createCheckoutSession({
        purchaseIntentId: intent.ok.id,
        returnUrl,
      });
      window.location.assign(session.url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Unable to start checkout: ${message}`);
      setBuyingPackageId(null);
    }
  };

  const lineSummary = useMemo(() => {
    const lines = healthQuery.data?.twilioLines;
    if (!lines) return null;
    return `${lines.available ?? 0}/${lines.configured ?? 0} lines free`;
  }, [healthQuery.data?.twilioLines]);

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="p-6 space-y-5" data-ocid="dashboard.page">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-display text-2xl font-bold text-foreground">
                Dashboard
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Configure and launch AI-powered calls
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate({ to: "/user/settings" })}
              data-ocid="dashboard.new_preset_button"
              className="gap-2"
            >
              <Plus className="w-3.5 h-3.5" />
              New Preset
            </Button>
          </div>

          {/* Bridge health */}
          <div
            className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5 text-xs ${
              bridgeDown
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : bridgeOk
                  ? "border-border bg-muted/20 text-muted-foreground"
                  : "border-border bg-muted/20 text-muted-foreground"
            }`}
            data-ocid="dashboard.bridge_status"
          >
            {healthQuery.isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Checking voice bridge…
              </>
            ) : bridgeDown ? (
              <>
                <WifiOff className="w-3.5 h-3.5" />
                Voice bridge is unreachable. Calls and checkout may fail until
                it recovers.
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 ml-auto"
                  onClick={() => void healthQuery.refetch()}
                >
                  Retry
                </Button>
              </>
            ) : (
              <>
                <Wifi className="w-3.5 h-3.5 text-primary" />
                <span className="text-foreground/80">Bridge online</span>
                {healthQuery.data?.xaiConfigured ? (
                  <Badge variant="outline" className="h-5 text-[10px]">
                    xAI
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="h-5 text-[10px] text-amber-400 border-amber-500/40"
                  >
                    xAI not ready
                  </Badge>
                )}
                {healthQuery.data?.twilioConfigured ? (
                  <Badge variant="outline" className="h-5 text-[10px]">
                    Twilio
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="h-5 text-[10px] text-amber-400 border-amber-500/40"
                  >
                    Twilio not ready
                  </Badge>
                )}
                {lineSummary && (
                  <span className="text-muted-foreground">{lineSummary}</span>
                )}
                {(healthQuery.data?.twilioLines?.queued ?? 0) > 0 && (
                  <span className="text-yellow-400">
                    {healthQuery.data?.twilioLines?.queued} queued
                  </span>
                )}
              </>
            )}
          </div>

          {lowBalance && (
            <div
              className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200"
              data-ocid="dashboard.low_balance_banner"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Low phone time: {formatMinutes(availableSeconds)} available. Buy
              more before longer calls.
            </div>
          )}

          <OnboardingChecklist
            hasBalance={availableSeconds > 0 || totalBalanceSeconds > 0}
            hasPreset={activePresets > 0}
            hasCall={totalCalls > 0}
            onBuy={() => {
              document
                .querySelector('[data-ocid="dashboard.billing_card"]')
                ?.scrollIntoView({ behavior: "smooth" });
            }}
            onCreatePreset={() => navigate({ to: "/user/settings" })}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard
              icon={<Phone className="w-4 h-4 text-primary" />}
              label="Total Calls"
              value={totalCalls}
              loading={callsLoading}
            />
            <StatCard
              icon={<Clock className="w-4 h-4 text-blue-400" />}
              label="Calls Today"
              value={callsToday}
              color="text-blue-400"
              loading={callsLoading}
            />
            <StatCard
              icon={<Settings2 className="w-4 h-4 text-purple-400" />}
              label="Active Presets"
              value={activePresets}
              color="text-purple-400"
              loading={presetsLoading}
            />
            <StatCard
              icon={<CreditCard className="w-4 h-4 text-green-400" />}
              label="Phone Time"
              value={formatMinutes(billingStatus?.balanceSeconds)}
              color={
                totalBalanceSeconds > 0 ? "text-green-400" : "text-destructive"
              }
              loading={billingLoading}
            />
          </div>

          <Card
            className="bg-card border-border"
            data-ocid="dashboard.billing_card"
          >
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-green-400" />
                  Phone Time
                </CardTitle>
                <Badge variant="outline" className="font-mono">
                  {formatMinutes(billingStatus?.availableSeconds)} available
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {billingLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-24 w-full" />
                  ))}
                </div>
              ) : (
                <>
                  <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-lg border border-border bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground">
                        Total balance
                      </p>
                      <p className="mt-1 text-sm font-semibold text-foreground">
                        {formatMinutes(billingStatus?.balanceSeconds)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground">Available</p>
                      <p className="mt-1 text-sm font-semibold text-green-400">
                        {formatMinutes(billingStatus?.availableSeconds)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground">
                        Reserved in calls
                      </p>
                      <p
                        className={
                          reservedSeconds > 0
                            ? "mt-1 text-sm font-semibold text-amber-400"
                            : "mt-1 text-sm font-semibold text-muted-foreground"
                        }
                      >
                        {formatMinutes(billingStatus?.reservedSeconds)}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {(billingStatus?.packages ?? []).map((pkg) => {
                      const isBuying = buyingPackageId === pkg.id;
                      return (
                        <div
                          key={pkg.id}
                          className="rounded-lg border border-border bg-muted/25 p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-foreground">
                                ${(Number(pkg.amountCents) / 100).toFixed(0)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatMinutes(pkg.seconds)}
                              </p>
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {pkg.id.replace("pack_", "$")}
                            </Badge>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-3 w-full gap-2"
                            onClick={() => handleBuyPackage(pkg.id)}
                            disabled={isBuying}
                            data-ocid={`dashboard.billing.buy.${pkg.id}`}
                          >
                            {isBuying ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <CreditCard className="w-3.5 h-3.5" />
                            )}
                            Buy
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <ActiveCallPanel
            voice={voice}
            onRequestEnd={() => setConfirmEndOpen(true)}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <Card
              className="lg:col-span-1 bg-card border-border"
              data-ocid="dashboard.call_card"
            >
              <CardHeader className="pb-4">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Phone className="w-4 h-4 text-primary" />
                  Make a Call
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="recipient"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Recipient Phone
                  </Label>
                  <Input
                    id="recipient"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="+15551234567"
                    value={recipient}
                    onChange={(e) => handleRecipientChange(e.target.value)}
                    onBlur={handleRecipientBlur}
                    data-ocid="dashboard.recipient.input"
                    className="font-mono text-sm"
                    disabled={isCallActive}
                  />
                  {recipientError ? (
                    <p
                      className="text-xs text-destructive"
                      data-ocid="dashboard.recipient.field_error"
                    >
                      {recipientError}
                    </p>
                  ) : recipientHint ? (
                    <p className="text-xs text-muted-foreground">
                      {recipientHint}
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      US 10-digit numbers auto-convert to +1…
                    </p>
                  )}
                  {recentPhones.length > 0 && !isCallActive && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {recentPhones.map((phone) => (
                        <button
                          key={phone}
                          type="button"
                          onClick={() => {
                            setRecipient(phone);
                            setRecipientError("");
                            setRecipientHint(null);
                          }}
                          className="text-[11px] font-mono px-2 py-1 rounded-md border border-border bg-muted/30 hover:border-primary/40 text-muted-foreground hover:text-foreground transition-colors"
                          data-ocid="dashboard.recipient.recent"
                        >
                          {formatPhoneDisplay(phone)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Call Preset
                  </Label>
                  {presetsLoading ? (
                    <Skeleton className="h-9 w-full" />
                  ) : (presets ?? []).length === 0 ? (
                    <div
                      className="text-xs text-muted-foreground py-2 px-3 rounded-lg bg-muted/40"
                      data-ocid="dashboard.presets.empty_state"
                    >
                      No presets yet.{" "}
                      <button
                        type="button"
                        onClick={() => navigate({ to: "/user/settings" })}
                        className="text-primary hover:underline"
                      >
                        Create one
                      </button>
                    </div>
                  ) : (
                    <Select
                      value={selectedPresetId}
                      onValueChange={setSelectedPresetId}
                      disabled={isCallActive}
                    >
                      <SelectTrigger data-ocid="dashboard.preset.select">
                        <SelectValue placeholder="Select a preset" />
                      </SelectTrigger>
                      <SelectContent>
                        {(presets ?? []).map((p) => (
                          <SelectItem
                            key={p.id.toString()}
                            value={p.id.toString()}
                          >
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {selectedPreset && (
                  <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-foreground truncate">
                        {selectedPreset.name}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 gap-1.5 px-2 text-xs"
                        onClick={() => openInstructionEditor(selectedPreset)}
                        disabled={isCallActive}
                        data-ocid="dashboard.selected_preset.edit_instructions_button"
                      >
                        <Pencil className="w-3 h-3" />
                        Edit
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {selectedPreset.systemPrompt}
                    </p>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <Badge variant="outline" className="text-xs h-4 px-1">
                        {getVoiceLabel(
                          selectedPreset.voice,
                          selectedPreset.voiceId,
                        )}
                      </Badge>
                      <Badge variant="outline" className="text-xs h-4 px-1">
                        {selectedPreset.sampleRate}
                      </Badge>
                    </div>
                  </div>
                )}

                <div
                  className="rounded-lg bg-muted/20 border border-border p-3 space-y-3"
                  data-ocid="dashboard.call_artifacts.options"
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <FileText className="w-3.5 h-3.5 text-primary" />
                    Call Artifacts
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label className="text-xs text-foreground">
                        Save transcript
                      </Label>
                      <p className="text-[11px] text-muted-foreground">
                        Store the call text in history
                      </p>
                    </div>
                    <Switch
                      checked={saveTranscript}
                      onCheckedChange={setSaveTranscript}
                      disabled={isCallActive}
                      data-ocid="dashboard.call_artifacts.transcript_switch"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label className="text-xs text-foreground">
                        Record audio
                      </Label>
                      <p className="text-[11px] text-muted-foreground">
                        Save a call recording link
                      </p>
                    </div>
                    <Switch
                      checked={recordAudio}
                      onCheckedChange={setRecordAudio}
                      disabled={isCallActive}
                      data-ocid="dashboard.call_artifacts.recording_switch"
                    />
                  </div>
                  {savesCallArtifacts && (
                    <div className="flex items-start gap-2 rounded-md bg-background/60 border border-border p-2 text-[11px] leading-relaxed text-muted-foreground">
                      <Checkbox
                        id="call-artifacts-permission"
                        checked={capturePermissionConfirmed}
                        onCheckedChange={(checked) =>
                          setCapturePermissionConfirmed(checked === true)
                        }
                        disabled={isCallActive}
                        data-ocid="dashboard.call_artifacts.permission_checkbox"
                        className="mt-0.5"
                      />
                      <Label
                        htmlFor="call-artifacts-permission"
                        className="text-[11px] leading-relaxed text-muted-foreground"
                      >
                        I confirm I have permission to record or save this
                        conversation, or that consent is not required where it
                        takes place.
                      </Label>
                    </div>
                  )}
                </div>

                <Button
                  onClick={handleCall}
                  disabled={
                    isCallActive ||
                    !recipient ||
                    !selectedPresetId ||
                    availableSeconds <= 0 ||
                    bridgeDown ||
                    (savesCallArtifacts && !capturePermissionConfirmed)
                  }
                  data-ocid="dashboard.call.submit_button"
                  className="w-full gap-2"
                >
                  {voice.status === "initiating" ||
                  voice.status === "queued" ||
                  voice.status === "connecting" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Phone className="w-4 h-4" />
                  )}
                  {voice.status === "initiating"
                    ? "Initiating..."
                    : voice.status === "queued"
                      ? "Queued..."
                      : voice.status === "connecting"
                        ? "Connecting..."
                        : availableSeconds <= 0
                          ? "Add Phone Time"
                          : bridgeDown
                            ? "Bridge Offline"
                            : "Start Call"}
                </Button>
              </CardContent>
            </Card>

            <Card
              className="lg:col-span-2 bg-card border-border"
              data-ocid="dashboard.presets_card"
            >
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold">
                    My Presets
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate({ to: "/user/settings" })}
                    className="gap-1.5 text-xs h-7"
                    data-ocid="dashboard.presets.new_button"
                  >
                    <Plus className="w-3 h-3" />
                    New
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {presetsLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-14 w-full" />
                    ))}
                  </div>
                ) : (presets ?? []).length === 0 ? (
                  <div
                    className="flex flex-col items-center justify-center py-10 text-center"
                    data-ocid="dashboard.presets.grid_empty_state"
                  >
                    <Settings2 className="w-8 h-8 text-muted-foreground/40 mb-3" />
                    <p className="text-sm font-medium text-muted-foreground">
                      No presets configured
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-1 mb-4">
                      Create a preset to define voice, prompt, and call behavior
                    </p>
                    <Button
                      size="sm"
                      onClick={() => navigate({ to: "/user/settings" })}
                      data-ocid="dashboard.presets.create_button"
                    >
                      Create First Preset
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(presets ?? []).map((preset: CallPreset, idx) => {
                      const isSelected =
                        selectedPresetId === preset.id.toString();
                      return (
                        <div
                          key={preset.id.toString()}
                          data-ocid={`dashboard.preset.item.${idx + 1}`}
                          className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 transition-smooth ${
                            isSelected
                              ? "bg-primary/10 border-primary/40"
                              : "bg-muted/30 hover:bg-muted/50 border-transparent hover:border-border"
                          }`}
                        >
                          <button
                            type="button"
                            className="flex flex-1 min-w-0 cursor-pointer items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() =>
                              setSelectedPresetId(preset.id.toString())
                            }
                            data-ocid={`dashboard.preset.select_button.${idx + 1}`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-medium text-foreground truncate">
                                  {preset.name}
                                </p>
                                {isSelected && (
                                  <Badge
                                    variant="outline"
                                    className="text-xs h-4 px-1 border-primary/40 text-primary shrink-0"
                                  >
                                    Selected
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground truncate">
                                {getVoiceLabel(preset.voice, preset.voiceId)} ·{" "}
                                {preset.systemPrompt.substring(0, 60)}
                                {preset.systemPrompt.length > 60 ? "..." : ""}
                              </p>
                            </div>
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                openInstructionEditor(preset);
                              }}
                              aria-label="Edit preset instructions"
                              data-ocid={`dashboard.preset.edit_instructions_button.${idx + 1}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                duplicatePreset.mutate(preset.id);
                              }}
                              aria-label="Duplicate preset"
                              data-ocid={`dashboard.preset.duplicate_button.${idx + 1}`}
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeletePresetId(preset.id);
                              }}
                              aria-label="Delete preset"
                              data-ocid={`dashboard.preset.delete_button.${idx + 1}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card
            className="bg-card border-border"
            data-ocid="dashboard.calls_card"
          >
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">
                  Recent Calls
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => refetchCalls()}
                    aria-label="Refresh"
                    data-ocid="dashboard.calls.refresh_button"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate({ to: "/user/history" })}
                    className="text-xs h-7"
                    data-ocid="dashboard.calls.view_all_button"
                  >
                    View All
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {callsLoading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : recentCalls.length === 0 ? (
                <div
                  className="text-center py-8 text-muted-foreground text-sm"
                  data-ocid="dashboard.calls.empty_state"
                >
                  No calls yet. Start your first call above.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {recentCalls.map((call, idx) => (
                    <div
                      key={call.id.toString()}
                      data-ocid={`dashboard.call.item.${idx + 1}`}
                      className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate font-mono">
                          {formatPhoneDisplay(call.recipientPhone)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(
                            Number(call.startTime / 1_000_000n),
                          ).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs font-mono text-muted-foreground">
                          {formatCallDuration(call.startTime, call.endTime)}
                        </span>
                        <CallStatusBadge status={call.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </AppLayout>

      <Dialog
        open={instructionEditorPreset !== null}
        onOpenChange={(open) => {
          if (!open) {
            setInstructionEditorPreset(null);
            setInstructionDraft("");
          }
        }}
      >
        <DialogContent data-ocid="dashboard.preset.instructions_dialog">
          <DialogHeader>
            <DialogTitle>Edit AI Instructions</DialogTitle>
            <DialogDescription>
              {instructionEditorPreset?.name ?? "Call preset"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="dashboard-preset-instructions">Instructions</Label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Edit the saved prompt directly. Include role, goal, facts,
              boundaries, and expected questions the AI should be ready for.
            </p>
            <Textarea
              id="dashboard-preset-instructions"
              value={instructionDraft}
              onChange={(event) => setInstructionDraft(event.target.value)}
              rows={8}
              maxLength={MAX_AI_INSTRUCTIONS_CHARS}
              data-ocid="dashboard.preset.instructions_textarea"
              className="resize-none font-mono text-xs leading-relaxed"
            />
            <div className="flex items-center justify-end gap-3">
              <span className="text-[11px] text-muted-foreground font-mono">
                {trimmedInstructionDraft.length}/{MAX_AI_INSTRUCTIONS_CHARS}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setInstructionEditorPreset(null);
                setInstructionDraft("");
              }}
              data-ocid="dashboard.preset.instructions_cancel_button"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void savePresetInstructions()}
              disabled={
                !canSaveInstructions || updatePresetInstructions.isPending
              }
              data-ocid="dashboard.preset.instructions_save_button"
              className="gap-2"
            >
              {updatePresetInstructions.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Pencil className="w-4 h-4" />
              )}
              Save Instructions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deletePresetId !== null}
        onOpenChange={(open) => !open && setDeletePresetId(null)}
      >
        <AlertDialogContent data-ocid="delete-preset.dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Preset?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-ocid="delete-preset.cancel_button">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-ocid="delete-preset.confirm_button"
              onClick={() => {
                if (deletePresetId !== null) {
                  deletePreset.mutate(deletePresetId);
                  setDeletePresetId(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmEndOpen} onOpenChange={setConfirmEndOpen}>
        <AlertDialogContent data-ocid="end-call.dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {voice.status === "queued" ? "Leave the queue?" : "End this call?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {voice.status === "queued"
                ? "Your reserved minutes will be released after the queue entry is canceled."
                : "This hangs up the Twilio call and stops the AI session."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep going</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmEndOpen(false);
                voice.endCall();
              }}
              data-ocid="end-call.confirm_button"
            >
              {voice.status === "queued" ? "Cancel queue" : "End call"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ProtectedRoute>
  );
}
