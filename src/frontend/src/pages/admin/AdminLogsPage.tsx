import { Variant_info_warn_error } from "@/backend";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Badge } from "@/components/ui/badge";
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
import { useAdminGetSystemLogs } from "@/hooks/use-backend";
import type { SystemLog } from "@/types";
import {
  AlertTriangle,
  Info,
  RefreshCw,
  ScrollText,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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
  const [search, setSearch] = useState("");
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

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (logs ?? []).filter((log: SystemLog) => {
      if (levelFilter !== "all" && log.level !== levelFilter) return false;
      if (!query) return true;
      const timestamp = new Date(
        Number(log.timestamp / 1_000_000n),
      ).toLocaleString();
      return [
        log.message,
        levelConfig[log.level].label,
        log.callId?.toString() ?? "",
        timestamp,
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [logs, levelFilter, search]);

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
            <div className="relative flex-1 min-w-[min(100%,18rem)]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search logs..."
                className="h-8 pl-8 pr-8 text-xs"
                data-ocid="admin.logs.search_input"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear log search"
                  data-ocid="admin.logs.clear_search_button"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
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
            {(search || levelFilter !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => {
                  setSearch("");
                  setLevelFilter("all");
                }}
                data-ocid="admin.logs.clear_filters_button"
              >
                Clear
              </Button>
            )}
            <span className="text-xs text-muted-foreground ml-1">
              Last refresh: {lastRefresh.toLocaleTimeString()}
            </span>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[5.75rem_minmax(0,1fr)_8.5rem] gap-3 px-3 py-2 bg-muted/30 border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              <span>Level</span>
              <span>Message</span>
              <span className="text-right">Timestamp</span>
            </div>

            {isLoading ? (
              <div className="divide-y divide-border">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[5.75rem_minmax(0,1fr)_8.5rem] gap-3 px-3 py-2"
                  >
                    <Skeleton className="h-5 w-14" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-28 ml-auto" />
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
                {(levelFilter !== "all" || search) && (
                  <button
                    type="button"
                    className="mt-2 text-xs text-primary hover:underline"
                    onClick={() => {
                      setLevelFilter("all");
                      setSearch("");
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border max-h-[560px] overflow-y-auto">
                {filtered.map((log: SystemLog, idx) => {
                  const cfg = levelConfig[log.level];
                  const LevelIcon = cfg.icon;
                  const logKey = `${log.timestamp.toString()}-${idx}`;
                  const timestamp = new Date(
                    Number(log.timestamp / 1_000_000n),
                  ).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  return (
                    <div
                      key={logKey}
                      data-ocid={`admin.log.item.${idx + 1}`}
                      className="grid grid-cols-[5.75rem_minmax(0,1fr)_8.5rem] gap-3 px-3 py-2 items-start hover:bg-muted/10 transition-colors"
                    >
                      <Badge
                        variant="outline"
                        className={`h-5 text-[11px] w-14 justify-center ${cfg.className}`}
                      >
                        <LevelIcon className="w-3 h-3 mr-1" />
                        {cfg.label}
                      </Badge>
                      <div className="min-w-0">
                        <p
                          className="text-xs font-mono text-foreground leading-snug line-clamp-2 [overflow-wrap:anywhere]"
                          title={log.message}
                        >
                          {log.message}
                        </p>
                        {log.callId !== undefined && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground font-mono">
                            call:{log.callId.toString()}
                          </p>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground font-mono text-right">
                        {timestamp}
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
