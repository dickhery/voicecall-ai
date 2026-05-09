import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CallStatus } from "@/types";

const statusConfig: Record<CallStatus, { label: string; className: string }> = {
  pending: {
    label: "Pending",
    className: "bg-muted/60 text-muted-foreground border-border",
  },
  inProgress: {
    label: "In Progress",
    className: "bg-primary/10 text-primary border-primary/30",
  },
  completed: {
    label: "Completed",
    className: "bg-green-500/10 text-green-400 border-green-500/30",
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/10 text-destructive border-destructive/30",
  },
};

export function CallStatusBadge({ status }: { status: CallStatus }) {
  const config = statusConfig[status] ?? statusConfig.pending;
  return (
    <Badge
      variant="outline"
      className={cn("text-xs font-medium", config.className)}
    >
      {config.label}
    </Badge>
  );
}
