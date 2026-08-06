export type ContactClassification = "person" | "lead" | "client";

export interface KanbanCard {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  contact_id: string;
  contact_name: string;
  contact_classification: ContactClassification;
  responsible_member_id: string | null;
  responsible_name: string | null;
  has_linked_conversation?: boolean;
  linked_conversation_id?: string | null;
}

export interface KanbanStage {
  id: string;
  name: string;
  position: number;
  commercial_meaning: string | null;
  total_count: number;
  has_more: boolean;
  cards: KanbanCard[];
}

export interface CreateOpportunityInput {
  contactId: string;
  stageId: string;
  title: string;
  description?: string;
  responsibleMemberId?: string;
}

export interface UpdateOpportunityInput {
  opportunityId: string;
  title: string;
  description?: string;
  stageId?: string;
  contactId?: string;
  responsibleMemberId?: string;
}

export type MoveOpportunityResult =
  | { success: true; status: "success" | "no_change"; opportunityId: string }
  | {
      success: false;
      code: "CONFLICT" | "UNAUTHORIZED" | "VALIDATION_ERROR" | "INTERNAL_ERROR";
      error: string;
    };

export type CreateOpportunityResult =
  | { success: true; opportunityId: string; opportunity?: KanbanCard }
  | { success: false; error: string };

export type UpdateOpportunityResult =
  | { success: true; opportunityId: string }
  | {
      success: false;
      code?: "CONTACT_CHANGE_BLOCKED_BY_CONVERSATION" | "UNAUTHORIZED" | "VALIDATION_ERROR" | "INTERNAL_ERROR";
      error: string;
    };

export type ArchiveOpportunityResult =
  | { success: true; opportunityId: string }
  | {
      success: false;
      code?: "UNAUTHORIZED" | "ONLY_OWNER_CAN_ARCHIVE" | "INTERNAL_ERROR";
      error: string;
    };

export type OpenOrCreateConversationResult =
  | { success: true; status: "success" | "linked" | "created"; conversationId: string }
  | {
      success: false;
      code: "NO_ELIGIBLE_CONVERSATION" | "UNAUTHORIZED" | "INTERNAL_ERROR";
      error: string;
    };
