"use client";

import { useEffect, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import {
  getWhatsappWebhookStatusAction,
  updateWhatsappWebhookEventsAction,
  type WebhookEventsStatus,
} from "@/app/(app)/configuracoes/whatsapp/actions";

/**
 * Avisos de edição e exclusão feitos no celular. A Evolution só avisa o ImobFlux dessas mudanças se a conexão assinar os
 * eventos certos; conexões feitas antes desta versão não os assinam. O dono vê o estado e reaplica com um clique (não
 * mexe na conexão do número nem pede QR).
 */
export function WebhookEventsCard() {
  const [status, setStatus] = useState<WebhookEventsStatus | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    void getWhatsappWebhookStatusAction().then((result) => {
      if (alive) setStatus(result);
    });
    return () => {
      alive = false;
    };
  }, []);

  const apply = () =>
    startTransition(async () => {
      setStatus(await updateWhatsappWebhookEventsAction());
    });

  const ready = status?.ok === true && status.connected;
  const active = status?.ok === true ? status.active : null;

  return (
    <Card className="space-y-3" data-testid="webhook-events-card">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-control bg-neutral-soft text-text">
          <RefreshCw aria-hidden="true" size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-text">Edição e exclusão feitas no celular</h2>
          <p className="text-body text-text-muted">
            Para o ImobFlux saber quando você edita ou apaga uma mensagem no WhatsApp do celular (e para confirmar o que você faz
            aqui), a conexão precisa assinar estes avisos.
          </p>
        </div>
        {status === null ? (
          <Badge tone="neutral">Verificando…</Badge>
        ) : !status.ok ? (
          <Badge tone="danger">Não foi possível verificar</Badge>
        ) : !status.connected ? (
          <Badge tone="neutral">Sem conexão</Badge>
        ) : active === null ? (
          <Badge tone="neutral">Estado desconhecido</Badge>
        ) : active ? (
          <Badge tone="success">Ativos</Badge>
        ) : (
          <Badge tone="warning">Desativados</Badge>
        )}
      </div>

      {status && !status.ok ? (
        <p className="text-caption font-medium text-danger" role="alert">
          {status.error}
        </p>
      ) : null}

      {ready ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button data-testid="webhook-events-apply" disabled={pending} onClick={apply} variant={active ? "secondary" : "primary"}>
            {pending ? "Atualizando…" : active ? "Reaplicar" : "Ativar avisos de edição e exclusão"}
          </Button>
          {active === false ? (
            <span className="text-caption text-text-muted" data-testid="webhook-events-missing">
              Falta assinar: {status && status.ok ? status.missing.join(", ") : ""}
            </span>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
