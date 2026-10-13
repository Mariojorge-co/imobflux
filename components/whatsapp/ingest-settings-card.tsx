"use client";

import { useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";
import { Badge, Card, Select } from "@/components/ui";
import { saveWhatsappIngestSettingsAction } from "@/app/(app)/configuracoes/whatsapp/actions";
import { canChangeHistoryWindow, describeIgnored, type IngestSettings } from "@/lib/whatsapp/ingest-settings";

type Props = {
  initial: IngestSettings;
  /** Estado da conexão ("configured", "active"...) ou null quando ainda não há conexão registrada. */
  connectionStatus: string | null;
};

/**
 * O que entra no CRM quando o número é conectado. O dono liga e desliga aqui; cada mudança é
 * gravada na hora e auditada. Fica visível antes do QR code, para escolher ANTES de conectar.
 */
export function IngestSettingsCard({ initial, connectionStatus }: Props) {
  const [settings, setSettings] = useState(initial);
  const [status, setStatus] = useState(connectionStatus);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(change: { ingestGroups?: boolean; onlyKnownContacts?: boolean; historyWindowDays?: number }) {
    setError(null);
    setSaved(false);
    // Atualiza na hora (o controle não "pisca" de volta) e desfaz se o servidor recusar.
    const previous = settings;
    setSettings({
      ...settings,
      ...(change.ingestGroups === undefined ? {} : { ingestGroups: change.ingestGroups }),
      ...(change.onlyKnownContacts === undefined ? {} : { onlyKnownContacts: change.onlyKnownContacts }),
      ...(change.historyWindowDays === undefined ? {} : { historyWindowDays: change.historyWindowDays }),
    });
    startTransition(async () => {
      const result = await saveWhatsappIngestSettingsAction(change);
      if (!result.ok) {
        setSettings(previous);
        setError(result.error);
        return;
      }
      setSettings(result.settings);
      setStatus(result.connectionStatus);
      setSaved(true);
    });
  }

  const historyEditable = canChangeHistoryWindow(status);
  const ignoredLines = describeIgnored(settings.ignored);

  return (
    <Card className="space-y-stack" data-testid="ingest-settings">
      <div className="flex flex-wrap items-center gap-stack">
        <span className="flex size-11 items-center justify-center rounded-control bg-neutral-soft text-text">
          <ShieldCheck aria-hidden="true" size={22} />
        </span>
        <div>
          <h2 className="font-semibold text-text">O que entra no ImobFlux</h2>
          <p className="text-body text-text-muted">
            Escolha antes de conectar o número. Cada mudança é salva na hora e fica registrada na auditoria.
          </p>
        </div>
      </div>

      {error ? (
        <p className="rounded-control border border-danger-border bg-danger-soft px-control-x py-control-y text-body text-danger" role="alert">{error}</p>
      ) : null}

      <label className="flex items-start gap-stack">
        <input
          checked={settings.onlyKnownContacts}
          className="mt-1 size-5 shrink-0 accent-primary"
          data-testid="toggle-only-known"
          disabled={pending}
          onChange={(event) => save({ onlyKnownContacts: event.target.checked })}
          type="checkbox"
        />
        <span>
          <span className="flex flex-wrap items-center gap-inline font-medium text-text">
            Modo de teste: só conversas com contatos já cadastrados
            <Badge tone={settings.onlyKnownContacts ? "success" : "warning"}>{settings.onlyKnownContacts ? "Ligado" : "Desligado"}</Badge>
          </span>
          <span className="block text-body text-text-muted">
            Ligado, um número que não está em Contatos não cria contato, conversa nem mensagem, tanto se ele escrever para
            você quanto se você escrever para ele pelo celular. Desligado, todo número novo entra como contato (é assim
            que os leads novos chegam). Cadastre o seu contato de teste antes de conversar.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-stack">
        <input
          checked={settings.ingestGroups}
          className="mt-1 size-5 shrink-0 accent-primary"
          data-testid="toggle-groups"
          disabled={pending}
          onChange={(event) => save({ ingestGroups: event.target.checked })}
          type="checkbox"
        />
        <span>
          <span className="flex flex-wrap items-center gap-inline font-medium text-text">
            Receber mensagens de grupos
            <Badge tone={settings.ingestGroups ? "warning" : "success"}>{settings.ingestGroups ? "Ligado" : "Desligado"}</Badge>
          </span>
          <span className="block text-body text-text-muted">
            Desligado (recomendado para número pessoal), nada de grupo é guardado: nem mensagens, nem os contatos dos
            participantes, nem arquivos. Listas de transmissão, canais e Status do WhatsApp nunca entram.
          </span>
        </span>
      </label>

      <div className="space-y-1">
        <label className="font-medium text-text" htmlFor="history-window">Histórico ao conectar</label>
        <Select
          data-testid="select-history"
          disabled={pending || !historyEditable}
          id="history-window"
          onChange={(event) => save({ historyWindowDays: Number(event.target.value) })}
          value={settings.historyWindowDays === 0 ? "0" : "15"}
        >
          <option value="0">Não importar nenhum histórico</option>
          <option value="15">Importar os últimos 15 dias</option>
        </Select>
        <p className="text-body text-text-muted">
          {historyEditable
            ? "O WhatsApp envia o histórico uma única vez, na hora de conectar. Com “nenhum”, só as mensagens novas chegam."
            : "O histórico só pode ser escolhido antes de conectar. Para mudar, desconecte e conecte o número de novo."}
        </p>
      </div>

      {ignoredLines.length > 0 ? (
        <p className="rounded-control border border-border bg-neutral-soft px-control-x py-control-y text-body text-text" data-testid="ignored-summary" role="status">
          Mensagens ignoradas pelos filtros: {ignoredLines.join(", ")}. Nenhum conteúdo nem número é guardado nessa contagem.
        </p>
      ) : null}

      <p aria-live="polite" className="min-h-5 text-caption text-text-muted" role="status">
        {pending ? "Salvando…" : saved ? "Configuração salva." : ""}
      </p>
    </Card>
  );
}
