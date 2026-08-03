"use server";

import { revalidatePath } from "next/cache";
import {
  isContactId,
  isContactOperationalStatus,
  isContactValidationError,
  validateContactForm,
} from "@/lib/contacts/validation";
import { requireActiveAccess } from "@/lib/auth/dal";
import { assertTrustedServerActionOrigin } from "@/lib/auth/security";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { ContactActionState } from "@/types/contacts";

const invalidOperationMessage = "Não foi possível validar esta operação.";

function success(message: string, contactId: string): ContactActionState {
  revalidatePath("/contatos");
  return { contactId, message, status: "success" };
}

function validationErrorMessage(error: string) {
  const messages = {
    classification: "Selecione uma classificação válida.",
    forbidden_field: invalidOperationMessage,
    name: "Informe o nome do contato.",
    phone: "Informe um telefone brasileiro válido com DDD.",
  } as const;

  return messages[error as keyof typeof messages] ?? invalidOperationMessage;
}

function mapDatabaseError(error: { code?: string; message?: string }) {
  if (error.code === "23505" && error.message === "contact_phone_duplicate") {
    return "Este telefone já está cadastrado neste workspace.";
  }

  if (error.code === "22023") {
    return invalidOperationMessage;
  }

  if (error.code === "42501") {
    return "Sua sessão não possui permissão para esta operação.";
  }

  if (
    error.code === "P0001" &&
    ["contact_not_found", "contact_phone_state_unsupported"].includes(
      error.message ?? "",
    )
  ) {
    return "Não foi possível localizar um contato disponível para esta operação.";
  }

  return "Não foi possível concluir a operação. Tente novamente.";
}

async function prepareContactAction() {
  try {
    await assertTrustedServerActionOrigin();
    await requireActiveAccess();
    return await createServerSupabaseClient();
  } catch {
    return null;
  }
}

export async function createContactAction(
  _previousState: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const input = validateContactForm(formData);

  if (isContactValidationError(input)) {
    return { message: validationErrorMessage(input), status: "error" };
  }

  const supabase = await prepareContactAction();

  if (!supabase) {
    return { message: invalidOperationMessage, status: "error" };
  }

  const { data, error } = await supabase.rpc("create_contact", {
    p_classification: input.classification,
    p_display_name: input.displayName,
    p_phone_display_value: input.phone?.displayValue ?? null,
    p_phone_normalized: input.phone?.normalizedValue ?? null,
  });

  if (error || !data) {
    return {
      message: mapDatabaseError(error ?? {}),
      status: "error",
    };
  }

  return success("Contato cadastrado com sucesso.", data);
}

export async function updateContactAction(
  _previousState: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const contactId = formData.get("contactId");
  const input = validateContactForm(formData);

  if (typeof contactId !== "string" || !isContactId(contactId)) {
    return { message: invalidOperationMessage, status: "error" };
  }

  if (isContactValidationError(input)) {
    return { message: validationErrorMessage(input), status: "error" };
  }

  const supabase = await prepareContactAction();

  if (!supabase) {
    return { message: invalidOperationMessage, status: "error" };
  }

  const { data, error } = await supabase.rpc("update_contact", {
    p_classification: input.classification,
    p_contact_id: contactId,
    p_display_name: input.displayName,
    p_phone_display_value: input.phone?.displayValue ?? null,
    p_phone_normalized: input.phone?.normalizedValue ?? null,
  });

  if (error || !data) {
    return {
      message: mapDatabaseError(error ?? {}),
      status: "error",
    };
  }

  return success("Contato atualizado com sucesso.", data);
}

export async function changeContactStatusAction(
  _previousState: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const contactId = formData.get("contactId");
  const status = formData.get("status");

  if (
    typeof contactId !== "string" ||
    !isContactId(contactId) ||
    typeof status !== "string" ||
    !isContactOperationalStatus(status)
  ) {
    return { message: invalidOperationMessage, status: "error" };
  }

  const supabase = await prepareContactAction();

  if (!supabase) {
    return { message: invalidOperationMessage, status: "error" };
  }

  const { data, error } = await supabase.rpc("set_contact_operational_status", {
    p_contact_id: contactId,
    p_operational_status: status,
  });

  if (error || !data) {
    return {
      message: mapDatabaseError(error ?? {}),
      status: "error",
    };
  }

  return success(
    status === "inactive" ? "Contato inativado." : "Contato reativado.",
    data,
  );
}

export async function archiveContactAction(
  _previousState: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  return executeContactLifecycleAction(
    formData,
    "archive_contact",
    "Contato arquivado.",
  );
}

export async function restoreContactAction(
  _previousState: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  return executeContactLifecycleAction(
    formData,
    "restore_contact",
    "Contato restaurado.",
  );
}

async function executeContactLifecycleAction(
  formData: FormData,
  operation: "archive_contact" | "restore_contact",
  message: string,
): Promise<ContactActionState> {
  const contactId = formData.get("contactId");

  if (typeof contactId !== "string" || !isContactId(contactId)) {
    return { message: invalidOperationMessage, status: "error" };
  }

  const supabase = await prepareContactAction();

  if (!supabase) {
    return { message: invalidOperationMessage, status: "error" };
  }

  const { data, error } = await supabase.rpc(operation, {
    p_contact_id: contactId,
  });

  if (error || !data) {
    return {
      message: mapDatabaseError(error ?? {}),
      status: "error",
    };
  }

  return success(message, data);
}
