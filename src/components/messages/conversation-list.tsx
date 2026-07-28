"use client";

import { Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { formatChatTimestamp } from "@/lib/format";
import { conversationLabel } from "@/lib/messages-format";
import type { ConversationSummary } from "@/actions/messages";

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ConversationList({
  conversations,
  currentUserId,
  selectedId,
  onSelect,
}: {
  conversations: ConversationSummary[];
  currentUserId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (conversations.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <EmptyState icon={<Users />} title="No conversations yet" className="border-none py-6" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {conversations.map((conversation) => {
        const label = conversationLabel(conversation, currentUserId);
        const other = conversation.participants.find((p) => p.id !== currentUserId);
        const isSelected = conversation.id === selectedId;
        const lastMessage = conversation.lastMessage;
        const isOwnLastMessage = lastMessage?.senderId === currentUserId;

        return (
          <button
            key={conversation.id}
            type="button"
            onClick={() => onSelect(conversation.id)}
            className={cn(
              "flex items-start gap-3 border-b px-3 py-3 text-left transition-colors hover:bg-accent",
              isSelected && "bg-accent"
            )}
          >
            <Avatar className="size-9 shrink-0">
              {other?.avatar && <AvatarImage src={other.avatar} alt={label} />}
              <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                {conversation.isGroup ? <Users className="size-4" /> : initials(label)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{label}</span>
                {lastMessage && (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {formatChatTimestamp(lastMessage.createdAt)}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-muted-foreground">
                  {lastMessage ? `${isOwnLastMessage ? "You: " : ""}${lastMessage.body}` : "No messages yet"}
                </span>
                {conversation.unreadCount > 0 && (
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                    {conversation.unreadCount > 9 ? "9+" : conversation.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
