import { PageContainer, PageHeader } from "@/components/ui";
import { ContactsClient } from "@/components/contatos/contacts-client";
import { requireActiveAccess } from "@/lib/auth/dal";
import { getContacts, parseContactListFilters } from "@/lib/contacts/data";

type ContactsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ContactsPage({ searchParams }: ContactsPageProps) {
  const [access, resolvedSearchParams] = await Promise.all([
    requireActiveAccess(),
    searchParams,
  ]);
  const filters = parseContactListFilters(resolvedSearchParams);
  const result = await getContacts(access.workspaceId, filters);

  return (
    <PageContainer>
      <PageHeader
        description="Cadastre e acompanhe os contatos do seu workspace."
        title="Contatos"
      />
      <ContactsClient
        contacts={result.contacts}
        filters={filters}
        page={result.page}
        total={result.total}
        canManagePrivacy={access.role === "owner"}
      />
    </PageContainer>
  );
}
