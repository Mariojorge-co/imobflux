"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Smartphone, TriangleAlert } from "lucide-react";
import { Badge, Button, Card, ModalDialog } from "@/components/ui";
import {
  disconnectWhatsappAction,
  refreshWhatsappConnectionAction,
  startWhatsappConnectionAction,
  type WhatsappActionResult,
} from "@/app/(app)/configuracoes/whatsapp/actions";
import { formatConnectedPhone } from "@/lib/whatsapp/channel";
import type { EvolutionQr } from "@/lib/whatsapp/evolution-instance";
import type { HistoryImportView } from "@/lib/whatsapp/history-status";
import { HistoryImportNotice } from "@/components/whatsapp/history-import-notice";

export type InitialWhatsappChannel = {
  status: "configured" | "active" | "paused" | "disconnected" | "replaced";
  phone: string | null;
  activatedAt: string | null;
} | null;

type View = "connected" | "disconnected" | "starting" | "qr";

const POLL_MS = 3_000;
const QR_RENEW_MS = 35_000; // o QR do WhatsApp expira em poucos segundos; renovamos antes de ficar velho

function formatSince(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function WhatsappConnection({ configured, initial, initialHistory = null }: { configured: boolean; initial: InitialWhatsappChannel; initialHistory?: HistoryImportView | null }) {
  const router = useRouter();
  const [view, setView] = useState<View>(initial?.status === "active" ? "connected" : "disconnected");
  const [phone, setPhone] = useState<string | null>(initial?.phone ?? null);
  const [activatedAt] = useState<string | null>(initial?.activatedAt ?? null);
  const [qr, setQr] = useState<EvolutionQr | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const qrAtRef = useRef(0);
  const inFlightRef = useRef(false);

  const applyResult = useCallback((result: WhatsappActionResult): "open" | "connecting" | "close" | "error" => {
    if (!result.ok) {
      setError(result.error);
      return "error";
    }
    setError(null);
    if (result.state === "open") {
      setPhone(result.phone);
      setQr(null);
      setView("connected");
      router.refresh();
      return "open";
    }
    if (result.state === "connecting") {
      if (result.qr) {
        setQr(result.qr);
        qrAtRef.current = Date.now();
      }
      return "connecting";
    }
    return "close";
  }, [router]);

  // Confere o estado real ao abrir a página: uma conexão marcada como ativa pode ter sido
  // encerrada pelo celular.
  useEffect(() => {
    if (!configured || initial?.status !== "active") return;
    let cancelled = false;
    void (async () => {
      const result = await refreshWhatsappConnectionAction(false);
      if (cancelled) return;
      if (result.ok && result.state === "close") {
        setView("disconnected");
        setNotice("O WhatsApp foi desconectado do aparelho. Conecte novamente para voltar a receber mensagens.");
      } else if (result.ok && result.state === "open" && result.phone) {
        setPhone(result.phone);
      }
    })();
    return () => { cancelled = true; };
  }, [configured, initial?.status]);

  // Enquanto o QR está na tela, consulta o estado e renova o código antes que expire.
  useEffect(() => {
    if (view !== "qr") return;
    const timer = setInterval(() => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const renew = Date.now() - qrAtRef.current >= QR_RENEW_MS;
      void refreshWhatsappConnectionAction(renew)
        .then((result) => {
          const outcome = applyResult(result);
          if (outcome === "close") {
            setView("disconnected");
            setQr(null);
            setError("A conexão foi encerrada antes de ser concluída. Gere um novo QR code para tentar de novo.");
          } else if (outcome === "error" && !result.ok && result.code !== "EVOLUTION_UNREACHABLE") {
            setView("disconnected");
            setQr(null);
          }
        })
        .finally(() => { inFlightRef.current = false; });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [view, applyResult]);

  async function start() {
    setError(null);
    setNotice(null);
    setView("starting");
    const result = await startWhatsappConnectionAction();
    const outcome = applyResult(result);
    if (outcome === "connecting") {
      setView("qr");
    } else if (outcome !== "open") {
      setView("disconnected");
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    const result = await disconnectWhatsappAction();
    setDisconnecting(false);
    setConfirmOpen(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setPhone(null);
    setView("disconnected");
    setNotice("WhatsApp desconectado. As mensagens deixam de chegar ao ImobFlux até você conectar de novo.");
    router.refresh();
  }

  if (!configured) {
    return (
      <Card className="flex items-start gap-stack" role="status">
        <TriangleAlert aria-hidden="true" className="mt-0.5 shrink-0 text-warning" size={20} />
        <div>
          <h2 className="font-semibold text-text">Integração ainda não configurada</h2>
          <p className="mt-inline text-body text-text-muted">
            Este ambiente ainda não tem a conexão com o servidor do WhatsApp (Evolution API). Peça ao responsável
            técnico para definir <code>EVOLUTION_API_URL</code>, <code>EVOLUTION_API_KEY</code> e{" "}
            <code>EVOLUTION_WEBHOOK_SECRET</code>; depois volte aqui para ler o QR code.
          </p>
        </div>
      </Card>
    );
  }

  const since = formatSince(activatedAt);
  const formattedPhone = formatConnectedPhone(phone);

  return (
    <div className="space-y-stack">
      {error ? (
        <p className="rounded-control border border-danger-border bg-danger-soft px-control-x py-control-y text-body text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {notice && !error ? (
        <p className="rounded-control border border-neutral-border bg-neutral-soft px-control-x py-control-y text-body text-text" role="status">
          {notice}
        </p>
      ) : null}

      {view === "connected" ? (
        <Card className="space-y-stack">
          <div className="flex flex-wrap items-center gap-stack">
            <span className="flex size-11 items-center justify-center rounded-control bg-success-soft text-success">
              <CheckCircle2 aria-hidden="true" size={22} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-inline">
                <h2 className="font-semibold text-text">WhatsApp conectado</h2>
                <Badge tone="success">Ativo</Badge>
              </div>
              <p className="text-body text-text-muted">
                {formattedPhone ? `Número ${formattedPhone}` : "Número conectado"}
                {since ? ` · desde ${since}` : ""}
              </p>
            </div>
          </div>
          <p className="text-body text-text-muted">
            As mensagens deste número chegam ao ImobFlux e você responde por aqui. O WhatsApp no celular continua
            funcionando normalmente.
          </p>
          <HistoryImportNotice initial={initialHistory} />
          <div>
            <Button onClick={() => setConfirmOpen(true)} variant="secondary">Desconectar</Button>
          </div>
        </Card>
      ) : null}

      {view === "disconnected" || view === "starting" ? (
        <Card className="space-y-stack">
          <div className="flex flex-wrap items-center gap-stack">
            <span className="flex size-11 items-center justify-center rounded-control bg-neutral-soft text-text">
              <Smartphone aria-hidden="true" size={22} />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-inline">
                <h2 className="font-semibold text-text">Conecte o WhatsApp da imobiliária</h2>
                <Badge tone="warning">Não conectado</Badge>
              </div>
              <p className="text-body text-text-muted">
                Leia um QR code com o celular para receber e responder as mensagens dos clientes no ImobFlux.
              </p>
            </div>
          </div>
          <div>
            <Button disabled={view === "starting"} onClick={() => void start()}>
              {view === "starting" ? "Gerando QR code…" : "Conectar WhatsApp"}
            </Button>
          </div>
        </Card>
      ) : null}

      {view === "qr" ? (
        <Card className="space-y-stack">
          <div className="flex flex-wrap items-center gap-inline">
            <h2 className="font-semibold text-text">Leia o QR code com o WhatsApp</h2>
            <Badge tone="info">Aguardando leitura</Badge>
          </div>
          <div className="flex flex-col gap-stack md:flex-row md:items-start">
            <div className="flex size-64 shrink-0 items-center justify-center rounded-card border border-border bg-white p-2">
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element -- imagem data URL gerada pelo servidor do WhatsApp
                <img alt="QR code para conectar o WhatsApp" className="size-full" height={240} src={qr.image} width={240} />
              ) : (
                <p className="text-center text-body text-text-muted" role="status">Carregando QR code…</p>
              )}
            </div>
            <div className="space-y-stack">
              <ol className="list-decimal space-y-1 pl-5 text-body text-text">
                <li>Abra o <strong>WhatsApp</strong> no celular da imobiliária.</li>
                <li>Toque em <strong>Mais opções (⋮)</strong> ou em <strong>Configurações</strong> e escolha <strong>Dispositivos conectados</strong>.</li>
                <li>Toque em <strong>Conectar um dispositivo</strong> e aponte a câmera para este código.</li>
              </ol>
              <p className="text-body text-text-muted" role="status">
                O código é renovado automaticamente. Esta tela atualiza sozinha assim que a conexão for confirmada.
              </p>
              <Button onClick={() => { setView("disconnected"); setQr(null); }} variant="ghost">Cancelar</Button>
            </div>
          </div>
        </Card>
      ) : null}

      <ModalDialog labelledBy="whatsapp-disconnect-title" onOpenChange={(open) => { if (!disconnecting) setConfirmOpen(open); }} open={confirmOpen}>
        <div className="space-y-stack">
          <h3 className="text-section-title font-semibold" id="whatsapp-disconnect-title">Desconectar o WhatsApp?</h3>
          <p className="text-body text-text-muted">
            As mensagens deixam de chegar ao ImobFlux e o envio por aqui fica indisponível até você conectar de novo
            com um novo QR code. O histórico de conversas é mantido.
          </p>
          <div className="flex justify-end gap-inline">
            <Button disabled={disconnecting} onClick={() => setConfirmOpen(false)} variant="ghost">Cancelar</Button>
            <Button disabled={disconnecting} onClick={() => void disconnect()} variant="danger">
              {disconnecting ? "Desconectando…" : "Desconectar"}
            </Button>
          </div>
        </div>
      </ModalDialog>
    </div>
  );
}
