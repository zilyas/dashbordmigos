"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Check, CheckCheck, Loader2, MessageCircle, Send, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { cn, initials } from "@/lib/utils";
import { formatChatTimestamp } from "@/lib/format";
import { conversationLabel } from "@/lib/messages-format";
import type { ConversationSummary, MessageItem, ParticipantSummary } from "@/actions/messages";

export function ThreadView({
  conversation,
  messages,
  participants,
  currentUserId,
  onSend,
  isSending,
  onBack,
}: {
  conversation: ConversationSummary | null;
  messages: MessageItem[];
  participants: ParticipantSummary[];
  currentUserId: string;
  onSend: (body: string) => void;
  isSending: boolean;
  /** Present only in the mobile single-pane layout — renders a back button that returns to the conversation list. */
  onBack?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  if (!conversation) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState icon={<MessageCircle />} title="Select a conversation" className="border-none py-6" />
      </div>
    );
  }

  const label = conversationLabel(conversation, currentUserId);
  const other = conversation.participants.find((p) => p.id !== currentUserId);

  const lastOwnMessage = [...messages].reverse().find((m) => m.senderId === currentUserId);
  const seenByOthers =
    lastOwnMessage &&
    participants.some(
      (p) =>
        p.userId !== currentUserId &&
        p.lastReadAt &&
        new Date(p.lastReadAt).getTime() >= new Date(lastOwnMessage.createdAt).getTime()
    );

  function handleSubmit() {
    const body = draft.trim();
    if (!body || isSending) return;
    onSend(body);
    setDraft("");
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-3 sm:gap-3 sm:px-4">
        {onBack && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="-ml-1 shrink-0"
            onClick={onBack}
            aria-label="Back to conversations"
          >
            <ChevronLeft className="size-4" />
          </Button>
        )}
        <Avatar className="size-8">
          {other?.avatar && <AvatarImage src={other.avatar} alt={label} />}
          <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
            {conversation.isGroup ? <Users className="size-4" /> : initials(label)}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="text-sm font-medium">{label}</p>
          {conversation.isGroup && (
            <p className="text-xs text-muted-foreground">{conversation.participants.length} members</p>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <EmptyState icon={<MessageCircle />} title="No messages yet — say hello" className="border-none py-10" />
        ) : (
          messages.map((message, i) => {
            const isOwn = message.senderId === currentUserId;
            const showSender = conversation.isGroup && !isOwn && messages[i - 1]?.senderId !== message.senderId;
            return (
              <div key={message.id} className={cn("flex flex-col", isOwn ? "items-end" : "items-start")}>
                {showSender && (
                  <span className="mb-1 px-1 text-xs font-medium text-muted-foreground">
                    {message.sender.name}
                  </span>
                )}
                <div
                  className={cn(
                    "max-w-[70%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words",
                    isOwn ? "bg-primary text-primary-foreground" : "bg-muted"
                  )}
                >
                  {message.body}
                </div>
                <span className="mt-1 px-1 text-[11px] text-muted-foreground">
                  {formatChatTimestamp(message.createdAt)}
                </span>
              </div>
            );
          })
        )}
        {lastOwnMessage && (
          <div className="flex items-center justify-end gap-1 px-1 text-[11px] text-muted-foreground">
            {seenByOthers ? (
              <>
                <CheckCheck className="size-3.5 text-primary" />
                Seen
              </>
            ) : (
              <>
                <Check className="size-3.5" />
                Sent
              </>
            )}
          </div>
        )}
      </div>

      <div className="safe-bottom flex items-end gap-2 border-t p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Write a message..."
          className="max-h-32 min-h-10 flex-1 resize-none"
          rows={1}
        />
        <Button size="icon" onClick={handleSubmit} disabled={isSending || !draft.trim()}>
          {isSending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
