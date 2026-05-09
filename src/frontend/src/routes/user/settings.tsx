import SettingsPage from "@/pages/user/SettingsPage";
import { createFileRoute } from "@tanstack/react-router";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute as any)("/user/settings")({
  component: SettingsPage,
});
