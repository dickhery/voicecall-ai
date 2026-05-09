import AdminDashboardPage from "@/pages/admin/AdminDashboardPage";
import { createFileRoute } from "@tanstack/react-router";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute as any)("/admin/dashboard")({
  component: AdminDashboardPage,
});
