"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { guardFixCount } from "@/lib/ui/field-font-guard";

// TEMPORÁRIO (Ajustes 7): serve para o Mário copiar os números reais do iPhone (zoom nos campos e faixa de baixo no app instalado).
// Remover quando os dois problemas estiverem confirmados como resolvidos. Tudo é medido no próprio aparelho, nada vai a servidor e
// não há nenhum dado de cliente aqui.

const FIELD_CLASS = "min-h-11 w-full resize-none rounded-control border bg-background px-3 py-2 text-body text-text";

function probeFont(tag: "textarea" | "input", type?: string): string {
  const element = document.createElement(tag);
  if (type) (element as HTMLInputElement).type = type;
  element.className = FIELD_CLASS;
  element.setAttribute("aria-hidden", "true");
  element.tabIndex = -1;
  element.style.cssText = "position:fixed;left:-9999px;top:0;visibility:hidden";
  document.body.appendChild(element);
  const size = getComputedStyle(element).fontSize;
  element.remove();
  return size;
}

function safeAreas(): string {
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:fixed;left:-9999px;top:0;visibility:hidden;padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left)";
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const text = `top ${style.paddingTop} / right ${style.paddingRight} / bottom ${style.paddingBottom} / left ${style.paddingLeft}`;
  probe.remove();
  return text;
}

function realFont(selector: string): string {
  const element = document.querySelector<HTMLElement>(selector);
  return element ? getComputedStyle(element).fontSize : "(não está nesta tela)";
}

export function collectScreenDiagnostics(): Array<[string, string]> {
  const visual = window.visualViewport;
  const doc = document.documentElement;
  const standaloneMedia = window.matchMedia("(display-mode: standalone)").matches;
  const standaloneNav = (navigator as unknown as { standalone?: boolean }).standalone;
  return [
    ["Janela (innerWidth x innerHeight)", `${window.innerWidth} x ${window.innerHeight}`],
    [
      "visualViewport (largura x altura, zoom, offsetTop)",
      visual ? `${Math.round(visual.width)} x ${Math.round(visual.height)}, zoom ${visual.scale}, offsetTop ${Math.round(visual.offsetTop)}` : "sem suporte",
    ],
    ["Tela (screen.width x height)", `${screen.width} x ${screen.height}`],
    ["devicePixelRatio", String(window.devicePixelRatio)],
    ["navigator.standalone (iOS)", standaloneNav === undefined ? "indefinido" : standaloneNav ? "sim" : "não"],
    ["display-mode: standalone", standaloneMedia ? "sim" : "não"],
    ["Áreas seguras env(safe-area-inset-*)", safeAreas()],
    ["Fonte de um campo como a caixa de mensagem", probeFont("textarea")],
    ["Fonte de um campo como a busca", probeFont("input", "search")],
    ["Fonte da caixa de mensagem desta tela", realFont('textarea[aria-label^="Digitar"]')],
    ["Fonte do campo de busca desta tela", realFont('input[type="search"], input[aria-label*="uscar"]')],
    ["Correções da guarda de 16 px nesta sessão", String(guardFixCount())],
    ["Regra: largura até 767px / toque (pointer coarse) / sem hover", `${window.matchMedia("(max-width: 767px)").matches} / ${window.matchMedia("(pointer: coarse)").matches} / ${window.matchMedia("(hover: none)").matches}`],
    ["text-size-adjust do html", getComputedStyle(doc).getPropertyValue("-webkit-text-size-adjust") || getComputedStyle(doc).getPropertyValue("text-size-adjust") || "(vazio)"],
    ["Documento: scrollHeight / clientHeight", `${doc.scrollHeight} / ${doc.clientHeight}`],
    ["Corpo: scrollHeight / clientHeight", `${document.body.scrollHeight} / ${document.body.clientHeight}`],
    ["Fundo do html", getComputedStyle(doc).backgroundColor],
    ["Fundo do body", getComputedStyle(document.body).backgroundColor],
    ["overscroll-behavior do html", getComputedStyle(doc).getPropertyValue("overscroll-behavior") || "(vazio)"],
    ["Tema (classe dark)", doc.classList.contains("dark") ? "escuro" : "claro"],
    ["User agent", navigator.userAgent],
  ];
}

export function diagnosticsAsText(rows: Array<[string, string]>): string {
  return ["ImobFlux — diagnóstico de tela (temporário)", `Gerado em ${new Date().toISOString()}`, ...rows.map(([label, value]) => `${label}: ${value}`)].join("\n");
}

/** TEMPORÁRIO. Seção recolhida em Preferências com os números da tela do aparelho e o botão "Copiar". */
export function ScreenDiagnostics() {
  const [rows, setRows] = useState<Array<[string, string]> | null>(null);
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");

  const refresh = () => {
    setRows(collectScreenDiagnostics());
    setCopied("idle");
  };

  const copy = async () => {
    const text = diagnosticsAsText(rows ?? collectScreenDiagnostics());
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      // Sem permissão da área de transferência: seleciona num campo temporário.
      const area = document.createElement("textarea");
      area.value = text;
      area.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(area);
      area.select();
      try {
        setCopied(document.execCommand("copy") ? "ok" : "fail");
      } catch {
        setCopied("fail");
      }
      area.remove();
    }
  };

  return (
    <details
      className="rounded-control border border-border px-3 py-2"
      data-testid="screen-diagnostics"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) refresh();
      }}
    >
      <summary className="min-h-11 cursor-pointer text-body font-medium text-text">Diagnóstico de tela (temporário)</summary>
      <div className="space-y-3 pb-2 pt-2">
        <p className="text-caption text-text-muted">
          Serve só para enviar números do seu aparelho a quem está ajustando a tela. Tudo é medido aqui mesmo; nada é enviado a servidor e não há dados de clientes.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button data-testid="screen-diag-copy" onClick={() => void copy()} type="button" variant="secondary">Copiar</Button>
          <Button data-testid="screen-diag-refresh" onClick={refresh} type="button" variant="ghost">Atualizar</Button>
          <span aria-live="polite" className="text-caption text-text-muted" data-testid="screen-diag-copied" role="status">
            {copied === "ok" ? "Copiado." : copied === "fail" ? "Não consegui copiar; selecione o texto abaixo." : ""}
          </span>
        </div>
        <dl className="grid gap-x-4 gap-y-1 text-caption sm:grid-cols-[18rem_1fr]" data-testid="screen-diag-list">
          {(rows ?? []).map(([label, value]) => (
            <div className="contents" key={label}>
              <dt className="text-text-muted">{label}</dt>
              <dd className="break-words text-text" data-diag-label={label}>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  );
}
