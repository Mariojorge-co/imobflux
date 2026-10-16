import { Card, PageContainer, PageHeader, SectionTitle } from "@/components/ui";
import { ThemeChooser } from "@/components/theme-controls";
import { requireActiveAccess } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

/** Preferências pessoais (valem só para quem está logado, neste navegador): aparência e, mais abaixo, notificações. */
export default async function PreferenciasPage() {
  await requireActiveAccess();
  return (
    <PageContainer className="space-y-6">
      <PageHeader description="Estas escolhas são só suas e ficam salvas neste navegador." title="Preferências" />
      <section aria-labelledby="aparencia" className="space-y-3">
        <SectionTitle id="aparencia">Aparência</SectionTitle>
        <Card className="space-y-3">
          <p className="text-body text-text-muted">Escolha o tema. No modo automático o ImobFlux acompanha o tema do seu aparelho.</p>
          <ThemeChooser />
        </Card>
      </section>
    </PageContainer>
  );
}
