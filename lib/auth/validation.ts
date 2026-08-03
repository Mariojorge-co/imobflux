export type AuthActionState = {
  message: string;
  status: "idle" | "error" | "success";
};

export const initialAuthActionState: AuthActionState = {
  message: "",
  status: "idle",
};

export type LoginInput = {
  email: string;
  password: string;
};

export type SetupInput = LoginInput & {
  bootstrapToken: string;
  displayName: string;
  workspaceName: string;
};

function readRequiredText(formData: FormData, field: string) {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validateLoginForm(formData: FormData): LoginInput | null {
  const email = normalizeEmail(readRequiredText(formData, "email"));
  const passwordValue = formData.get("password");
  const password = typeof passwordValue === "string" ? passwordValue : "";

  if (!email || !isEmail(email) || !password) {
    return null;
  }

  return { email, password };
}

export function validateSetupForm(formData: FormData): SetupInput | null {
  const login = validateLoginForm(formData);
  const bootstrapTokenValue = formData.get("bootstrapToken");
  const bootstrapToken =
    typeof bootstrapTokenValue === "string" ? bootstrapTokenValue : "";
  const displayName = readRequiredText(formData, "displayName");
  const workspaceName = readRequiredText(formData, "workspaceName");

  if (!login || !bootstrapToken || !displayName || !workspaceName) {
    return null;
  }

  return {
    ...login,
    bootstrapToken,
    displayName,
    workspaceName,
  };
}
