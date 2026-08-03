import {
  normalizeBrazilianPhone,
  type NormalizedBrazilianPhone,
} from "@/lib/contacts/phone";
import type {
  ContactClassification,
  ContactFormValues,
  ContactOperationalStatus,
} from "@/types/contacts";

const classifications = new Set<ContactClassification>([
  "person",
  "lead",
  "client",
]);

const statuses = new Set<ContactOperationalStatus>(["active", "inactive"]);

export type ValidatedContactInput = Omit<ContactFormValues, "phone"> & {
  phone: NormalizedBrazilianPhone | null;
};

export type ContactValidationError =
  | "classification"
  | "forbidden_field"
  | "name"
  | "phone";

function readText(formData: FormData, field: string) {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function containsForbiddenField(formData: FormData) {
  const forbiddenFields = new Set([
    "isProtected",
    "is_protected",
    "memberId",
    "member_id",
    "workspaceId",
    "workspace_id",
  ]);

  return [...formData.keys()].some((field) => forbiddenFields.has(field));
}

export function validateContactForm(
  formData: FormData,
): ValidatedContactInput | ContactValidationError {
  if (containsForbiddenField(formData)) {
    return "forbidden_field";
  }

  const displayName = readText(formData, "displayName");
  const classification = readText(formData, "classification");
  const phoneValue = readText(formData, "phone");

  if (!displayName) {
    return "name";
  }

  if (!classifications.has(classification as ContactClassification)) {
    return "classification";
  }

  const phone = phoneValue ? normalizeBrazilianPhone(phoneValue) : null;

  if (phoneValue && !phone) {
    return "phone";
  }

  return {
    classification: classification as ContactClassification,
    displayName,
    phone,
  };
}

export function isContactValidationError(
  value: ValidatedContactInput | ContactValidationError,
): value is ContactValidationError {
  return typeof value === "string";
}

export function isContactId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function isContactOperationalStatus(
  value: string,
): value is ContactOperationalStatus {
  return statuses.has(value as ContactOperationalStatus);
}
