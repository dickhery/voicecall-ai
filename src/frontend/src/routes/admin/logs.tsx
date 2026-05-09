import AdminLogsPage from "@/pages/admin/AdminLogsPage";
import { createFileRoute } from "@tanstack/react-router";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute as any)("/admin/logs")({
  component: AdminLogsPage,
});
