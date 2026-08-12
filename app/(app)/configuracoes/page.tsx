import Link from "next/link";
import { Users } from "lucide-react";
import {
  Card,
  PageContainer,
  PageHeader,
} from "@/components/ui";
import { requireOwnerAccess } from "@/lib/auth/dal";

export default async function ConfiguracoesPage() {
  await requireOwnerAccess();

  return (
    <PageContainer>
      <PageHeader title="Configurações" />
      <section aria-label="Áreas de Configurações">
        <Link className="block max-w-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" href="/configuracoes/equipe">
          <Card className="flex items-center gap-stack transition-colors hover:bg-neutral-soft">
            <span className="flex size-11 items-center justify-center rounded-control bg-neutral-soft text-text">
              <Users aria-hidden="true" size={20} />
            </span>
            <span>
              <span className="block font-semibold text-text">Equipe</span>
              <span className="text-body text-text-muted">Convide, desative e reative funcionários.</span>
            </span>
          </Card>
        </Link>
      </section>
    </PageContainer>
  );
}
