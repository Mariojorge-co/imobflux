import Link from "next/link";
import { PageContainer, PageHeader } from "@/components/ui";
import { GroupsVisibilityManager, type GroupRow } from "@/components/conversations/groups-visibility-manager";
import { requireOwnerAccess } from "@/lib/auth/dal";
import { getConversationsInbox, type ConversationsCursor } from "@/lib/conversations/data";
import { getWhatsappChannelStatus } from "@/lib/whatsapp/data";

export const dynamic = "force-dynamic";

const PAGE = 100;
const MAX_PAGES = 5;

// Só o proprietário: decide, grupo por grupo, o que a equipe pode ver.
export default async function GroupsSettingsPage() {
  await requireOwnerAccess();
  const channel = await getWhatsappChannelStatus();

  const groups: GroupRow[] = [];
  let cursor: ConversationsCursor | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await getConversationsInbox({ view: "groups", limit: PAGE, cursor });
    for (const item of result.items) {
      groups.push({
        id: item.conversation_id,
        name: item.participant_name ?? "Grupo WhatsApp",
        lastActivityAt: item.last_activity_at,
        visibility: item.visibility ?? "owner_only",
        archived: Boolean(item.archived_at),
      });
    }
    const last = result.items.at(-1);
    if (result.items.length < PAGE || !last) break;
    cursor = { ts: last.last_activity_at, id: last.conversation_id };
  }

  const readingGroups = channel?.ingestSettings.ingestGroups === true;

  return (
    <PageContainer>
      <PageHeader title="Grupos" />
      {!readingGroups ? (
        <p className="mb-stack max-w-3xl rounded-control bg-neutral-soft px-3 py-2 text-body text-text-muted" data-testid="groups-ingest-off">
          A leitura de grupos do WhatsApp está <strong>desligada</strong>, por privacidade: nenhuma mensagem de grupo é
          guardada. Para ligar, use{" "}
          <Link className="underline" href="/configuracoes/whatsapp">Configurações &gt; WhatsApp</Link>. Quando ligar, os
          grupos aparecem aqui, todos restritos a você.
        </p>
      ) : null}
      <GroupsVisibilityManager groups={groups} />
    </PageContainer>
  );
}
