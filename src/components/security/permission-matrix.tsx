import { Check, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_PERMISSIONS } from "@/lib/rbac";
import { ROLE_LABELS } from "@/lib/labels";
import type { Role } from "@/generated/prisma/enums";

const ROLES: Role[] = ["SUPER_ADMIN", "MANAGER", "SELLER"];

export function PermissionMatrix() {
  const permissions = Array.from(new Set(Object.values(ROLE_PERMISSIONS).flat())).sort();

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle>Permission matrix</CardTitle>
        <CardDescription>Read-only view of what each role is allowed to do, straight from the RBAC config.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto pt-4">
        <table className="w-full min-w-[480px] border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Permission</th>
              {ROLES.map((role) => (
                <th key={role} className="px-2 py-2 text-center font-medium">
                  {ROLE_LABELS[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {permissions.map((permission) => (
              <tr key={permission}>
                <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{permission}</td>
                {ROLES.map((role) => (
                  <td key={role} className="px-2 py-2 text-center">
                    {ROLE_PERMISSIONS[role].includes(permission) ? (
                      <Check className="mx-auto size-4 text-success" />
                    ) : (
                      <X className="mx-auto size-4 text-muted-foreground/30" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
