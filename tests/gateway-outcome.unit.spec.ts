import { expect, test } from "@playwright/test";
import { classifyGatewayOutcome, isLocalGatewayBypassAllowed } from "@/lib/conversations/gateway-outcome";

const NOT_CONFIGURED = { success: false as const, code: "MISSING_ENV_CONFIG", error: "ausente" };

test("aceite real do gateway é a única fonte de sucesso em qualquer ambiente", () => {
  for (const NODE_ENV of ["production", "development", "test", undefined]) {
    expect(classifyGatewayOutcome({ success: true }, { NODE_ENV })).toEqual({ deliver: true, source: "gateway" });
  }
});

test("produção nunca contorna 'gateway não configurado', mesmo com flag de demo", () => {
  for (const code of ["MISSING_ENV_CONFIG", "MISSING_INSTANCE"]) {
    const outcome = classifyGatewayOutcome(
      { success: false, code },
      { NODE_ENV: "production", NEXT_PUBLIC_DEMO_MODE: "true" },
    );
    expect(outcome).toMatchObject({ deliver: false, code: "GATEWAY_NOT_CONFIGURED" });
  }
});

test("contorno local só existe em desenvolvimento ou demo fora de produção", () => {
  expect(isLocalGatewayBypassAllowed({ NODE_ENV: "development" })).toBe(true);
  expect(isLocalGatewayBypassAllowed({ NODE_ENV: "test", NEXT_PUBLIC_DEMO_MODE: "true" })).toBe(true);
  expect(isLocalGatewayBypassAllowed({ NODE_ENV: "test" })).toBe(false);
  expect(isLocalGatewayBypassAllowed({ NODE_ENV: "production", NEXT_PUBLIC_DEMO_MODE: "true" })).toBe(false);
  expect(classifyGatewayOutcome(NOT_CONFIGURED, { NODE_ENV: "development" })).toEqual({ deliver: true, source: "local_bypass" });
});

test("falhas reais nunca viram envio, nem em desenvolvimento, e têm mensagem honesta", () => {
  const env = { NODE_ENV: "development", NEXT_PUBLIC_DEMO_MODE: "true" };
  for (const code of ["HTTP_400", "HTTP_500", "INVALID_JSON_RESPONSE", "MISSING_EXTERNAL_ID", "INVALID_PHONE", "UNKNOWN", undefined]) {
    const outcome = classifyGatewayOutcome({ success: false, code }, env);
    expect(outcome).toMatchObject({ deliver: false, code: "GATEWAY_ERROR" });
  }
  expect(classifyGatewayOutcome({ success: false, code: "TIMEOUT" }, env)).toMatchObject({
    deliver: false,
    error: "Não foi possível falar com o WhatsApp agora. A mensagem não foi enviada.",
  });
});

test("os códigos tratados como 'não configurado' são exatamente os que o gateway devolve", async () => {
  // Evita a regressão original: a action procurava códigos que o gateway nunca emitia.
  const { readFileSync } = await import("node:fs");
  const gatewaySource = readFileSync("lib/supabase/gateway.ts", "utf8");
  for (const code of ["MISSING_ENV_CONFIG", "MISSING_INSTANCE"]) {
    expect(gatewaySource).toContain(`"${code}"`);
  }
});
