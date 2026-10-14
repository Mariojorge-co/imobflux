import { expect, test } from "@playwright/test";
import { classifyGatewayOutcome, isLocalGatewayBypassAllowed } from "@/lib/conversations/gateway-outcome";

const NOT_CONFIGURED = { success: false as const, code: "MISSING_ENV_CONFIG", error: "ausente" };

test("aceite real do gateway é a única fonte de sucesso em qualquer ambiente", () => {
  for (const NODE_ENV of ["production", "development", "test", undefined]) {
    expect(classifyGatewayOutcome({ success: true }, { NODE_ENV })).toEqual({ deliver: true, source: "gateway" });
  }
});

test("produção nunca contorna 'gateway não configurado', mesmo com flag de demo", () => {
  for (const [code, expected] of [["MISSING_ENV_CONFIG", "GATEWAY_NOT_CONFIGURED"], ["MISSING_INSTANCE", "NO_INSTANCE"]]) {
    const outcome = classifyGatewayOutcome(
      { success: false, code },
      { NODE_ENV: "production", NEXT_PUBLIC_DEMO_MODE: "true" },
    );
    expect(outcome).toMatchObject({ deliver: false, code: expected });
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
  const expected: Array<[string | undefined, string]> = [
    ["HTTP_400", "EVOLUTION_REJECTED"], ["HTTP_401", "EVOLUTION_REJECTED"], ["HTTP_500", "EVOLUTION_REJECTED"],
    ["TIMEOUT", "GATEWAY_TIMEOUT"], ["NETWORK_ERROR", "GATEWAY_NETWORK"], ["INVALID_PHONE", "INVALID_RECIPIENT"],
    ["WHATSAPP_DISCONNECTED", "WHATSAPP_DISCONNECTED"],
    ["INVALID_JSON_RESPONSE", "GATEWAY_ERROR"], ["MISSING_EXTERNAL_ID", "GATEWAY_ERROR"], ["UNKNOWN", "GATEWAY_ERROR"], [undefined, "GATEWAY_ERROR"],
  ];
  for (const [code, outcomeCode] of expected) {
    const outcome = classifyGatewayOutcome({ success: false, code }, env);
    expect(outcome).toMatchObject({ deliver: false, code: outcomeCode });
  }
  expect(classifyGatewayOutcome({ success: false, code: "NETWORK_ERROR" }, env)).toMatchObject({
    deliver: false,
    error: "Não foi possível falar com o WhatsApp agora (falha de rede). A mensagem não foi enviada. Tente novamente em instantes.",
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
