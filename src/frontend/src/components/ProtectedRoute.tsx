import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export function ProtectedRoute({
  children,
  requireAdmin = false,
}: ProtectedRouteProps) {
  const { isAuthenticated, isInitializing, isAdmin, isAdminLoading } =
    useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isInitializing || isAdminLoading) return;
    if (!isAuthenticated) {
      navigate({ to: "/" });
      return;
    }
    if (requireAdmin && !isAdmin) {
      navigate({ to: "/user/dashboard" });
    }
  }, [
    isAuthenticated,
    isInitializing,
    isAdmin,
    isAdminLoading,
    requireAdmin,
    navigate,
  ]);

  if (isInitializing || isAdminLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="space-y-3 w-64">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;
  if (requireAdmin && !isAdmin) return null;

  return <>{children}</>;
}
