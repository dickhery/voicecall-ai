import { Variant_info_warn_error } from "@/backend";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminGetSystemLogs } from "@/hooks/use-backend";
import type { SystemLog } from "@/types";
import {
  AlertTriangle,
  Info,
  RefreshCw,
  ScrollText,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

const levelConfig: Record<
  Variant_info_warn_error,
  { label: string; icon: typeof Info; className: string }
> = {
  [Variant_info_warn_error.info]: {
    label: "Info",
    icon: Info,
    className: "bg-primary/10 text-primary border-primary/30",
  },
  [Variant_info_warn_error.warn]: {
    label: "Warn",
    icon: AlertTriangle,
    className: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  },
  [Variant_info_warn_error.error]: {
    label: "Error",
    icon: XCircle,
    className: "bg-destructive/10 text-destructive border-destructive/30",
  },
};

export default function AdminLogsPage() {
  const [limit, setLimit] = useState("50");
  const {
    data: logs,
    isLoading,
    refetch,
    dataUpdatedAt,
  } = useAdminGetSystemLogs(BigInt(limit));
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    timerRef.current = setInterval(() => {
      refetch();
      setLastRefresh(new Date());
    }, 30_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refetch]);

  // Track last refresh time when data updates
  useEffect(() => {
    if (dataUpdatedAt) setLastRefresh(new Date(dataUpdatedAt));
  }, [dataUpdatedAt]);

  const handleManualRefresh = () => {
    refetch();
    setLastRefresh(new Date());
    // Reset the timer on manual refresh
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      refetch();
      setLastRefresh(new Date());
    }, 30_000);
  };

  const filtered = (logs ?? []).filter((log: SystemLog) =>
    levelFilter === "all" ? true : log.level === levelFilter,
  );

  const errorCount = (logs ?? []).filter(
    (l: SystemLog) => l.level === Variant_info_warn_error.error,
  ).length;
  const warnCount = (logs ?? []).filter(
    (l: SystemLog) => l.level === Variant_info_warn_error.warn,
  ).length;

  return (
    <ProtectedRoute requireAdmin>
      <AppLayout>
        <div className="p-6 space-y-6" data-ocid="admin.logs.page">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold text-foreground">
                System Logs
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Backend activity and error tracking · auto-refreshes every 30s
              </p>
            </div>

            {/* Summary badges */}
            <div className="flex items-center gap-2 shrink-0">
              {errorCount > 0 && (
                <Badge
                  variant="outline"
                  className="bg-destructive/10 text-destructive border-destructive/30 text-xs"
                >
                  <XCircle className="w-3 h-3 mr-1" />
                  {errorCount} error{errorCount !== 1 ? "s" : ""}
                </Badge>
              )}
              {warnCount > 0 && (
                <Badge
                  variant="outline"
                  className="bg-yellow-500/10 text-yellow-400 border-yellow-500/30 text-xs"
                >
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  {warnCount} warn{warnCount !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger
                className="w-32 h-8 text-xs"
                data-ocid="admin.logs.level_filter.select"
              >
                <SelectValue placeholder="All levels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                <SelectItem value={Variant_info_warn_error.info}>
                  Info
                </SelectItem>
                <SelectItem value={Variant_info_warn_error.warn}>
                  Warn
                </SelectItem>
                <SelectItem value={Variant_info_warn_error.error}>
                  Error
                </SelectItem>
              </SelectContent>
            </Select>
            <Select value={limit} onValueChange={setLimit}>
              <SelectTrigger
                className="w-24 h-8 text-xs"
                data-ocid="admin.logs.limit.select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="200">200</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={handleManualRefresh}
              aria-label="Refresh logs"
              data-ocid="admin.logs.refresh_button"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
            <span className="text-xs text-muted-foreground ml-1">
              Last refresh: {lastRefresh.toLocaleTimeString()}
            </span>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[7rem_1fr_11rem] gap-4 px-4 py-3 bg-muted/30 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <span>Level</span>
              <span>Message</span>
              <span className="text-right">Timestamp</span>
            </div>

            {isLoading ? (
              <div className="divide-y divide-border">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[7rem_1fr_11rem] gap-4 px-4 py-3"
                  >
                    <Skeleton className="h-5 w-14" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-36 ml-auto" />
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div
                className="flex flex-col items-center py-16"
                data-ocid="admin.logs.empty_state"
              >
                <ScrollText className="w-8 h-8 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">No logs found</p>
                {levelFilter !== "all" && (
                  <button
                    type="button"
                    className="mt-2 text-xs text-primary hover:underline"
                    onClick={() => setLevelFilter("all")}
                  >
                    Clear filter
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
                {filtered.map((log: SystemLog, idx) => {
                  const cfg = levelConfig[log.level];
                  const LevelIcon = cfg.icon;
                  const logKey = `${log.timestamp.toString()}-${idx}`;
                  return (
                    <div
                      key={logKey}
                      data-ocid={`admin.log.item.${idx + 1}`}
                      className="grid grid-cols-[7rem_1fr_11rem] gap-4 px-4 py-3 items-start hover:bg-muted/10 transition-colors"
                    >
                      <Badge
                        variant="outline"
                        className={`text-xs w-16 justify-center ${cfg.className}`}
                      >
                        <LevelIcon className="w-3 h-3 mr-1" />
                        {cfg.label}
                      </Badge>
                      <div className="min-w-0">
                        <p className="text-xs font-mono text-foreground leading-relaxed break-all">
                          {log.message}
                        </p>
                        {log.callId !== undefined && (
                          <p className="mt-0.5 text-xs text-muted-foreground font-mono">
                            call:{log.callId.toString()}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground font-mono text-right">
                        {new Date(
                          Number(log.timestamp / 1_000_000n),
                        ).toLocaleString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer count */}
          {!isLoading && filtered.length > 0 && (
            <p className="text-xs text-muted-foreground text-right">
              Showing {filtered.length} of {logs?.length ?? 0} log entries
            </p>
          )}
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
