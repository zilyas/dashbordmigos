import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { ROLE_LABELS } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import type { Role } from "@/generated/prisma/enums";

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ProfileCard({
  name,
  email,
  role,
  storeName,
  avatar,
  createdAt,
  lastLogin,
}: {
  name: string;
  email: string;
  role: Role;
  storeName: string | null;
  avatar: string | null;
  createdAt: Date;
  lastLogin: Date | null;
}) {
  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your account details.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 pt-4">
        <div className="flex items-center gap-4">
          <Avatar className="size-14">
            {avatar && <AvatarImage src={avatar} alt={name} />}
            <AvatarFallback className="bg-primary/10 text-base font-medium text-primary">
              {initials(name)}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-base font-semibold">{name}</p>
            <p className="text-sm text-muted-foreground">{email}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Role</p>
            <StatusBadge variant="info" className="mt-1">
              {ROLE_LABELS[role]}
            </StatusBadge>
          </div>
          {storeName && (
            <div>
              <p className="text-xs text-muted-foreground">Store</p>
              <p className="mt-1 font-medium">{storeName}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground">Member since</p>
            <p className="mt-1 font-medium">{formatDateTime(createdAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Last login</p>
            <p className="mt-1 font-medium">{lastLogin ? formatDateTime(lastLogin) : "—"}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
