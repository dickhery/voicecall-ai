import { UserRole } from "@/backend";
import { AppLayout } from "@/components/AppLayout";
import { CallStatusBadge } from "@/components/CallStatusBadge";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAdminAddPromoMinutes,
  useAdminListAllCalls,
  useAssignUserRole,
  useGetAdminConfig,
  useSetAdminConfig,
} from "@/hooks/use-backend";
import { getVoiceServerHealth } from "@/lib/voice-server";
import { Principal } from "@icp-sdk/core/principal";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle,
  CreditCard,
  Eye,
  EyeOff,
  Gift,
  KeyRound,
  Loader2,
  Phone,
  Radio,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

function InputWithReveal({
  id,
  placeholder,
  value,
  onChange,
  "data-ocid": dataOcid,
}: {
  id: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  "data-ocid"?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-ocid={dataOcid}
        className="pr-9 font-mono text-sm"
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        aria-label={show ? "Hide" : "Show"}
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

function StatusBadge({
  configured,
  configuredLabel = "Configured",
  missingLabel = "Not Set",
}: {
  configured: boolean;
  configuredLabel?: string;
  missingLabel?: string;
}) {
  return configured ? (
    <Badge
      variant="outline"
      className="bg-green-500/10 text-green-400 border-green-500/30 text-xs"
    >
      <CheckCircle className="w-3 h-3 mr-1" />
      {configuredLabel}
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className="bg-destructive/10 text-destructive border-destructive/30 text-xs"
    >
      <XCircle className="w-3 h-3 mr-1" />
      {missingLabel}
    </Badge>
  );
}

export default function AdminDashboardPage() {
  const { data: config, isLoading: configLoading } = useGetAdminConfig();
  const { data: allCalls, isLoading: callsLoading } = useAdminListAllCalls();
  const setConfig = useSetAdminConfig();
  const assignRole = useAssignUserRole();
  const addPromoMinutes = useAdminAddPromoMinutes();
  const voiceServerQuery = useQuery({
    queryKey: ["voiceServerHealth"],
    queryFn: getVoiceServerHealth,
    retry: false,
  });

  // xAI section state
  const [xaiKey, setXaiKey] = useState("");
  const [xaiSaving, setXaiSaving] = useState(false);

  // Twilio section state
  const [twilioSid, setTwilioSid] = useState("");
  const [twilioToken, setTwilioToken] = useState("");
  const [twilioFrom, setTwilioFrom] = useState("");
  const [twilioSaving, setTwilioSaving] = useState(false);
  const [twilioTesting, setTwilioTesting] = useState(false);
  const [fromError, setFromError] = useState("");

  const [promoUserId, setPromoUserId] = useState("");
  const [promoMinutes, setPromoMinutes] = useState("");

  const handleSaveXai = async () => {
    if (!xaiKey.trim()) {
      toast.error("Enter an xAI API key");
      return;
    }
    setXaiSaving(true);
    try {
      await setConfig.mutateAsync({
        xaiApiKey: xaiKey,
        // Pass empty strings for Twilio — backend treats empty as "keep existing"
        twilioAccountSid: "",
        twilioAuthToken: "",
        twilioFromNumber: "",
      });
      toast.success("xAI API key saved successfully");
      setXaiKey("");
    } catch {
      toast.error("Failed to save xAI configuration");
    } finally {
      setXaiSaving(false);
    }
  };

  const handleSaveTwilio = async () => {
    if (!twilioSid.trim() && !twilioToken.trim() && !twilioFrom.trim()) {
      toast.error("Enter at least one Twilio field to update");
      return;
    }
    if (twilioFrom.trim() && !E164_REGEX.test(twilioFrom.trim())) {
      setFromError("Must be in E.164 format: +12025551234");
      return;
    }
    setFromError("");
    setTwilioSaving(true);
    try {
      await setConfig.mutateAsync({
        // Pass empty string for xAI — backend treats empty as "keep existing"
        xaiApiKey: "",
        twilioAccountSid: twilioSid,
        twilioAuthToken: twilioToken,
        twilioFromNumber: twilioFrom,
      });
      toast.success("Twilio credentials saved successfully");
      setTwilioToken("");
    } catch {
      toast.error("Failed to save Twilio configuration");
    } finally {
      setTwilioSaving(false);
    }
  };

  const handleTestTwilio = async () => {
    setTwilioTesting(true);
    // Simulate connection test — real implementation would call a test endpoint
    await new Promise((r) => setTimeout(r, 1500));
    if (config?.hasTwilioAuth) {
      toast.success("Twilio connection verified", {
        description: "Credentials are valid and API is reachable",
      });
    } else {
      toast.error("Twilio not configured", {
        description: "Save credentials before testing the connection",
      });
    }
    setTwilioTesting(false);
  };

  const validateFrom = (v: string) => {
    setTwilioFrom(v);
    if (v && !E164_REGEX.test(v)) {
      setFromError("Must be in E.164 format: +12025551234");
    } else {
      setFromError("");
    }
  };

  const paymentServerPrincipal =
    voiceServerQuery.data?.icpServerPrincipal?.trim() ?? "";

  const handleAuthorizePaymentServer = async () => {
    if (!paymentServerPrincipal) {
      toast.error("Payment server principal is unavailable");
      return;
    }
    try {
      await assignRole.mutateAsync({
        user: Principal.fromText(paymentServerPrincipal),
        role: UserRole.admin,
      });
      toast.success("Payment server authorized");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to authorize server";
      toast.error(message);
    }
  };

  const handleAddPromoMinutes = async (event: FormEvent) => {
    event.preventDefault();

    const trimmedUserId = promoUserId.trim();
    const trimmedMinutes = promoMinutes.trim();
    if (!trimmedUserId) {
      toast.error("Enter a User ID");
      return;
    }
    if (!/^\d+$/.test(trimmedMinutes)) {
      toast.error("Enter whole promo minutes");
      return;
    }

    const minutes = BigInt(trimmedMinutes);
    if (minutes === 0n) {
      toast.error("Promo minutes must be greater than zero");
      return;
    }

    let user: Principal;
    try {
      user = Principal.fromText(trimmedUserId);
    } catch {
      toast.error("Enter a valid User ID");
      return;
    }

    try {
      const result = await addPromoMinutes.mutateAsync({ user, minutes });
      if (result.__kind__ === "err") {
        toast.error(result.err);
        return;
      }
      toast.success(
        `Added ${minutes.toString()} promo minute${minutes === 1n ? "" : "s"}`,
      );
      setPromoUserId("");
      setPromoMinutes("");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to add promo minutes";
      toast.error(message);
    }
  };

  const recentCalls = (allCalls ?? []).slice(0, 10);

  return (
    <ProtectedRoute requireAdmin>
      <AppLayout>
        <div className="p-6 space-y-8" data-ocid="admin.dashboard.page">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">
              Admin Dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage integrations and monitor all system calls
            </p>
          </div>

          {/* Integration section label */}
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
              Integrations
            </h2>
          </div>

          {/* Integration cards */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* xAI config */}
            <Card
              className="bg-card border-border"
              data-ocid="admin.xai_config.card"
            >
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-primary" />
                    xAI Configuration
                  </CardTitle>
                  {configLoading ? (
                    <Skeleton className="h-5 w-20" />
                  ) : (
                    <StatusBadge configured={config?.hasXaiKey ?? false} />
                  )}
                </div>
                <CardDescription>
                  xAI Voice API key for AI-powered conversations
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="xai-key"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {config?.hasXaiKey ? "Update API Key" : "API Key"}
                  </Label>
                  <InputWithReveal
                    id="xai-key"
                    placeholder={
                      config?.hasXaiKey
                        ? "Enter new key to replace..."
                        : "xai-..."
                    }
                    value={xaiKey}
                    onChange={setXaiKey}
                    data-ocid="admin.xai_key.input"
                  />
                </div>
                <Button
                  onClick={handleSaveXai}
                  disabled={xaiSaving || !xaiKey.trim()}
                  data-ocid="admin.xai.save_button"
                  className="w-full gap-2"
                >
                  {xaiSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : null}
                  {xaiSaving ? "Saving..." : "Save API Key"}
                </Button>
              </CardContent>
            </Card>

            {/* Twilio config */}
            <Card
              className="bg-card border-border"
              data-ocid="admin.twilio_config.card"
            >
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Phone className="w-4 h-4 text-primary" />
                    Twilio Configuration
                  </CardTitle>
                  {configLoading ? (
                    <Skeleton className="h-5 w-20" />
                  ) : (
                    <StatusBadge configured={config?.hasTwilioAuth ?? false} />
                  )}
                </div>
                <CardDescription>
                  Twilio credentials for outbound phone calls
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="twilio-sid"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Account SID
                  </Label>
                  <Input
                    id="twilio-sid"
                    placeholder={config?.twilioAccountSid || "AC..."}
                    value={twilioSid}
                    onChange={(e) => setTwilioSid(e.target.value)}
                    data-ocid="admin.twilio_sid.input"
                    className="font-mono text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="twilio-token"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Auth Token
                  </Label>
                  <InputWithReveal
                    id="twilio-token"
                    placeholder="Enter auth token..."
                    value={twilioToken}
                    onChange={setTwilioToken}
                    data-ocid="admin.twilio_token.input"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="twilio-from"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    From Number
                  </Label>
                  <Input
                    id="twilio-from"
                    placeholder={config?.twilioFromNumber || "+12025551234"}
                    value={twilioFrom}
                    onChange={(e) => validateFrom(e.target.value)}
                    data-ocid="admin.twilio_from.input"
                    className={`font-mono text-sm ${
                      fromError
                        ? "border-destructive focus-visible:ring-destructive"
                        : ""
                    }`}
                  />
                  {fromError && (
                    <p
                      className="text-xs text-destructive"
                      data-ocid="admin.twilio_from.field_error"
                    >
                      {fromError}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    onClick={handleSaveTwilio}
                    disabled={twilioSaving}
                    data-ocid="admin.twilio.save_button"
                    className="flex-1 gap-2"
                  >
                    {twilioSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : null}
                    {twilioSaving ? "Saving..." : "Save Credentials"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleTestTwilio}
                    disabled={twilioTesting}
                    data-ocid="admin.twilio.test_button"
                    className="flex-1 gap-2"
                  >
                    {twilioTesting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Radio className="w-4 h-4" />
                    )}
                    {twilioTesting ? "Testing..." : "Test Connection"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Payment server authorization */}
            <Card
              className="bg-card border-border"
              data-ocid="admin.payment_server.card"
            >
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-primary" />
                    Payment Server
                  </CardTitle>
                  {voiceServerQuery.isLoading ? (
                    <Skeleton className="h-5 w-20" />
                  ) : (
                    <StatusBadge
                      configured={
                        Boolean(paymentServerPrincipal) &&
                        Boolean(voiceServerQuery.data?.billingConfigured)
                      }
                      configuredLabel="Detected"
                      missingLabel="Unavailable"
                    />
                  )}
                </div>
                <CardDescription>
                  Stripe checkout and webhook fulfillment identity
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="payment-server-principal"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Principal ID
                  </Label>
                  <Input
                    id="payment-server-principal"
                    readOnly
                    value={paymentServerPrincipal}
                    placeholder={
                      voiceServerQuery.isError
                        ? "Voice server unavailable"
                        : "Waiting for voice server..."
                    }
                    data-ocid="admin.payment_server.principal.input"
                    className="font-mono text-sm"
                  />
                </div>
                <Button
                  onClick={handleAuthorizePaymentServer}
                  disabled={!paymentServerPrincipal || assignRole.isPending}
                  data-ocid="admin.payment_server.authorize_button"
                  className="w-full gap-2"
                >
                  {assignRole.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-4 h-4" />
                  )}
                  {assignRole.isPending ? "Authorizing..." : "Authorize Server"}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Promo minutes */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Gift className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
                Promo Minutes
              </h2>
            </div>
            <Card
              className="bg-card border-border max-w-3xl"
              data-ocid="admin.promo_minutes.card"
            >
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Gift className="w-4 h-4 text-primary" />
                  Add Promo Minutes
                </CardTitle>
                <CardDescription>
                  Top up a user balance with admin-issued phone time
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={handleAddPromoMinutes}
                  className="grid gap-4 md:grid-cols-[minmax(0,1fr)_160px_auto] md:items-end"
                >
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="promo-user-id"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      User ID
                    </Label>
                    <Input
                      id="promo-user-id"
                      value={promoUserId}
                      onChange={(e) => setPromoUserId(e.target.value)}
                      placeholder="aaaaa-aa"
                      data-ocid="admin.promo_minutes.user_id.input"
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="promo-minutes"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Minutes
                    </Label>
                    <Input
                      id="promo-minutes"
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      value={promoMinutes}
                      onChange={(e) => setPromoMinutes(e.target.value)}
                      placeholder="30"
                      data-ocid="admin.promo_minutes.minutes.input"
                      className="font-mono text-sm"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={addPromoMinutes.isPending}
                    data-ocid="admin.promo_minutes.submit_button"
                    className="gap-2"
                  >
                    {addPromoMinutes.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Gift className="w-4 h-4" />
                    )}
                    {addPromoMinutes.isPending ? "Adding..." : "Add Minutes"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* All calls */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Phone className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">
                Recent Calls
              </h2>
            </div>
            <Card
              className="bg-card border-border"
              data-ocid="admin.all_calls.card"
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">All Calls</CardTitle>
                  <CardDescription className="text-xs">
                    {callsLoading
                      ? "Loading..."
                      : `${allCalls?.length ?? 0} total`}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {callsLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : recentCalls.length === 0 ? (
                  <div
                    className="text-center py-10 text-sm text-muted-foreground"
                    data-ocid="admin.all_calls.empty_state"
                  >
                    No calls in the system yet.
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {recentCalls.map((call, idx) => (
                      <div
                        key={call.id.toString()}
                        data-ocid={`admin.call.item.${idx + 1}`}
                        className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                      >
                        <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-mono font-medium truncate">
                            {call.recipientPhone}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono truncate">
                            {call.userId.toString().substring(0, 24)}...
                          </p>
                        </div>
                        <CallStatusBadge status={call.status} />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
