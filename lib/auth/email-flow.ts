import "server-only";

export type AuthFlowError = "expired" | "invalid" | "technical";
type AuthFailure = { code?: string; status?: number } | null;

export function classifyAuthFailure(error: AuthFailure): AuthFlowError {
  if (error?.code === "otp_expired") return "expired";
  if (error?.status === 429 || !error?.status || error.status >= 500) return "technical";
  return "invalid";
}

// Never log SDK messages, recipients, URLs, headers or entire exceptions.
export function logAuthFailure(operation: string, error?: AuthFailure) {
  const status = Number.isInteger(error?.status) ? error?.status : 0;
  console.warn("[auth-flow]", { operation, status, category: status === 429 ? "rate_limit" : classifyAuthFailure(error ?? null) });
}

export function authFlowErrorMessage(error: string | undefined) {
  if (error === "expired") return "Este link expirou ou já foi utilizado. Solicite um novo acesso.";
  if (error === "invitation_expired") return "Este convite expirou. Peça ao responsável pela equipe para reenviar.";
  if (error === "technical") return "Não foi possível verificar seu acesso agora. Tente novamente mais tarde.";
  return "Este link é inválido ou já foi utilizado. Solicite um novo acesso.";
}
