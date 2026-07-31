"use client";

import { useState } from "react";
import Link from "next/link";
import { UserPlus, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { AssignManagerDialog } from "@/components/stores/assign-manager-dialog";
import { initials } from "@/lib/utils";

export function StoreManagerSection({
  storeId,
  storeName,
  manager,
}: {
  storeId: string;
  storeName: string;
  manager: { id: string; name: string; email: string } | null;
}) {
  const [assignOpen, setAssignOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle>Manager</CardTitle>
        <CardDescription>The person running this store day-to-day.</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {manager ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Avatar className="size-10">
                <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                  {initials(manager.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate font-medium">{manager.name}</p>
                <p className="truncate text-xs text-muted-foreground">{manager.email}</p>
              </div>
            </div>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href="/managers">
                Manage in Managers
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        ) : (
          <EmptyState
            icon={<UserPlus />}
            title="No manager assigned"
            description="This store needs a manager to operate."
            className="border-none py-8"
            action={
              <Button size="sm" onClick={() => setAssignOpen(true)}>
                Assign manager
              </Button>
            }
          />
        )}
      </CardContent>

      <AssignManagerDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        storeId={storeId}
        storeName={storeName}
      />
    </Card>
  );
}
