import { CallStatus } from "@/backend";
import { AppLayout } from "@/components/AppLayout";
import { CallStatusBadge } from "@/components/CallStatusBadge";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useListMyAnsweringPresets,
  useListMyCalls,
  useListMyPresets,
} from "@/hooks/use-backend";
import { getRecordingAccessUrl } from "@/lib/voice-server";
import type { CallRecordPublic } from "@/types";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Phone,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 15;
const ANSWERING_PRESET_ID_OFFSET = 1_000_000_000n;

function formatDuration(start: bigint, end?: bigint): string {
  if (!end) return "—";
  const secs = Number((end - start) / 1_000_000_000n);
  const m = Math.floor(secs / 60)
    .toString()
    .padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function formatDateTime(ns: bigint): string {
  const ms = Number(ns / 1_000_000n);
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function exportCsv(calls: CallRecordPublic[], presetMap: Map<string, string>) {
  const header = [
    "Call ID",
    "Recipient",
    "Preset",
    "Date",
    "Duration",
    "Status",
  ];
  const rows = calls.map((c) => [
    c.id.toString(),
    c.recipientPhone,
    presetMap.get(c.presetId.toString()) ?? c.presetId.toString(),
    new Date(Number(c.startTime / 1_000_000n)).toISOString(),
    formatDuration(c.startTime, c.endTime).replace("—", ""),
    c.status,
  ]);
  const csv = [header, ...rows]
    .map((row) =>
      row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `voicecall-history-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseCallArtifacts(text?: string) {
  const source = text ?? "";
  const recordingUrlMatch = source.match(/^Recording URL:\s*(.+)$/im);
  const recordingSidMatch = source.match(/^Recording SID:\s*(.+)$/im);
  const rawRecordingUrl = recordingUrlMatch?.[1]?.trim() ?? "";
  const recordingUrl =
    rawRecordingUrl && rawRecordingUrl.toLowerCase() !== "pending"
      ? rawRecordingUrl
      : null;
  const transcript = source
    .replace(/^Recording:\s*.*$/gim, "")
    .replace(/^Recording URL:\s*.*$/gim, "")
    .replace(/^Recording SID:\s*.*$/gim, "")
    .trim();

  return {
    transcript,
    recordingUrl,
    recordingSid: recordingSidMatch?.[1]?.trim() ?? null,
    recordingPending: rawRecordingUrl.toLowerCase() === "pending",
  };
}

function toCaptionDataUrl(transcript: string) {
  const captionText =
    transcript.trim() || "No saved transcript is available for this recording.";
  const vtt = `WEBVTT\n\n00:00:00.000 --> 99:59:59.000\n${captionText}\n`;
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(vtt)}`;
}

function isTwilioRecordingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.endsWith("twilio.com") &&
      /\/Recordings\/RE[a-fA-F0-9]{32}/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function withDownloadParam(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("download", "1");
    return parsed.toString();
  } catch {
    return url;
  }
}

function getRecordingMimeType(url: string): string {
  try {
    const parsed = new URL(url);
    const format = parsed.searchParams.get("format")?.toLowerCase();
    if (format === "wav" || parsed.pathname.toLowerCase().endsWith(".wav")) {
      return "audio/wav";
    }
  } catch {
    if (url.toLowerCase().endsWith(".wav")) return "audio/wav";
  }
  return "audio/mpeg";
}

function formatAudioElementError(error: MediaError | null): string {
  switch (error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "Audio playback was interrupted.";
    case MediaError.MEDIA_ERR_NETWORK:
      return "The browser could not load this recording from the voice server.";
    case MediaError.MEDIA_ERR_DECODE:
      return "The browser could not decode this recording.";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "This browser could not play the recording format.";
    default:
      return "The browser could not play this recording.";
  }
}

const ALL_STATUSES: Array<{ value: CallStatus | "all"; label: string }> = [
  { value: "all", label: "All Statuses" },
  { value: CallStatus.pending, label: "Pending" },
  { value: CallStatus.inProgress, label: "In Progress" },
  { value: CallStatus.completed, label: "Completed" },
  { value: CallStatus.failed, label: "Failed" },
];

export default function HistoryPage() {
  const navigate = useNavigate();
  const { data: calls, isLoading } = useListMyCalls();
  const { data: presets } = useListMyPresets();
  const { data: answeringPresets } = useListMyAnsweringPresets();

  const presetMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of presets ?? []) m.set(p.id.toString(), p.name);
    for (const p of answeringPresets ?? []) {
      m.set(
        (p.id + ANSWERING_PRESET_ID_OFFSET).toString(),
        `${p.name} (answering)`,
      );
    }
    return m;
  }, [presets, answeringPresets]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CallStatus | "all">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const fromMs = dateFrom ? new Date(dateFrom).getTime() : null;
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : null;
    return (calls ?? []).filter((c) => {
      if (
        search &&
        !c.recipientPhone.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      const callMs = Number(c.startTime / 1_000_000n);
      if (fromMs && callMs < fromMs) return false;
      if (toMs && callMs > toMs) return false;
      return true;
    });
  }, [calls, search, statusFilter, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const hasFilters = search || statusFilter !== "all" || dateFrom || dateTo;

  function resetFilters() {
    setSearch("");
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="p-6 space-y-6 max-w-screen-xl" data-ocid="history.page">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-bold text-foreground">
                Call History
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                All your outbound AI calls
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 self-start sm:self-auto"
              onClick={() => exportCsv(filtered, presetMap)}
              disabled={filtered.length === 0}
              data-ocid="history.export_button"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </Button>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by phone number…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                data-ocid="history.search_input"
                className="pl-9"
              />
            </div>

            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v as CallStatus | "all");
                setPage(1);
              }}
            >
              <SelectTrigger
                className="w-full sm:w-44"
                data-ocid="history.status.select"
              >
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                {ALL_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                aria-label="From date"
                data-ocid="history.date_from.input"
                className="w-36 text-sm"
              />
              <span className="text-muted-foreground text-xs shrink-0">to</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                aria-label="To date"
                data-ocid="history.date_to.input"
                className="w-36 text-sm"
              />
            </div>

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                data-ocid="history.clear_filters_button"
                className="gap-1.5 text-muted-foreground hover:text-foreground shrink-0"
              >
                <X className="w-3.5 h-3.5" />
                Clear
              </Button>
            )}
          </div>

          {/* Table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Table Header */}
            <div className="hidden sm:grid grid-cols-[1fr_140px_90px_120px_40px] gap-3 px-4 py-3 bg-muted/30 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <span>Recipient</span>
              <span>Date &amp; Time</span>
              <span className="text-right">Duration</span>
              <span className="text-right">Status</span>
              <span />
            </div>

            {isLoading ? (
              <div
                className="divide-y divide-border"
                data-ocid="history.loading_state"
              >
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_140px_90px_120px_40px] gap-3 px-4 py-4"
                  >
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-14 ml-auto" />
                    <Skeleton className="h-5 w-20 ml-auto" />
                    <Skeleton className="h-4 w-4" />
                  </div>
                ))}
              </div>
            ) : paginated.length === 0 ? (
              <EmptyState
                hasFilters={!!hasFilters}
                onReset={resetFilters}
                onMakeCall={() => navigate({ to: "/user/dashboard" })}
              />
            ) : (
              <div className="divide-y divide-border">
                {paginated.map((call: CallRecordPublic, idx) => (
                  <CallRow
                    key={call.id.toString()}
                    call={call}
                    idx={(currentPage - 1) * PAGE_SIZE + idx + 1}
                    presetName={presetMap.get(call.presetId.toString())}
                    expanded={expandedId === call.id.toString()}
                    onToggle={() =>
                      setExpandedId(
                        expandedId === call.id.toString()
                          ? null
                          : call.id.toString(),
                      )
                    }
                  />
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {!isLoading && totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                {Math.min(currentPage * PAGE_SIZE, filtered.length)} of{" "}
                {filtered.length} calls
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={currentPage === 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                  data-ocid="history.pagination_prev"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const pageNum =
                    Math.max(1, Math.min(totalPages - 4, currentPage - 2)) + i;
                  if (pageNum > totalPages) return null;
                  return (
                    <Button
                      key={pageNum}
                      variant={pageNum === currentPage ? "default" : "outline"}
                      size="icon"
                      className="h-8 w-8 text-xs"
                      onClick={() => setPage(pageNum)}
                      data-ocid={`history.page.${pageNum}`}
                    >
                      {pageNum}
                    </Button>
                  );
                })}
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={currentPage === totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                  data-ocid="history.pagination_next"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}

function CallRow({
  call,
  idx,
  presetName,
  expanded,
  onToggle,
}: {
  call: CallRecordPublic;
  idx: number;
  presetName?: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const artifacts = parseCallArtifacts(call.transcript);

  return (
    <div data-ocid={`history.call.item.${idx}`}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_140px_90px_120px_40px] gap-3 px-4 py-3.5 text-left hover:bg-muted/20 transition-smooth items-center"
      >
        {/* Recipient */}
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex-shrink-0 w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center">
            <Phone className="w-3.5 h-3.5 text-primary" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground font-mono truncate">
              {call.recipientPhone}
            </p>
            {presetName && (
              <p className="text-xs text-muted-foreground truncate hidden sm:block">
                {presetName}
              </p>
            )}
          </div>
        </div>
        {/* Date — hidden on mobile, shown inside expanded */}
        <span className="hidden sm:block text-xs text-muted-foreground w-[140px] truncate">
          {formatDateTime(call.startTime)}
        </span>
        {/* Duration */}
        <span className="hidden sm:block text-xs font-mono text-muted-foreground w-[90px] text-right">
          {formatDuration(call.startTime, call.endTime)}
        </span>
        {/* Status */}
        <div className="hidden sm:flex w-[120px] justify-end">
          <CallStatusBadge status={call.status} />
        </div>
        {/* Chevron */}
        <div className="flex items-center justify-end gap-2">
          {/* Mobile: status inline */}
          <div className="sm:hidden">
            <CallStatusBadge status={call.status} />
          </div>
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-5 pt-2 bg-muted/10 border-t border-border">
          {/* Mobile date/duration row */}
          <div className="flex items-center gap-4 mb-4 sm:hidden text-xs text-muted-foreground">
            <span>{formatDateTime(call.startTime)}</span>
            <span>·</span>
            <span className="font-mono">
              {formatDuration(call.startTime, call.endTime)}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs mb-4">
            <div>
              <p className="text-muted-foreground mb-1">Call SID</p>
              <p className="font-mono text-foreground break-all">
                {call.callSid ?? (
                  <span className="text-muted-foreground/60">—</span>
                )}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Preset</p>
              <p className="text-foreground">
                {presetName ?? (
                  <span className="font-mono text-muted-foreground/80">
                    ID: {call.presetId.toString()}
                  </span>
                )}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Call ID</p>
              <p className="font-mono text-foreground text-[10px] break-all">
                {call.id.toString()}
              </p>
            </div>
          </div>
          {artifacts.recordingUrl && (
            <RecordingArtifact
              recordingUrl={artifacts.recordingUrl}
              recordingSid={artifacts.recordingSid}
              callSid={call.callSid}
              transcript={artifacts.transcript}
            />
          )}
          {artifacts.recordingPending && (
            <p className="text-xs text-muted-foreground/70 mb-4">
              Recording requested. The recording link has not been returned yet.
            </p>
          )}
          {artifacts.transcript ? (
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Transcript
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() =>
                    downloadTextFile(
                      `voicecall-transcript-${call.id.toString()}.txt`,
                      artifacts.transcript,
                    )
                  }
                >
                  <Download className="w-3.5 h-3.5" />
                  Save text
                </Button>
              </div>
              <div className="bg-background rounded-lg border border-border p-4 max-h-48 overflow-y-auto">
                <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                  {artifacts.transcript}
                </p>
              </div>
            </div>
          ) : !artifacts.recordingUrl && !artifacts.recordingPending ? (
            <p className="text-xs text-muted-foreground/60 italic">
              No transcript available for this call.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function RecordingArtifact({
  recordingUrl,
  recordingSid,
  callSid,
  transcript,
}: {
  recordingUrl: string;
  recordingSid: string | null;
  callSid?: string | null;
  transcript: string;
}) {
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const captionSrc = useMemo(() => toCaptionDataUrl(transcript), [transcript]);

  useEffect(() => {
    let cancelled = false;
    const needsProxy = isTwilioRecordingUrl(recordingUrl);
    setError(null);

    if (!needsProxy) {
      setPlaybackUrl(recordingUrl);
      setIsResolving(false);
      return () => {
        cancelled = true;
      };
    }

    if (!recordingSid) {
      setPlaybackUrl(null);
      setIsResolving(false);
      setError(
        "This recording is missing the Twilio Recording SID needed for in-app playback.",
      );
      return () => {
        cancelled = true;
      };
    }

    setPlaybackUrl(null);
    setIsResolving(true);
    getRecordingAccessUrl({ recordingSid, callSid })
      .then((url) => {
        if (!cancelled) setPlaybackUrl(url);
      })
      .catch((err) => {
        if (!cancelled) {
          const message =
            err instanceof Error
              ? err.message
              : "Unable to prepare recording playback.";
          setError(message);
        }
      })
      .finally(() => {
        if (!cancelled) setIsResolving(false);
      });

    return () => {
      cancelled = true;
    };
  }, [callSid, recordingSid, recordingUrl]);

  const downloadUrl = playbackUrl ? withDownloadParam(playbackUrl) : null;

  function handleDownload() {
    if (!downloadUrl) return;
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = `voicecall-recording-${recordingSid ?? "audio"}.mp3`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-xs font-medium text-muted-foreground">
          Audio Recording
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={handleDownload}
          disabled={!downloadUrl || isResolving}
        >
          <Download className="w-3.5 h-3.5" />
          Save audio
        </Button>
      </div>
      {isResolving ? (
        <Skeleton className="h-9 w-full" />
      ) : playbackUrl ? (
        <audio
          key={playbackUrl}
          controls
          preload="metadata"
          className="w-full h-9"
          onError={(event) =>
            setError(formatAudioElementError(event.currentTarget.error))
          }
        >
          <source src={playbackUrl} type={getRecordingMimeType(playbackUrl)} />
          <track
            kind="captions"
            srcLang="en"
            label="Transcript"
            src={captionSrc}
            default
          />
        </audio>
      ) : (
        <p className="text-xs text-muted-foreground/70">
          {error ?? "Recording media is not available yet."}
        </p>
      )}
      {error && playbackUrl && (
        <p className="text-[10px] text-muted-foreground mt-1">{error}</p>
      )}
      {recordingSid && (
        <p className="text-[10px] text-muted-foreground mt-1 font-mono break-all">
          {recordingSid}
        </p>
      )}
    </div>
  );
}

function EmptyState({
  hasFilters,
  onReset,
  onMakeCall,
}: {
  hasFilters: boolean;
  onReset: () => void;
  onMakeCall: () => void;
}) {
  return (
    <div
      className="py-20 flex flex-col items-center justify-center text-center px-6"
      data-ocid="history.empty_state"
    >
      <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
        <Phone className="w-6 h-6 text-primary" />
      </div>
      <h3 className="font-display text-base font-semibold text-foreground mb-1">
        {hasFilters ? "No calls match your filters" : "No call history yet"}
      </h3>
      <p className="text-sm text-muted-foreground max-w-xs mb-6">
        {hasFilters
          ? "Try adjusting your search or filter criteria."
          : "Your call history will appear here once you make your first AI call."}
      </p>
      {hasFilters ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onReset}
          data-ocid="history.empty_state.clear_filters_button"
        >
          Clear Filters
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={onMakeCall}
          className="gap-2"
          data-ocid="history.empty_state.make_call_button"
        >
          <Phone className="w-3.5 h-3.5" />
          Make Your First Call
        </Button>
      )}
    </div>
  );
}
