import { expect, test } from "@playwright/test";
import { formatConnectedPhone, instanceNameForWorkspace, normalizeInstanceState, phoneFromJid, resolveWebhookUrl } from "@/lib/whatsapp/channel";

test("nome da instância: estável, só [a-z0-9-] e aceito pela função do banco", () => {
  const name = instanceNameForWorkspace("8AD043DD-3B0F-4E3F-A14B-9AE303DF7FE2");
  expect(name).toBe("imobflux-8ad043dd3b0f");
  expect(name).toMatch(/^[a-z0-9][a-z0-9-]{2,62}$/);
  expect(instanceNameForWorkspace("8ad043dd-3b0f-4e3f-a14b-9ae303df7fe2")).toBe(name);
  expect(instanceNameForWorkspace("../etc/passwd; drop")).toMatch(/^imobflux-[a-f0-9]*$/);
});

test("estado da Evolution vira open/connecting/close; qualquer outra coisa é close", () => {
  expect(normalizeInstanceState("open")).toBe("open");
  expect(normalizeInstanceState("OPEN")).toBe("open");
  expect(normalizeInstanceState("connecting")).toBe("connecting");
  for (const other of ["close", "closed", "refused", "", null, undefined, 42]) {
    expect(normalizeInstanceState(other)).toBe("close");
  }
});

test("número do ownerJid em E.164, ignorando o sufixo de dispositivo", () => {
  expect(phoneFromJid("5582999990000@s.whatsapp.net")).toBe("+5582999990000");
  expect(phoneFromJid("5582999990000:12@s.whatsapp.net")).toBe("+5582999990000");
  expect(phoneFromJid("14155550123@s.whatsapp.net")).toBe("+14155550123");
  for (const bad of [null, undefined, "", "abc@s.whatsapp.net", "123@s.whatsapp.net", "0123456789@s.whatsapp.net", 5582999990000]) {
    expect(phoneFromJid(bad)).toBeNull();
  }
});

test("endereço do webhook: domínio publicado (https) ou override; local/privado é recusado", () => {
  expect(resolveWebhookUrl({ env: {}, host: "imobflux.vercel.app", proto: "https" })).toEqual({ ok: true, url: "https://imobflux.vercel.app/api/webhooks/whatsapp" });
  expect(resolveWebhookUrl({ env: {}, host: "app.imobiliaria.com.br", proto: null })).toEqual({ ok: true, url: "https://app.imobiliaria.com.br/api/webhooks/whatsapp" });
  expect(resolveWebhookUrl({ env: { WHATSAPP_WEBHOOK_BASE_URL: "http://host.docker.internal:3100/" }, host: "localhost:3100", proto: "http" }))
    .toEqual({ ok: true, url: "http://host.docker.internal:3100/api/webhooks/whatsapp" });
  expect(resolveWebhookUrl({ env: { WHATSAPP_WEBHOOK_BASE_URL: "https://x.test/qualquer/caminho" }, host: null, proto: null }))
    .toEqual({ ok: true, url: "https://x.test/api/webhooks/whatsapp" });

  for (const host of ["localhost:3000", "127.0.0.1:3000", "192.168.0.10", "10.1.2.3", "172.20.1.1", "meuapp.localhost", "[::1]:3000"]) {
    expect(resolveWebhookUrl({ env: {}, host, proto: "https" })).toEqual({ ok: false, reason: "UNREACHABLE" });
  }
  expect(resolveWebhookUrl({ env: {}, host: "imobflux.vercel.app", proto: "http" })).toEqual({ ok: false, reason: "UNREACHABLE" });
  expect(resolveWebhookUrl({ env: {}, host: null, proto: null })).toEqual({ ok: false, reason: "UNREACHABLE" });
  expect(resolveWebhookUrl({ env: { WHATSAPP_WEBHOOK_BASE_URL: "javascript:alert(1)" }, host: "x.com", proto: "https" })).toEqual({ ok: false, reason: "UNREACHABLE" });
  expect(resolveWebhookUrl({ env: { WHATSAPP_WEBHOOK_BASE_URL: "não é url" }, host: "x.com", proto: "https" })).toEqual({ ok: false, reason: "UNREACHABLE" });
});

test("número exibido de forma legível", () => {
  expect(formatConnectedPhone("+5582999990000")).toBe("+55 (82) 99999-0000");
  expect(formatConnectedPhone("+558233221100")).toBe("+55 (82) 3322-1100");
  expect(formatConnectedPhone("+14155550123")).toBe("+14155550123");
  expect(formatConnectedPhone(null)).toBeNull();
  expect(formatConnectedPhone("")).toBeNull();
});
