import HistoryPage from "@/pages/user/HistoryPage";
import { createFileRoute } from "@tanstack/react-router";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute as any)("/user/history")({
  component: HistoryPage,
});
