import { useAuth } from "@/hooks/use-auth";
import { getVoiceServerHealth } from "@/lib/voice-server";
import LoginPage from "@/pages/LoginPage";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute as any)("/")({ component: IndexRoute });

function IndexRoute() {
  const { isAuthenticated, isInitializing, isAdmin, isAdminLoading } =
    useAuth();
  const navigate = useNavigate();
  const voiceServerQuery = useQuery({
    queryKey: ["voiceServerHealth"],
    queryFn: getVoiceServerHealth,
    retry: false,
  });

  useEffect(() => {
    if (!isInitializing && isAuthenticated && !isAdminLoading) {
      void navigate({ to: isAdmin ? "/admin/dashboard" : "/user/dashboard" });
    }
  }, [isAuthenticated, isInitializing, isAdmin, isAdminLoading, navigate]);

  return (
    <LoginPage
      xaiConfigured={voiceServerQuery.data?.xaiConfigured ?? false}
      twilioConfigured={voiceServerQuery.data?.twilioConfigured ?? false}
      configLoading={voiceServerQuery.isLoading}
    />
  );
}
