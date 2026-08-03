export type Json =
  | boolean
  | number
  | string
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type AppUserRow = {
  auth_user_id: string | null;
  created_at: string;
  deactivated_at: string | null;
  display_name: string;
  id: string;
  status: "active" | "inactive";
  updated_at: string;
};

type WorkspaceRow = {
  closed_at: string | null;
  created_at: string;
  id: string;
  name: string;
  status: "active" | "suspended" | "closed";
  timezone: string;
  updated_at: string;
};

type WorkspaceMemberRow = {
  activated_at: string | null;
  created_at: string;
  id: string;
  invitation_expires_at: string | null;
  invited_at: string | null;
  invited_by_member_id: string | null;
  invited_email_normalized: string | null;
  removed_at: string | null;
  role: "owner" | "attendant";
  status: "invited" | "active" | "suspended" | "removed";
  suspended_at: string | null;
  updated_at: string;
  user_id: string | null;
  workspace_id: string;
};

type ContactRow = {
  archived_at: string | null;
  classification: "person" | "lead" | "client";
  commercial_visible_from: string | null;
  created_at: string;
  display_name: string;
  id: string;
  inactive_at: string | null;
  is_protected: boolean;
  operational_status: "active" | "inactive";
  protected_at: string | null;
  updated_at: string;
  workspace_id: string;
};

type ContactPointRow = {
  commercial_visible_from: string | null;
  contact_id: string | null;
  created_at: string;
  display_value: string | null;
  external_display_name: string | null;
  id: string;
  inactive_at: string | null;
  is_protected: boolean;
  normalized_value: string;
  operational_status: "active" | "inactive";
  point_type: "phone" | "external_identifier";
  protected_at: string | null;
  updated_at: string;
  workspace_id: string;
};

type AuditEventRow = {
  action: string;
  actor_member_id: string | null;
  actor_type: "member" | "system";
  correlation_id: string | null;
  id: string;
  metadata: Json;
  occurred_at: string;
  recorded_at: string;
  result: "success" | "denied" | "failed";
  target_id: string | null;
  target_type: string;
  workspace_id: string;
};

type TableDefinition<Row> = {
  Insert: Partial<Row>;
  Relationships: [];
  Row: Row;
  Update: Partial<Row>;
};

export type BootstrapDatabaseResult = {
  app_user_id: string;
  workspace_id: string;
  workspace_member_id: string;
};

export type Database = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: {
      bootstrap_initial_workspace: {
        Args: {
          p_auth_user_id: string;
          p_display_name: string;
          p_timezone: string;
          p_workspace_name: string;
        };
        Returns: BootstrapDatabaseResult[];
      };
      archive_contact: {
        Args: { p_contact_id: string };
        Returns: string;
      };
      create_contact: {
        Args: {
          p_classification: ContactRow["classification"];
          p_display_name: string;
          p_phone_display_value?: string | null;
          p_phone_normalized?: string | null;
        };
        Returns: string;
      };
      restore_contact: {
        Args: { p_contact_id: string };
        Returns: string;
      };
      set_contact_operational_status: {
        Args: {
          p_contact_id: string;
          p_operational_status: ContactRow["operational_status"];
        };
        Returns: string;
      };
      update_contact: {
        Args: {
          p_classification: ContactRow["classification"];
          p_contact_id: string;
          p_display_name: string;
          p_phone_display_value?: string | null;
          p_phone_normalized?: string | null;
        };
        Returns: string;
      };
    };
    Tables: {
      app_users: TableDefinition<AppUserRow>;
      audit_events: TableDefinition<AuditEventRow>;
      contact_points: TableDefinition<ContactPointRow>;
      contacts: TableDefinition<ContactRow>;
      workspace_members: TableDefinition<WorkspaceMemberRow>;
      workspaces: TableDefinition<WorkspaceRow>;
    };
    Views: Record<string, never>;
  };
};
