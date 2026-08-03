import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function isValidBootstrapToken(candidate: string) {
  const expected = process.env.IMOBFLUX_BOOTSTRAP_TOKEN;

  if (!expected || expected.length < 32 || !candidate) {
    return false;
  }

  return timingSafeEqual(digest(candidate), digest(expected));
}

export async function assertTrustedServerActionOrigin() {
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0];
  const host = forwardedHost?.trim() || requestHeaders.get("host");

  if (!origin || !host) {
    throw new Error("Origem da operação não permitida.");
  }

  let originHost: string;

  try {
    originHost = new URL(origin).host;
  } catch {
    throw new Error("Origem da operação não permitida.");
  }

  if (originHost.toLocaleLowerCase("en-US") !== host.toLocaleLowerCase("en-US")) {
    throw new Error("Origem da operação não permitida.");
  }
}
