export type NormalizedBrazilianPhone = {
  displayValue: string;
  normalizedValue: string;
};

/** Normalizes the Brazilian phone formats accepted by the first Contacts MVP. */
export function normalizeBrazilianPhone(
  value: string,
): NormalizedBrazilianPhone | null {
  const displayValue = value.trim();

  if (!displayValue) {
    return null;
  }

  const digits = displayValue.replace(/\D/g, "");
  const hasExplicitInternationalPrefix = displayValue.startsWith("+");
  const nationalNumber = hasExplicitInternationalPrefix
    ? (digits.length === 12 || digits.length === 13) &&
        digits.startsWith("55") &&
        (digits.length - 2 === 10 || digits.length - 2 === 11)
      ? digits.slice(2)
      : null
    : (digits.length === 10 || digits.length === 11) && digits
      ? digits
      : null;

  if (!nationalNumber) {
    return null;
  }

  return {
    displayValue,
    normalizedValue: `+55${nationalNumber}`,
  };
}

export function looksLikePhoneSearch(value: string) {
  return /^[+\d\s().-]+$/.test(value.trim());
}
