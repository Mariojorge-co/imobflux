import type { BrowserContext } from "@playwright/test";
import webpush from "web-push";
import { demoAttendant, demoOwner, queryLocalSql, runLocalSql } from "./local-test-state";

// Apoio dos testes de Web Push. NUNCA envia push real: os endpoints são de mentira (host .test, que não existe) ou de um
// endereço de documentação sem rota (192.0.2.x). As chaves do aparelho são descartáveis, geradas em memória.

/** Chave pública P-256 no formato certo (87 caracteres): serve de "p256dh" falso do aparelho. */
export const FAKE_P256DH = webpush.generateVAPIDKeys().publicKey;
export const FAKE_AUTH = "abcdefghijklmnopqrstuv";

export function memberIdOf(email: string): string {
  return queryLocalSql(
    `select member.id from public.workspace_members as member
       join public.app_users as app_user on app_user.id = member.user_id
       join auth.users as auth_user on auth_user.id = app_user.auth_user_id
      where auth_user.email = '${email}' limit 1;`,
  );
}

export const ownerMemberId = () => memberIdOf(demoOwner.email);
export const attendantMemberId = () => memberIdOf(demoAttendant.email);

/** Cria uma assinatura de mentira direto no banco (nada é enviado a lugar nenhum). */
export function insertFakeSubscription(memberId: string, endpoint: string, platform: "ios" | "android" | "desktop" = "android") {
  runLocalSql(`
    insert into public.push_subscriptions (workspace_id, member_id, endpoint, p256dh, auth, platform, user_agent)
    select member.workspace_id, member.id, '${endpoint}', '${FAKE_P256DH}', '${FAKE_AUTH}', '${platform}', 'Mozilla/5.0 (teste) Chrome/120'
      from public.workspace_members as member where member.id = '${memberId}';
  `);
}

export function subscriptionState(endpoint: string): { lastError: boolean; disabled: boolean } | null {
  const row = queryLocalSql(
    `select (last_error_at is not null)::text || ',' || (disabled_at is not null)::text from public.push_subscriptions where endpoint = '${endpoint}';`,
  );
  if (!row) return null;
  const [lastError, disabled] = row.split(",");
  return { lastError: lastError === "true", disabled: disabled === "true" };
}

export function clearSubscriptions() {
  runLocalSql("delete from public.push_subscriptions;");
}

/**
 * Substitui o `PushManager` do navegador por um falso: não fala com nenhum serviço de push. A assinatura "mora" no sessionStorage
 * (sobrevive a recarregar a página, como a verdadeira) e usa um endpoint de mentira único por aparelho.
 */
export async function installFakePush(context: BrowserContext, endpointSuffix: string) {
  await context.addInitScript(
    ({ p256dh, auth, suffix }) => {
      const KEY = "imobflux-test-fake-push-endpoint";
      const make = (endpoint: string) => ({
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh, auth } }),
        unsubscribe: async () => {
          window.sessionStorage.removeItem(KEY);
          return true;
        },
      });
      const proto = (window as unknown as { PushManager?: { prototype: Record<string, unknown> } }).PushManager?.prototype;
      if (!proto) return;
      proto.getSubscription = async () => {
        const stored = window.sessionStorage.getItem(KEY);
        return stored ? make(stored) : null;
      };
      proto.subscribe = async () => {
        const endpoint = `https://push.example.test/fake-device-${suffix}-${Math.random().toString(36).slice(2, 10)}`;
        window.sessionStorage.setItem(KEY, endpoint);
        return make(endpoint);
      };
    },
    { p256dh: FAKE_P256DH, auth: FAKE_AUTH, suffix: endpointSuffix },
  );
}
