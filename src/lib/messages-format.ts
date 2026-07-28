import type { ConversationSummary } from "@/actions/messages";

export function conversationLabel(conversation: ConversationSummary, currentUserId: string): string {
  if (conversation.title) return conversation.title;
  const others = conversation.participants.filter((p) => p.id !== currentUserId);
  if (others.length === 0) return "You";
  return others.map((p) => p.name).join(", ");
}
