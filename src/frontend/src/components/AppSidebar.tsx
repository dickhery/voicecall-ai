import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useCallStore } from "@/stores/call-store";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  LogOut,
  Mic,
  Phone,
  PhoneCall,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";

const userNav = [
  { label: "Dashboard", href: "/user/dashboard", icon: LayoutDashboard },
  { label: "AI Answering", href: "/user/answering", icon: PhoneCall },
  { label: "Call History", href: "/user/history", icon: Phone },
  { label: "Settings", href: "/user/settings", icon: Settings },
];

const adminNav = [
  { label: "Admin Dashboard", href: "/admin/dashboard", icon: ShieldCheck },
  { label: "Users", href: "/admin/users", icon: Users },
  { label: "System Logs", href: "/admin/logs", icon: ScrollText },
];

export function AppSidebar({ onClose }: { onClose?: () => void }) {
  const { isAdmin, logout } = useAuth();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const { activeCallId, callStatus, recipient } = useCallStore();

  const isActive = (href: string) => currentPath === href;

  return (
    <aside className="flex flex-col h-full bg-sidebar border-r border-sidebar-border">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 border border-primary/30">
          <Mic className="w-5 h-5 text-primary" />
        </div>
        <span className="font-display font-semibold text-lg text-sidebar-foreground tracking-tight">
          VoiceCall AI
        </span>
      </div>

      <Separator className="bg-sidebar-border" />

      {/* Active call indicator */}
      {activeCallId && (
        <div
          className="mx-3 my-3 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 flex items-center gap-2"
          data-ocid="active-call.status"
        >
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse-soft" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-primary truncate">
              Active Call
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {recipient}
            </p>
          </div>
          <Badge
            variant="outline"
            className="ml-auto text-xs border-primary/30 text-primary shrink-0"
          >
            {callStatus}
          </Badge>
        </div>
      )}

      {/* User navigation */}
      <nav className="flex-1 px-3 py-2 space-y-1" data-ocid="sidebar.nav">
        {userNav.map(({ label, href, icon: Icon }) => (
          <Link
            key={href}
            to={href}
            onClick={onClose}
            data-ocid={`nav.${label.toLowerCase().replace(/\s+/g, "-")}.link`}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-smooth",
              isActive(href)
                ? "bg-sidebar-primary/15 text-sidebar-primary"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon
              className={cn(
                "w-4 h-4 shrink-0",
                isActive(href) ? "text-primary" : "",
              )}
            />
            {label}
          </Link>
        ))}

        {/* Admin section */}
        {isAdmin && (
          <>
            <div className="pt-4 pb-1 px-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                Admin
              </p>
            </div>
            {adminNav.map(({ label, href, icon: Icon }) => (
              <Link
                key={href}
                to={href}
                onClick={onClose}
                data-ocid={`nav.admin.${label.toLowerCase().replace(/\s+/g, "-")}.link`}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-smooth",
                  isActive(href)
                    ? "bg-sidebar-primary/15 text-sidebar-primary"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "w-4 h-4 shrink-0",
                    isActive(href) ? "text-primary" : "",
                  )}
                />
                {label}
              </Link>
            ))}
          </>
        )}
      </nav>

      <Separator className="bg-sidebar-border" />

      {/* Logout */}
      <div className="p-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={logout}
          data-ocid="sidebar.logout_button"
          className="w-full justify-start gap-3 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </Button>
      </div>

      <div className="px-5 py-3">
        <p className="text-xs text-muted-foreground/50">
          © {new Date().getFullYear()}.{" "}
          <a
            href="https://richardhery.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary transition-colors"
          >
            richardhery.com
          </a>
        </p>
      </div>
    </aside>
  );
}
