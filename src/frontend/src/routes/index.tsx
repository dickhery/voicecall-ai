import { useAuth } from "@/hooks/use-auth";
import { useGetAdminConfig } from "@/hooks/use-backend";
import LoginPage from "@/pages/LoginPage";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute as any)("/")({ component: IndexRoute });

function IndexRoute() {
  const { isAuthenticated, isInitializing, isAdmin, isAdminLoading } =
    useAuth();
  const navigate = useNavigate();
  const configQuery = useGetAdminConfig();

  useEffect(() => {
    if (!isInitializing && isAuthenticated && !isAdminLoading) {
      void navigate({ to: isAdmin ? "/admin/dashboard" : "/user/dashboard" });
    }
  }, [isAuthenticated, isInitializing, isAdmin, isAdminLoading, navigate]);

  return (
    <LoginPage
      xaiConfigured={configQuery.data?.hasXaiKey}
      twilioConfigured={configQuery.data?.hasTwilioAuth}
      configLoading={configQuery.isLoading}
    />
  );
}
