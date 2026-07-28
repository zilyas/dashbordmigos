"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Building2, Loader2, ShieldCheck, Store } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/labels";
import { startDirectConversation, startGroupConversation, type BroadcastTarget } from "@/actions/messages";
import type { MessageableUser } from "@/lib/messaging-permissions";

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function NewConversationDialog({
  open,
  onOpenChange,
  messageableUsers,
  currentUserStoreId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageableUsers: MessageableUser[];
  currentUserStoreId: string | null;
  onCreated: (conversationId: string) => void;
}) {
  const [groupMode, setGroupMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const managers = messageableUsers.filter((u) => u.role === "MANAGER");
  const sellers = messageableUsers.filter((u) => u.role === "SELLER");
  // "Entire store" only makes sense from a Manager/Seller's own-store
  // perspective — a Super Admin has no single "their store" to broadcast to.
  const storeMates = currentUserStoreId
    ? messageableUsers.filter((u) => u.storeId === currentUserStoreId)
    : [];

  function reset() {
    setGroupMode(false);
    setSelected(new Set());
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleDirect(userId: string) {
    startTransition(async () => {
      const result = await startDirectConversation(userId);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      if (result?.conversationId) onCreated(result.conversationId);
    });
  }

  function handleBroadcast(target: BroadcastTarget, title: string) {
    startTransition(async () => {
      const result = await startGroupConversation({ target, title });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      if (result?.conversationId) onCreated(result.conversationId);
    });
  }

  function toggleSelected(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function handleStartGroup() {
    if (selected.size === 0) return;
    startTransition(async () => {
      const result = await startGroupConversation({ target: "selected", selectedUserIds: Array.from(selected) });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      if (result?.conversationId) onCreated(result.conversationId);
    });
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="New message"
      description="Start a direct message or a group conversation"
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {groupMode ? `${selected.size} selected` : "Select a person to message"}
        </span>
        <div className="flex items-center gap-2">
          {groupMode && (
            <Button size="sm" disabled={selected.size === 0 || isPending} onClick={handleStartGroup}>
              {isPending && <Loader2 className="size-3.5 animate-spin" />}
              Start group
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setGroupMode((v) => !v)}>
            {groupMode ? "Cancel" : "New group"}
          </Button>
        </div>
      </div>
      <CommandInput placeholder="Search people..." />
      <CommandList>
        <CommandEmpty>No one found.</CommandEmpty>

        {!groupMode && (
          <>
            <CommandGroup heading="Broadcast">
              {storeMates.length > 0 && (
                <CommandItem onSelect={() => handleBroadcast("store", "Entire store")} disabled={isPending}>
                  <Store className="size-4" />
                  Entire store ({storeMates.length})
                </CommandItem>
              )}
              {managers.length > 0 && (
                <CommandItem onSelect={() => handleBroadcast("managers", "All managers")} disabled={isPending}>
                  <ShieldCheck className="size-4" />
                  All managers ({managers.length})
                </CommandItem>
              )}
              {sellers.length > 0 && (
                <CommandItem onSelect={() => handleBroadcast("sellers", "All sellers")} disabled={isPending}>
                  <Building2 className="size-4" />
                  All sellers ({sellers.length})
                </CommandItem>
              )}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading={groupMode ? "Select people" : "People"}>
          {messageableUsers.map((user) => (
            <CommandItem
              key={user.id}
              value={user.name}
              onSelect={() => (groupMode ? toggleSelected(user.id) : handleDirect(user.id))}
              disabled={isPending}
            >
              {groupMode && (
                <Checkbox
                  checked={selected.has(user.id)}
                  onCheckedChange={() => toggleSelected(user.id)}
                  className="mr-1"
                />
              )}
              <Avatar className="size-6">
                {user.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
                <AvatarFallback className="bg-primary/10 text-[10px] font-medium text-primary">
                  {initials(user.name)}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1">{user.name}</span>
              <span className="text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
