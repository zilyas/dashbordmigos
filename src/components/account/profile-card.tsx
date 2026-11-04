import { getTranslations } from "next-intl/server";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { roleLabel } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import { initials } from "@/lib/utils";
import type { Role } from "@/generated/prisma/enums";
import type { AppLocale } from "@/i18n/messages";

export async function ProfileCard({
  name,
  email,
  role,
  storeName,
  avatar,
  createdAt,
  lastLogin,
  locale,
}: {
  name: string;
  email: string;
  role: Role;
  storeName: string | null;
  avatar: string | null;
  createdAt: Date;
  lastLogin: Date | null;
  locale: AppLocale;
}) {
  const t = await getTranslations({ locale, namespace: "labels" });
  const tProfile = await getTranslations({ locale, namespace: "account.profile" });
  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle>{tProfile("title")}</CardTitle>
        <CardDescription>{tProfile("description")}</CardDescription>
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
            <p className="text-xs text-muted-foreground">{tProfile("role")}</p>
            <StatusBadge variant="info" className="mt-1">
              {roleLabel(t, role)}
            </StatusBadge>
          </div>
          {storeName && (
            <div>
              <p className="text-xs text-muted-foreground">{tProfile("store")}</p>
              <p className="mt-1 font-medium">{storeName}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground">{tProfile("memberSince")}</p>
            <p className="mt-1 font-medium">{formatDateTime(createdAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{tProfile("lastLogin")}</p>
            <p className="mt-1 font-medium">{lastLogin ? formatDateTime(lastLogin) : "—"}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
