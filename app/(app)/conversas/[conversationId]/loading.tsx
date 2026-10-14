import { ConversationPanelSkeleton } from "@/components/conversations/conversations-skeletons";

/** Aparece na hora ao trocar de conversa; a lista (no layout) continua na tela. */
export default function ConversationLoading() {
  return <ConversationPanelSkeleton />;
}
