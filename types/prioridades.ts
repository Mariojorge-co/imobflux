import type { ContactClassification } from "./contacts";

export type PriorityClient = {
  classification: ContactClassification;
  created_at: string;
  display_name: string;
  id: string;
  updated_at: string;
};

export type PrioritySummaryId =
  | "pending-qualification"
  | "without-phone"
  | "stale-leads"
  | "new-contacts";

export type PrioritySummaryItem = {
  context: string;
  id: PrioritySummaryId;
  title: string;
  value: number;
};

export type PrioridadesDashboardResult = {
  new_contacts: { count: number; items: PriorityClient[] };
  pending_qualification: { count: number; items: PriorityClient[] };
  stale_leads: { count: number; items: PriorityClient[] };
  without_phone: { count: number; items: PriorityClient[] };
};
