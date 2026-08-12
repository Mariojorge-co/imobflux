import type { ContactClassification } from "./contacts";

export type PriorityClient = {
  classification: ContactClassification;
  created_at: string;
  display_name: string;
  id: string;
  updated_at: string;
  conversation_id?: string;
  sla_text?: string;
  sla_level?: string;
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
  due_followups: Array<{
    id: string;
    title: string;
    due_at: string;
    contact_id: string;
    conversation_id: string | null;
    opportunity_id: string | null;
    display_name: string;
  }>;
};
