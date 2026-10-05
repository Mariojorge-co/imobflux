export type NormalizedPhone = {
  displayValue: string;
  normalizedValue: string;
};

/** Backwards-compatible name for callers that only handled Brazilian numbers. */
export type NormalizedBrazilianPhone = NormalizedPhone;

/**
 * Normalizes a manually entered phone to an E.164 identity.
 *
 * Numbers without an explicit international prefix use Brazil (+55) as the
 * default and therefore must contain a Brazilian DDD plus 8 or 9 digits.
 * Explicit international numbers may contain formatting punctuation and must
 * contain 8–15 digits after the leading plus, as required by E.164.
 */
export function normalizeBrazilianPhone(
  value: string,
): NormalizedPhone | null {
  const displayValue = value.trim();

  if (!displayValue) {
    return null;
  }

  const hasExplicitInternationalPrefix = displayValue.startsWith("+");
  const digits = displayValue.replace(/[\s().-]/g, "");

  if (hasExplicitInternationalPrefix) {
    const internationalDigits = digits.slice(1);
    if (!/^[1-9][0-9]{7,14}$/.test(internationalDigits)) {
      return null;
    }

    return {
      displayValue,
      normalizedValue: `+${internationalDigits}`,
    };
  }

  if (!/^[0-9]+$/.test(digits) || ![10, 11].includes(digits.length)) {
    return null;
  }

  return {
    displayValue,
    normalizedValue: `+55${digits}`,
  };
}

export function looksLikePhoneSearch(value: string) {
  return /^[+\d\s().-]+$/.test(value.trim());
}
