"use server";

import { continueEmailFlow } from "@/lib/auth/continue-email-flow";

export async function continueRecoveryAction() {
  await continueEmailFlow();
}
