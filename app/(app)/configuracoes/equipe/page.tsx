import { PageContainer, PageHeader } from "@/components/ui";
import { TeamManagement } from "@/components/team/team-management";
import { getTeamMembers } from "@/lib/team/data";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const members = await getTeamMembers();

  return (
    <PageContainer>
      <PageHeader title="Equipe" />
      <TeamManagement members={members} />
    </PageContainer>
  );
}
