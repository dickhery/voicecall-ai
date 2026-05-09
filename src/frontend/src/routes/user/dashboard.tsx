import DashboardPage from "@/pages/user/DashboardPage";
import { createFileRoute } from "@tanstack/react-router";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute as any)("/user/dashboard")({
  component: DashboardPage,
});
