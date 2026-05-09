import { UserRole } from "@/backend";
import { AppLayout } from "@/components/AppLayout";
import { CallStatusBadge } from "@/components/CallStatusBadge";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAdminListAllCalls,
  useAdminListUserCalls,
  useAssignUserRole,
} from "@/hooks/use-backend";
import type { CallRecordPublic } from "@/types";
import { Principal } from "@icp-sdk/core/principal";
import {
  ArrowLeft,
  Loader2,
  Phone,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type UserEntry = {
  principalId: string;
  callCount: number;
};

function buildUserList(calls: CallRecordPublic[]): UserEntry[] {
  const counts = new Map<string, number>();
  for (const call of calls) {
    const key = call.userId.toString();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([principalId, callCount]) => ({ principalId, callCount }))
    .sort((a, b) => b.callCount - a.callCount);
}

function UserCallHistory({
  userId,
  onBack,
}: {
  userId: string;
  onBack: () => void;
}) {
  let principal: Principal | null = null;
  try {
    principal = Principal.fromText(userId);
  } catch {
    principal = null;
  }
  const { data: calls, isLoading } = useAdminListUserCalls(principal);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          data-ocid="admin.users.back_button"
          className="h-8 w-8"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">
            Call History
          </h2>
          <p className="text-xs text-muted-foreground font-mono truncate">
            {userId}
          </p>
        </div>
      </div>

      <Card className="bg-card border-border" data-ocid="admin.user_calls.card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Phone className="w-4 h-4 text-primary" />
            Calls
          </CardTitle>
          <CardDescription className="text-xs">
            {isLoading ? "Loading..." : `${calls?.length ?? 0} calls`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !calls || calls.length === 0 ? (
            <div
              className="text-center py-8 text-sm text-muted-foreground"
              data-ocid="admin.user_calls.empty_state"
            >
              No calls found for this user.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {calls.map((call, idx) => (
                <div
                  key={call.id.toString()}
                  data-ocid={`admin.user_call.item.${idx + 1}`}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono font-medium truncate">
                      {call.recipientPhone}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(
                        Number(call.startTime / 1_000_000n),
                      ).toLocaleString()}
                    </p>
                  </div>
                  <CallStatusBadge status={call.status} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminUsersPage() {
  const [principalInput, setPrincipalInput] = useState("");
  const [role, setRole] = useState<UserRole>(UserRole.user);
  const assignRole = useAssignUserRole();
  const { data: allCalls, isLoading: callsLoading } = useAdminListAllCalls();
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  const userList = useMemo(() => buildUserList(allCalls ?? []), [allCalls]);

  const handleAssign = async () => {
    if (!principalInput.trim()) {
      toast.error("Enter a principal ID");
      return;
    }
    try {
      const principal = Principal.fromText(principalInput.trim());
      await assignRole.mutateAsync({ user: principal, role });
      toast.success(`Role '${role}' assigned successfully`);
      setPrincipalInput("");
    } catch {
      toast.error("Invalid principal ID format");
    }
  };

  if (selectedUser) {
    return (
      <ProtectedRoute requireAdmin>
        <AppLayout>
          <div className="p-6" data-ocid="admin.users.page">
            <UserCallHistory
              userId={selectedUser}
              onBack={() => setSelectedUser(null)}
            />
          </div>
        </AppLayout>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute requireAdmin>
      <AppLayout>
        <div className="p-6 space-y-6" data-ocid="admin.users.page">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">
              User Management
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              View all users, call counts, and assign roles
            </p>
          </div>

          {/* User List */}
          <Card
            className="bg-card border-border"
            data-ocid="admin.users_list.card"
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                All Users
              </CardTitle>
              <CardDescription>
                {callsLoading
                  ? "Loading..."
                  : `${userList.length} user${userList.length !== 1 ? "s" : ""} found`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {callsLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : userList.length === 0 ? (
                <div
                  className="text-center py-10 text-sm text-muted-foreground"
                  data-ocid="admin.users_list.empty_state"
                >
                  No users have made calls yet.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {userList.map((entry, idx) => (
                    <button
                      type="button"
                      key={entry.principalId}
                      data-ocid={`admin.user.item.${idx + 1}`}
                      onClick={() => setSelectedUser(entry.principalId)}
                      className="w-full flex items-center gap-3 py-3 first:pt-0 last:pb-0 hover:bg-muted/20 -mx-1 px-1 rounded-lg transition-colors text-left"
                    >
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-mono text-foreground truncate">
                          {entry.principalId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {entry.callCount} call
                          {entry.callCount !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className="text-xs shrink-0 bg-primary/10 text-primary border-primary/30"
                      >
                        {entry.callCount}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Assign role */}
          <Card
            className="bg-card border-border"
            data-ocid="admin.assign_role.card"
          >
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                Assign Role
              </CardTitle>
              <CardDescription>
                Grant or revoke access by entering a user's Internet Identity
                principal.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label
                  htmlFor="principal"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Principal ID
                </Label>
                <Input
                  id="principal"
                  placeholder="aaaaa-aa..."
                  value={principalInput}
                  onChange={(e) => setPrincipalInput(e.target.value)}
                  data-ocid="admin.users.principal.input"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Role
                </Label>
                <Select
                  value={role}
                  onValueChange={(v) => setRole(v as UserRole)}
                >
                  <SelectTrigger data-ocid="admin.users.role.select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UserRole.admin}>
                      <span className="flex items-center gap-2">
                        <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                        Admin
                      </span>
                    </SelectItem>
                    <SelectItem value={UserRole.user}>
                      <span className="flex items-center gap-2">
                        <User className="w-3.5 h-3.5" />
                        User
                      </span>
                    </SelectItem>
                    <SelectItem value={UserRole.guest}>
                      <span className="flex items-center gap-2">
                        <User className="w-3.5 h-3.5 opacity-50" />
                        Guest
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleAssign}
                disabled={assignRole.isPending}
                data-ocid="admin.users.assign_button"
                className="w-full gap-2"
              >
                {assignRole.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : null}
                {assignRole.isPending ? "Assigning..." : "Assign Role"}
              </Button>
            </CardContent>
          </Card>

          <div className="rounded-xl border border-border bg-muted/20 p-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">How it works:</strong> The
              first user to log in automatically becomes admin. Use this panel
              to promote other users to admin or demote them to user/guest
              roles. Click any user row above to view their full call history.
            </p>
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
