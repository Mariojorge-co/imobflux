export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_users: {
        Row: {
          auth_user_id: string | null
          created_at: string
          deactivated_at: string | null
          display_name: string
          id: string
          status: string
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          deactivated_at?: string | null
          display_name: string
          id?: string
          status: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          deactivated_at?: string | null
          display_name?: string
          id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      attachments: {
        Row: {
          archived_at: string | null
          available_at: string | null
          created_at: string
          id: string
          message_id: string
          mime_type: string
          original_file_name: string
          sha256: string | null
          size_bytes: number
          status: string
          storage_bucket: string
          storage_key: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          available_at?: string | null
          created_at?: string
          id?: string
          message_id: string
          mime_type: string
          original_file_name: string
          sha256?: string | null
          size_bytes: number
          status: string
          storage_bucket: string
          storage_key: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          available_at?: string | null
          created_at?: string
          id?: string
          message_id?: string
          mime_type?: string
          original_file_name?: string
          sha256?: string | null
          size_bytes?: number
          status?: string
          storage_bucket?: string
          storage_key?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_attachments_message"
            columns: ["workspace_id", "message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_attachments_workspace"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_member_id: string | null
          actor_type: string
          correlation_id: string | null
          id: string
          metadata: Json
          occurred_at: string
          recorded_at: string
          result: string
          target_id: string | null
          target_type: string
          workspace_id: string
        }
        Insert: {
          action: string
          actor_member_id?: string | null
          actor_type: string
          correlation_id?: string | null
          id?: string
          metadata?: Json
          occurred_at: string
          recorded_at?: string
          result: string
          target_id?: string | null
          target_type: string
          workspace_id: string
        }
        Update: {
          action?: string
          actor_member_id?: string | null
          actor_type?: string
          correlation_id?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          recorded_at?: string
          result?: string
          target_id?: string | null
          target_type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_audit_events_actor_member"
            columns: ["workspace_id", "actor_member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_audit_events_workspace"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_connections: {
        Row: {
          activated_at: string | null
          created_at: string
          credential_reference: string | null
          disconnected_at: string | null
          display_name: string | null
          external_account_id: string
          external_phone_normalized: string | null
          id: string
          paused_at: string | null
          provider: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          credential_reference?: string | null
          disconnected_at?: string | null
          display_name?: string | null
          external_account_id: string
          external_phone_normalized?: string | null
          id?: string
          paused_at?: string | null
          provider: string
          status: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          credential_reference?: string | null
          disconnected_at?: string | null
          display_name?: string | null
          external_account_id?: string
          external_phone_normalized?: string | null
          id?: string
          paused_at?: string | null
          provider?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_channel_connections_workspace"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_points: {
        Row: {
          commercial_visible_from: string | null
          contact_id: string | null
          created_at: string
          display_value: string | null
          external_display_name: string | null
          external_avatar_url: string | null
          id: string
          inactive_at: string | null
          is_protected: boolean
          normalized_value: string
          operational_status: string
          point_type: string
          protected_at: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          commercial_visible_from?: string | null
          contact_id?: string | null
          created_at?: string
          display_value?: string | null
          external_display_name?: string | null
          external_avatar_url?: string | null
          id?: string
          inactive_at?: string | null
          is_protected?: boolean
          normalized_value: string
          operational_status: string
          point_type: string
          protected_at?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          commercial_visible_from?: string | null
          contact_id?: string | null
          created_at?: string
          display_value?: string | null
          external_display_name?: string | null
          external_avatar_url?: string | null
          id?: string
          inactive_at?: string | null
          is_protected?: boolean
          normalized_value?: string
          operational_status?: string
          point_type?: string
          protected_at?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_contact_points_contact"
            columns: ["workspace_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_contact_points_workspace"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          archived_at: string | null
          classification: string
          commercial_visible_from: string | null
          created_at: string
          display_name: string
          id: string
          inactive_at: string | null
          is_protected: boolean
          operational_status: string
          protected_at: string | null
          registration_status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          classification: string
          commercial_visible_from?: string | null
          created_at?: string
          display_name: string
          id?: string
          inactive_at?: string | null
          is_protected?: boolean
          operational_status: string
          protected_at?: string | null
          registration_status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          classification?: string
          commercial_visible_from?: string | null
          created_at?: string
          display_name?: string
          id?: string
          inactive_at?: string | null
          is_protected?: boolean
          operational_status?: string
          protected_at?: string | null
          registration_status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_contacts_workspace"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_assignments: {
        Row: {
          assigned_at: string
          assigned_by_member_id: string
          conversation_id: string
          end_reason: string | null
          ended_at: string | null
          ended_by_member_id: string | null
          id: string
          member_id: string
          workspace_id: string
        }
        Insert: {
          assigned_at: string
          assigned_by_member_id: string
          conversation_id: string
          end_reason?: string | null
          ended_at?: string | null
          ended_by_member_id?: string | null
          id?: string
          member_id: string
          workspace_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by_member_id?: string
          conversation_id?: string
          end_reason?: string | null
          ended_at?: string | null
          ended_by_member_id?: string | null
          id?: string
          member_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_conversation_assignments_assigned_by"
            columns: ["workspace_id", "assigned_by_member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_conversation_assignments_conversation"
            columns: ["workspace_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_conversation_assignments_ended_by"
            columns: ["workspace_id", "ended_by_member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_conversation_assignments_member"
            columns: ["workspace_id", "member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_conversation_assignments_workspace"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          contact_point_id: string | null
          conversation_id: string
          created_at: string
          external_display_name: string | null
          first_seen_at: string
          id: string
          last_seen_at: string | null
          left_at: string | null
          updated_at: string
          workspace_id: string
          workspace_member_id: string | null
        }
        Insert: {
          contact_point_id?: string | null
          conversation_id: string
          created_at?: string
          external_display_name?: string | null
          first_seen_at: string
          id?: string
          last_seen_at?: string | null
          left_at?: string | null
          updated_at?: string
          workspace_id: string
          workspace_member_id?: string | null
        }
        Update: {
          contact_point_id?: string | null
          conversation_id?: string
          created_at?: string
          external_display_name?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string | null
          left_at?: string | null
          updated_at?: string
          workspace_id?: string
          workspace_member_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_conversation_participants_contact_point"
            columns: ["workspace_id", "contact_point_id"]
            isOneToOne: false
            referencedRelation: "contact_points"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_conversation_participants_conversation"
            columns: ["workspace_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_conversation_participants_member"
            columns: ["workspace_id", "workspace_member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_conversation_participants_workspace"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_read_states: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          is_unread: boolean
          last_read_at: string
          marked_unread_at: string | null
          member_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          is_unread?: boolean
          last_read_at?: string
          marked_unread_at?: string | null
          member_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          is_unread?: boolean
          last_read_at?: string
          marked_unread_at?: string | null
          member_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_conversation_read_states_conversation"
            columns: ["workspace_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_conversation_read_states_member"
            columns: ["workspace_id", "member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_conversation_read_states_workspace"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          archived_at: string | null
          channel_connection_id: string
          commercial_visible_from: string | null
          conversation_type: string
          created_at: string
          external_thread_id: string
          id: string
          operational_status: string
          privacy_changed_at: string | null
          started_at: string
          subject: string | null
          updated_at: string
          visibility: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          channel_connection_id: string
          commercial_visible_from?: string | null
          conversation_type: string
          created_at?: string
          external_thread_id: string
          id?: string
          operational_status: string
          privacy_changed_at?: string | null
          started_at: string
          subject?: string | null
          updated_at?: string
          visibility: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          channel_connection_id?: string
          commercial_visible_from?: string | null
          conversation_type?: string
          created_at?: string
          external_thread_id?: string
          id?: string
          operational_status?: string
          privacy_changed_at?: string | null
          started_at?: string
          subject?: string | null
          updated_at?: string
          visibility?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_conversations_channel_connection"
            columns: ["workspace_id", "channel_connection_id"]
            isOneToOne: false
            referencedRelation: "channel_connections"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_conversations_workspace"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_notes: {
        Row: {
          archived_at: string | null
          author_member_id: string
          contact_id: string | null
          content: string
          conversation_id: string | null
          created_at: string
          id: string
          opportunity_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          author_member_id: string
          contact_id?: string | null
          content: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          opportunity_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          author_member_id?: string
          contact_id?: string | null
          content?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          opportunity_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_internal_notes_author"
            columns: ["workspace_id", "author_member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_internal_notes_contact"
            columns: ["workspace_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_internal_notes_conversation"
            columns: ["workspace_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_internal_notes_opportunity"
            columns: ["workspace_id", "opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_internal_notes_workspace"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          channel_connection_id: string
          client_idempotency_key: string | null
          conversation_id: string
          created_at: string
          direction: string
          external_created_at: string | null
          external_message_id: string | null
          id: string
          internal_author_member_id: string | null
          occurred_at: string
          origin: string
          received_at: string | null
          sender_contact_point_id: string | null
          status: string
          status_updated_at: string | null
          text_content: string | null
          workspace_id: string
        }
        Insert: {
          channel_connection_id: string
          client_idempotency_key?: string | null
          conversation_id: string
          created_at?: string
          direction: string
          external_created_at?: string | null
          external_message_id?: string | null
          id?: string
          internal_author_member_id?: string | null
          occurred_at: string
          origin: string
          received_at?: string | null
          sender_contact_point_id?: string | null
          status: string
          status_updated_at?: string | null
          text_content?: string | null
          workspace_id: string
        }
        Update: {
          channel_connection_id?: string
          client_idempotency_key?: string | null
          conversation_id?: string
          created_at?: string
          direction?: string
          external_created_at?: string | null
          external_message_id?: string | null
          id?: string
          internal_author_member_id?: string | null
          occurred_at?: string
          origin?: string
          received_at?: string | null
          sender_contact_point_id?: string | null
          status?: string
          status_updated_at?: string | null
          text_content?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_messages_channel_connection"
            columns: ["workspace_id", "channel_connection_id"]
            isOneToOne: false
            referencedRelation: "channel_connections"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_messages_conversation"
            columns: [
              "workspace_id",
              "channel_connection_id",
              "conversation_id",
            ]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["workspace_id", "channel_connection_id", "id"]
          },
          {
            foreignKeyName: "fk_messages_internal_author"
            columns: ["workspace_id", "internal_author_member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_messages_sender_contact_point"
            columns: ["workspace_id", "sender_contact_point_id"]
            isOneToOne: false
            referencedRelation: "contact_points"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_messages_workspace"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          approved_amount: number | null
          archived_at: string | null
          city_region_preference: string | null
          closed_at: string | null
          contact_id: string
          created_at: string
          current_stage_id: string
          description: string | null
          documentation_status: string | null
          down_payment_available: number | null
          family_income: number | null
          financial_analysis_status: string | null
          financial_notes: string | null
          id: string
          loss_notes: string | null
          loss_reason: string | null
          operation_type: string | null
          origin: string | null
          preferences_notes: string | null
          property_summary: string | null
          property_type_preference: string | null
          responsible_member_id: string | null
          sort_order: number
          rework_reason: string | null
          rework_reevaluation_date: string | null
          status: string
          timeframe_intent: string | null
          title: string
          updated_at: string
          value_range_preference: string | null
          workspace_id: string
        }
        Insert: {
          approved_amount?: number | null
          archived_at?: string | null
          city_region_preference?: string | null
          closed_at?: string | null
          contact_id: string
          created_at?: string
          current_stage_id: string
          description?: string | null
          documentation_status?: string | null
          down_payment_available?: number | null
          family_income?: number | null
          financial_analysis_status?: string | null
          financial_notes?: string | null
          id?: string
          loss_notes?: string | null
          loss_reason?: string | null
          operation_type?: string | null
          origin?: string | null
          preferences_notes?: string | null
          property_summary?: string | null
          property_type_preference?: string | null
          responsible_member_id?: string | null
          sort_order?: number
          rework_reason?: string | null
          rework_reevaluation_date?: string | null
          status: string
          timeframe_intent?: string | null
          title: string
          updated_at?: string
          value_range_preference?: string | null
          workspace_id: string
        }
        Update: {
          approved_amount?: number | null
          archived_at?: string | null
          city_region_preference?: string | null
          closed_at?: string | null
          contact_id?: string
          created_at?: string
          current_stage_id?: string
          description?: string | null
          documentation_status?: string | null
          down_payment_available?: number | null
          family_income?: number | null
          financial_analysis_status?: string | null
          financial_notes?: string | null
          id?: string
          loss_notes?: string | null
          loss_reason?: string | null
          operation_type?: string | null
          origin?: string | null
          preferences_notes?: string | null
          property_summary?: string | null
          property_type_preference?: string | null
          responsible_member_id?: string | null
          sort_order?: number
          rework_reason?: string | null
          rework_reevaluation_date?: string | null
          status?: string
          timeframe_intent?: string | null
          title?: string
          updated_at?: string
          value_range_preference?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_opportunities_contact"
            columns: ["workspace_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_opportunities_current_stage"
            columns: ["workspace_id", "current_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_opportunities_responsible_member"
            columns: ["workspace_id", "responsible_member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_opportunities_workspace"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_conversations: {
        Row: {
          conversation_id: string
          id: string
          linked_at: string
          linked_by_member_id: string
          opportunity_id: string
          unlinked_at: string | null
          unlinked_by_member_id: string | null
          workspace_id: string
        }
        Insert: {
          conversation_id: string
          id?: string
          linked_at: string
          linked_by_member_id: string
          opportunity_id: string
          unlinked_at?: string | null
          unlinked_by_member_id?: string | null
          workspace_id: string
        }
        Update: {
          conversation_id?: string
          id?: string
          linked_at?: string
          linked_by_member_id?: string
          opportunity_id?: string
          unlinked_at?: string | null
          unlinked_by_member_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_opportunity_conversations_conversation"
            columns: ["workspace_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_opportunity_conversations_linked_by"
            columns: ["workspace_id", "linked_by_member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_opportunity_conversations_opportunity"
            columns: ["workspace_id", "opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_opportunity_conversations_unlinked_by"
            columns: ["workspace_id", "unlinked_by_member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_opportunity_conversations_workspace"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_financials: {
        Row: {
          business_value: number | null
          commission_expected: number | null
          commission_received: number | null
          created_at: string
          id: string
          opportunity_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          business_value?: number | null
          commission_expected?: number | null
          commission_received?: number | null
          created_at?: string
          id?: string
          opportunity_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          business_value?: number | null
          commission_expected?: number | null
          commission_received?: number | null
          created_at?: string
          id?: string
          opportunity_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_opportunity_financials_opportunity"
            columns: ["workspace_id", "opportunity_id"]
            isOneToOne: true
            referencedRelation: "opportunities"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_opportunity_financials_workspace"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_history: {
        Row: {
          changed_at: string
          changed_by_member_id: string
          id: string
          new_stage_id: string
          opportunity_id: string
          previous_stage_id: string | null
          reason: string | null
          workspace_id: string
        }
        Insert: {
          changed_at: string
          changed_by_member_id: string
          id?: string
          new_stage_id: string
          opportunity_id: string
          previous_stage_id?: string | null
          reason?: string | null
          workspace_id: string
        }
        Update: {
          changed_at?: string
          changed_by_member_id?: string
          id?: string
          new_stage_id?: string
          opportunity_id?: string
          previous_stage_id?: string | null
          reason?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_pipeline_history_changed_by"
            columns: ["workspace_id", "changed_by_member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_pipeline_history_new_stage"
            columns: ["workspace_id", "new_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_pipeline_history_opportunity"
            columns: ["workspace_id", "opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_pipeline_history_previous_stage"
            columns: ["workspace_id", "previous_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_pipeline_history_workspace"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          commercial_meaning: string | null
          created_at: string
          deactivated_at: string | null
          id: string
          is_active: boolean
          name: string
          position: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          commercial_meaning?: string | null
          created_at?: string
          deactivated_at?: string | null
          id?: string
          is_active: boolean
          name: string
          position: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          commercial_meaning?: string | null
          created_at?: string
          deactivated_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          position?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_pipeline_stages_workspace"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      work_tasks: {
        Row: {
          archived_at: string | null
          cancelled_at: string | null
          cancelled_by_member_id: string | null
          completed_at: string | null
          completed_by_member_id: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          created_by_member_id: string
          description: string | null
          due_at: string
          id: string
          opportunity_id: string | null
          priority: string
          reminder_at: string | null
          responsible_member_id: string | null
          status: string
          task_type: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          cancelled_at?: string | null
          cancelled_by_member_id?: string | null
          completed_at?: string | null
          completed_by_member_id?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by_member_id: string
          description?: string | null
          due_at: string
          id?: string
          opportunity_id?: string | null
          priority: string
          reminder_at?: string | null
          responsible_member_id?: string | null
          status: string
          task_type: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          cancelled_at?: string | null
          cancelled_by_member_id?: string | null
          completed_at?: string | null
          completed_by_member_id?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by_member_id?: string
          description?: string | null
          due_at?: string
          id?: string
          opportunity_id?: string | null
          priority?: string
          reminder_at?: string | null
          responsible_member_id?: string | null
          status?: string
          task_type?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_work_tasks_cancelled_by"
            columns: ["workspace_id", "cancelled_by_member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_work_tasks_completed_by"
            columns: ["workspace_id", "completed_by_member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_work_tasks_contact"
            columns: ["workspace_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_work_tasks_conversation"
            columns: ["workspace_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_work_tasks_created_by"
            columns: ["workspace_id", "created_by_member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_work_tasks_opportunity"
            columns: ["workspace_id", "opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_work_tasks_responsible_member"
            columns: ["workspace_id", "responsible_member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_work_tasks_workspace"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          activated_at: string | null
          created_at: string
          id: string
          invitation_expires_at: string | null
          invited_at: string | null
          invited_by_member_id: string | null
          invited_email_normalized: string | null
          removed_at: string | null
          role: string
          status: string
          suspended_at: string | null
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          id?: string
          invitation_expires_at?: string | null
          invited_at?: string | null
          invited_by_member_id?: string | null
          invited_email_normalized?: string | null
          removed_at?: string | null
          role: string
          status: string
          suspended_at?: string | null
          updated_at?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          id?: string
          invitation_expires_at?: string | null
          invited_at?: string | null
          invited_by_member_id?: string | null
          invited_email_normalized?: string | null
          removed_at?: string | null
          role?: string
          status?: string
          suspended_at?: string | null
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_workspace_members_invited_by"
            columns: ["workspace_id", "invited_by_member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "fk_workspace_members_user"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_workspace_members_workspace"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          closed_at: string | null
          created_at: string
          id: string
          name: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          id?: string
          name: string
          status: string
          timezone: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          id?: string
          name?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_team_invitation: { Args: never; Returns: Json }
      archive_contact: { Args: { p_contact_id: string }; Returns: string }
      bind_team_invitation_auth_identity: {
        Args: { p_auth_user_id: string; p_member_id: string }
        Returns: undefined
      }
      archive_opportunity: { Args: { p_opportunity_id: string }; Returns: Json }
      bootstrap_initial_workspace: {
        Args: {
          p_auth_user_id: string
          p_display_name: string
          p_timezone: string
          p_workspace_name: string
        }
        Returns: {
          app_user_id: string
          workspace_id: string
          workspace_member_id: string
        }[]
      }
      close_opportunity_cancelled: {
        Args: { p_opportunity_id: string }
        Returns: Json
      }
      close_opportunity_lost: {
        Args: {
          p_loss_notes?: string
          p_loss_reason: string
          p_opportunity_id: string
        }
        Returns: Json
      }
      close_opportunity_won: {
        Args: {
          p_business_value?: number
          p_commission_expected?: number
          p_commission_received?: number
          p_opportunity_id: string
        }
        Returns: Json
      }
      complete_work_task: { Args: { p_task_id: string }; Returns: Json }
      deactivate_team_member: { Args: { p_member_id: string }; Returns: Json }
      create_contact: {
        Args: {
          p_classification: string
          p_display_name: string
          p_phone_display_value?: string
          p_phone_normalized?: string
        }
        Returns: string
      }
      create_opportunity: {
        Args: {
          p_city_region_preference?: string
          p_contact_id: string
          p_description?: string
          p_down_payment_available?: number
          p_operation_type?: string
          p_origin?: string
          p_preferences_notes?: string
          p_property_summary?: string
          p_property_type_preference?: string
          p_responsible_member_id?: string
          p_stage_id: string
          p_timeframe_intent?: string
          p_title: string
          p_value_range_preference?: string
        }
        Returns: string
      }
      get_conversation_context: {
        Args: { p_conversation_id: string }
        Returns: Json
      }
      get_conversation_messages: {
        Args: {
          p_conversation_id: string
          p_cursor_id?: string
          p_cursor_occurred_at?: string
          p_limit?: number
        }
        Returns: Json
      }
      get_conversations_inbox: {
        Args: {
          p_cursor_id?: string
          p_cursor_ts?: string
          p_limit?: number
          p_search?: string
          p_view?: string
        }
        Returns: Json
      }
      get_conversations_list: {
        Args: {
          p_cursor_id?: string
          p_cursor_ts?: string
          p_limit?: number
          p_search?: string
        }
        Returns: {
          contact_id: string
          conversation_id: string
          conversation_type: string
          is_unread: boolean
          last_activity_at: string
          last_msg_author_name: string
          last_msg_direction: string
          last_msg_occurred_at: string
          last_msg_text: string
          next_cursor_id: string
          next_cursor_ts: string
          operational_status: string
          participant_name: string
          participant_phone: string
          started_at: string
          visibility: string
        }[]
      }
      get_kanban_board: { Args: { p_limit_per_stage?: number }; Returns: Json }
      get_opportunity_for_conversation: {
        Args: { p_conversation_id: string }
        Returns: Json
      }
      get_or_create_opportunity_conversation: {
        Args: { p_opportunity_id: string }
        Returns: Json
      }
      get_prioridades_dashboard: { Args: never; Returns: Json }
      get_visible_internal_notes: {
        Args: { p_conversation_id: string; p_opportunity_id?: string }
        Returns: {
          author_name: string
          content: string
          created_at: string
          id: string
          opportunity_id: string | null
        }[]
      }
      get_pending_team_invitation: {
        Args: { p_member_id: string }
        Returns: {
          auth_user_id: string | null
          display_name: string
          email: string
          member_id: string
        }[]
      }
      get_team_members: {
        Args: never
        Returns: {
          activated_at: string | null
          created_at: string
          display_name: string
          email: string
          invited_at: string | null
          member_id: string
          member_role: string
          member_status: string
        }[]
      }
      ingest_whatsapp_group_text_message: {
        Args: {
          p_external_account_id: string
          p_external_message_id: string
          p_from_me: boolean
          p_group_jid: string
          p_group_subject: string
          p_occurred_at: string
          p_push_name: string
          p_sender_jid: string
          p_text_content: string
        }
        Returns: Json
      }
      ingest_whatsapp_text_message: {
        Args: {
          p_external_account_id: string
          p_external_message_id: string
          p_from_me: boolean
          p_occurred_at: string
          p_push_name: string
          p_remote_jid: string
          p_text_content: string
        }
        Returns: Json
      }
      link_opportunity_conversation: {
        Args: { p_conversation_id: string; p_opportunity_id: string }
        Returns: Json
      }
      mark_conversation_unread: {
        Args: { p_conversation_id: string; p_unread?: boolean }
        Returns: Json
      }
      mark_team_invitation_resent: { Args: { p_member_id: string }; Returns: Json }
      normalize_brazilian_phone: { Args: { p_value: string }; Returns: string }
      reorder_opportunity: {
        Args: {
          p_before_opportunity_id?: string
          p_expected_current_stage_id: string
          p_opportunity_id: string
          p_target_stage_id: string
        }
        Returns: Json
      }
      move_opportunity_stage: {
        Args: {
          p_expected_current_stage_id: string
          p_new_stage_id: string
          p_opportunity_id: string
          p_reason?: string
        }
        Returns: Json
      }
      provision_default_pipeline_stages: {
        Args: { p_workspace_id: string }
        Returns: number
      }
      prepare_team_invitation: {
        Args: { p_display_name: string; p_email: string }
        Returns: Json
      }
      queue_outgoing_text_message: {
        Args: {
          p_client_idempotency_key: string
          p_conversation_id: string
          p_text_content: string
        }
        Returns: Json
      }
      reactivate_opportunity: {
        Args: { p_opportunity_id: string; p_target_stage_id?: string }
        Returns: Json
      }
      reactivate_team_member: { Args: { p_member_id: string }; Returns: Json }
      reconcile_outgoing_text_message: {
        Args: {
          p_external_message_id?: string
          p_message_id: string
          p_target_status: string
        }
        Returns: Json
      }
      restore_contact: { Args: { p_contact_id: string }; Returns: string }
      save_internal_note: {
        Args: {
          p_content: string
          p_conversation_id: string
          p_opportunity_id?: string
        }
        Returns: Json
      }
      resolve_or_start_individual_conversation: {
        Args: { p_contact_id?: string; p_phone: string }
        Returns: Json
      }
      set_contact_operational_status: {
        Args: { p_contact_id: string; p_operational_status: string }
        Returns: string
      }
      set_contact_team_visibility: {
        Args: { p_contact_id: string; p_team_visible: boolean }
        Returns: Json
      }
      set_conversation_archived: {
        Args: { p_archived: boolean; p_conversation_id: string }
        Returns: Json
      }
      set_group_team_visibility: {
        Args: { p_conversation_id: string; p_team_visible: boolean }
        Returns: Json
      }
      set_opportunity_rework: {
        Args: {
          p_opportunity_id: string
          p_rework_reason: string
          p_rework_reevaluation_date: string
        }
        Returns: Json
      }
      update_contact: {
        Args: {
          p_classification: string
          p_contact_id: string
          p_display_name: string
          p_phone_display_value?: string
          p_phone_normalized?: string
        }
        Returns: string
      }
      update_conversation_contact_name: {
        Args: { p_conversation_id: string; p_display_name: string }
        Returns: Json
      }
      update_contact_opportunity_qualification: {
        Args: {
          p_approved_credit_amount?: number
          p_available_down_payment?: number
          p_city_region_preference?: string
          p_contact_id: string
          p_docs_status?: string
          p_family_income?: number
          p_financial_analysis_status?: string
          p_max_price_budget?: number
          p_notes?: string
          p_operation_type?: string
          p_opportunity_id?: string
          p_property_type_preference?: string
          p_timeframe_intent?: string
        }
        Returns: Json
      }
      update_opportunity: {
        Args: {
          p_contact_id?: string
          p_description?: string
          p_opportunity_id: string
          p_responsible_member_id?: string
          p_stage_id?: string
          p_title: string
        }
        Returns: Json
      }
      upsert_work_task: {
        Args: {
          p_contact_id?: string
          p_conversation_id?: string
          p_due_at: string
          p_opportunity_id?: string
          p_task_id?: string
          p_task_type: string
          p_title: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

