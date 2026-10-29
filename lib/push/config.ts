// Web Push: configuração das chaves VAPID. Sem as três variáveis (ou com valor inválido) o recurso fica DESLIGADO: o webhook segue normal
// e a tela de Preferências mostra "indisponível". Nenhuma chave é impressa, registrada em log nem devolvida pela API (a pública
// vai ao navegador de propósito: ela é pública por definição).

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

type Env = Record<string, string | undefined>;

const URL_SAFE_BASE64 = /^[A-Za-z0-9_-]+$/;

/** Lê e valida as variáveis. `null` = recurso desligado. */
export function readVapidConfig(env: Env = process.env): VapidConfig | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  // Contato do servidor de push: mailto: ou https:// (exigência do padrão VAPID).
  if (!/^mailto:[^\s@]+@[^\s@]+$/i.test(subject) && !/^https:\/\/[^\s]+$/i.test(subject)) return null;
  // Chave pública P-256 não comprimida (65 bytes) e privada (32 bytes), em base64 seguro para URL.
  if (!URL_SAFE_BASE64.test(publicKey) || publicKey.length !== 87) return null;
  if (!URL_SAFE_BASE64.test(privateKey) || privateKey.length !== 43) return null;
  return { publicKey, privateKey, subject };
}

export function isPushConfigured(env: Env = process.env): boolean {
  return readVapidConfig(env) !== null;
}
