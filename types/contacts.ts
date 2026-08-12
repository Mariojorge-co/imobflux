export type ContactClassification = "person" | "lead" | "client";
export type ContactOperationalStatus = "active" | "inactive";

export type ContactListItem = {
  archivedAt: string | null;
  classification: ContactClassification;
  displayName: string;
  hasMultipleActivePhones: boolean;
  id: string;
  operationalStatus: ContactOperationalStatus;
  phoneDisplayValue: string | null;
  avatarUrl: string | null;
  isProtected: boolean;
};

export type ContactListFilters = {
  archived: boolean;
  classification: ContactClassification | null;
  page: number;
  query: string;
  status: ContactOperationalStatus | null;
};

export type ContactListResult = {
  contacts: ContactListItem[];
  page: number;
  total: number;
};

export type ContactFormValues = {
  classification: ContactClassification;
  displayName: string;
  phone: string;
};

export type ContactActionState = {
  contactId?: string;
  message: string;
  status: "error" | "idle" | "success";
};

export const initialContactActionState: ContactActionState = {
  message: "",
  status: "idle",
};
