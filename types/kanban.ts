export type ContactClassification = "person" | "lead" | "client";
export type OpportunityStatus = "open" | "won" | "lost" | "rework" | "cancelled";
export type FinancialAnalysisStatus = "not_analyzed" | "in_analysis" | "approved" | "conditioned" | "rejected";
export type DocumentationStatus = "not_sent" | "pending" | "complete";

export interface KanbanCard {
  id: string;
  title: string;
  description: string | null;
  origin?: string | null;
  property_summary?: string | null;
  operation_type?: string | null;
  property_type_preference?: string | null;
  city_region_preference?: string | null;
  value_range_preference?: string | null;
  down_payment_available?: number | null;
  timeframe_intent?: string | null;
  preferences_notes?: string | null;
  family_income?: number | null;
  financial_analysis_status?: FinancialAnalysisStatus | null;
  approved_amount?: number | null;
  financial_notes?: string | null;
  documentation_status?: DocumentationStatus | null;
  rework_reason?: string | null;
  rework_reevaluation_date?: string | null;
  loss_reason?: string | null;
  loss_notes?: string | null;
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
  origin?: string;
  propertySummary?: string;
  operationType?: string;
  propertyTypePreference?: string;
  cityRegionPreference?: string;
  valueRangePreference?: string;
  downPaymentAvailable?: number;
  timeframeIntent?: string;
  preferencesNotes?: string;
}

export interface UpdateOpportunityInput {
  opportunityId: string;
  title: string;
  description?: string;
  stageId?: string;
  contactId?: string;
  responsibleMemberId?: string;
  propertySummary?: string;
  operationType?: string;
  propertyTypePreference?: string;
  cityRegionPreference?: string;
  valueRangePreference?: string;
  downPaymentAvailable?: number;
  timeframeIntent?: string;
  preferencesNotes?: string;
  familyIncome?: number;
  financialAnalysisStatus?: FinancialAnalysisStatus;
  approvedAmount?: number;
  financialNotes?: string;
  documentationStatus?: DocumentationStatus;
}

export interface SetReworkInput {
  opportunityId: string;
  reworkReason: string;
  reworkReevaluationDate?: string;
}

export interface CloseWonInput {
  opportunityId: string;
  businessValue?: number;
  commissionExpected?: number;
  commissionReceived?: number;
}

export interface CloseLostInput {
  opportunityId: string;
  lossReason: string;
  lossNotes?: string;
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

export type SetReworkResult =
  | { success: true; opportunityId: string }
  | { success: false; error: string };

export type ReactivateResult =
  | { success: true; opportunityId: string }
  | { success: false; error: string };

export type CloseOpportunityResult =
  | { success: true; opportunityId: string }
  | { success: false; code?: "ONLY_OWNER_CAN_MANAGE_COMMISSIONS" | "UNAUTHORIZED" | "INTERNAL_ERROR"; error: string };

export type OpenOrCreateConversationResult =
  | { success: true; status: "success" | "linked" | "created"; conversationId: string }
  | {
      success: false;
      code: "NO_ELIGIBLE_CONVERSATION" | "UNAUTHORIZED" | "INTERNAL_ERROR";
      error: string;
    };
