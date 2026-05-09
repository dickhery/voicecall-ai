import AdminUsersPage from "@/pages/admin/AdminUsersPage";
import { createFileRoute } from "@tanstack/react-router";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute as any)("/admin/users")({
  component: AdminUsersPage,
});
