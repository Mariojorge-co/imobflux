import { Card, PageContainer, PageHeader, SectionTitle } from "@/components/ui";
import { NotificationSettings } from "@/components/notifications/notification-settings";
import { PushSettings } from "@/components/notifications/push-settings";
import { ScreenDiagnostics } from "@/components/notifications/screen-diagnostics";
import { ThemeChooser } from "@/components/theme-controls";
import { requireActiveAccess } from "@/lib/auth/dal";
import { readVapidConfig } from "@/lib/push/config";

export const dynamic = "force-dynamic";

/** Preferências pessoais (valem só para quem está logado, neste navegador): aparência e avisos de mensagem nova. */
export default async function PreferenciasPage() {
  const access = await requireActiveAccess();
  // A chave pública é pública por definição (vai ao navegador); a privada nunca sai do servidor.
  const pushPublicKey = readVapidConfig()?.publicKey ?? null;
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
      <section aria-labelledby="avisos" className="space-y-3">
        <SectionTitle id="avisos">Avisos de mensagem nova</SectionTitle>
        <Card>
          <NotificationSettings memberId={access.memberId} />
        </Card>
      </section>
      <section aria-labelledby="avisos-aparelho" className="space-y-3">
        <SectionTitle id="avisos-aparelho">Avisos neste aparelho</SectionTitle>
        <Card>
          <PushSettings publicKey={pushPublicKey} />
        </Card>
      </section>
      {/* TEMPORÁRIO (Ajustes 7): números da tela do aparelho para diagnosticar zoom e faixa de baixo no iPhone. Remover depois. */}
      <section aria-labelledby="diagnostico-tela" className="space-y-3">
        <SectionTitle id="diagnostico-tela">Diagnóstico de tela</SectionTitle>
        <Card>
          <ScreenDiagnostics />
        </Card>
      </section>
    </PageContainer>
  );
}
