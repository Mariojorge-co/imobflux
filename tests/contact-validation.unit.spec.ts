import { expect, test } from "@playwright/test";
import { normalizeBrazilianPhone } from "@/lib/contacts/phone";
import { validateContactForm } from "@/lib/contacts/validation";

function contactForm(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const values = {
    classification: "lead",
    displayName: "Contato de teste",
    phone: "",
    ...overrides,
  };

  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }

  return formData;
}

test("normalizes a national ten-digit Brazilian landline without changing its digits", () => {
  expect(normalizeBrazilianPhone("(82) 3333-4444")).toEqual({
    displayValue: "(82) 3333-4444",
    normalizedValue: "+558233334444",
  });
});

test("normalizes +55 with ten national digits", () => {
  expect(normalizeBrazilianPhone("+55 (82) 3333-4444")).toEqual({
    displayValue: "+55 (82) 3333-4444",
    normalizedValue: "+558233334444",
  });
});

test("normalizes +55 with eleven national digits", () => {
  expect(normalizeBrazilianPhone("+55 (82) 99999-0001")).toEqual({
    displayValue: "+55 (82) 99999-0001",
    normalizedValue: "+5582999990001",
  });
});

test("accepts an explicit +1 international prefix", () => {
  expect(normalizeBrazilianPhone("+1 212 555 0199")).toEqual({
    displayValue: "+1 212 555 0199",
    normalizedValue: "+12125550199",
  });
});

test("accepts another explicit international prefix in E.164 form", () => {
  expect(normalizeBrazilianPhone("+44 20 7946 0958")).toEqual({
    displayValue: "+44 20 7946 0958",
    normalizedValue: "+442079460958",
  });
});

test("accepts an international E.164 number with formatting", () => {
  expect(normalizeBrazilianPhone("+1 (212) 555-0199")).toEqual({
    displayValue: "+1 (212) 555-0199",
    normalizedValue: "+12125550199",
  });
});

test("rejects international numbers outside the E.164 digit limit", () => {
  expect(normalizeBrazilianPhone("+1234567890123456")).toBeNull();
});

test("rejects invalid phone sizes", () => {
  expect(normalizeBrazilianPhone("(82) 999-0001")).toBeNull();
  expect(normalizeBrazilianPhone("+55 82 999-0001")).toBeNull();
});

test("accepts a contact with the optional phone omitted", () => {
  expect(validateContactForm(contactForm())).toEqual({
    classification: "lead",
    displayName: "Contato de teste",
    phone: null,
  });
});

test("rejects an empty contact name and invalid classification", () => {
  expect(validateContactForm(contactForm({ displayName: "   " }))).toBe("name");
  expect(validateContactForm(contactForm({ classification: "owner" }))).toBe(
    "classification",
  );
});

test("rejects invalid Brazilian phones before the RPC", () => {
  expect(validateContactForm(contactForm({ phone: "+551234" }))).toBe("phone");
});

test("rejects privacy and authorization fields submitted by the client", () => {
  const formData = contactForm({ isProtected: "true" });
  formData.set("workspaceId", "00000000-0000-4000-8000-000000000000");

  expect(validateContactForm(formData)).toBe("forbidden_field");
});
