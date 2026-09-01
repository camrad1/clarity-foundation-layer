export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_insight_narratives: {
        Row: {
          created_at: string
          evidence: Json
          generated_at: string
          id: string
          model: string | null
          narrative: string
          organization_id: string
          prompt_context: Json
          signal_ids: string[]
          status: string
        }
        Insert: {
          created_at?: string
          evidence?: Json
          generated_at?: string
          id?: string
          model?: string | null
          narrative: string
          organization_id: string
          prompt_context?: Json
          signal_ids?: string[]
          status?: string
        }
        Update: {
          created_at?: string
          evidence?: Json
          generated_at?: string
          id?: string
          model?: string | null
          narrative?: string
          organization_id?: string
          prompt_context?: Json
          signal_ids?: string[]
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_insight_narratives_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      care_types: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          organization_id: string | null
          slug: string
          status: Database["public"]["Enums"]["entity_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organization_id?: string | null
          slug: string
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      communities: {
        Row: {
          city: string | null
          created_at: string
          id: string
          name: string
          organization_id: string
          primary_domain: string | null
          region_id: string | null
          slug: string
          state: string | null
          status: Database["public"]["Enums"]["entity_status"]
          timezone: string
          unit_count: number | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          id?: string
          name: string
          organization_id: string
          primary_domain?: string | null
          region_id?: string | null
          slug: string
          state?: string | null
          status?: Database["public"]["Enums"]["entity_status"]
          timezone?: string
          unit_count?: number | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          primary_domain?: string | null
          region_id?: string | null
          slug?: string
          state?: string | null
          status?: Database["public"]["Enums"]["entity_status"]
          timezone?: string
          unit_count?: number | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communities_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      community_care_types: {
        Row: {
          care_type_id: string
          community_id: string
          created_at: string
          id: string
          organization_id: string
        }
        Insert: {
          care_type_id: string
          community_id: string
          created_at?: string
          id?: string
          organization_id: string
        }
        Update: {
          care_type_id?: string
          community_id?: string
          created_at?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_care_types_care_type_id_fkey"
            columns: ["care_type_id"]
            isOneToOne: false
            referencedRelation: "care_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_care_types_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_care_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      community_daily_snapshots: {
        Row: {
          community_id: string
          created_at: string
          id: string
          organization_id: string
          payload: Json
          snapshot_date: string
          snapshot_type: string
          source_sync_run_id: string | null
        }
        Insert: {
          community_id: string
          created_at?: string
          id?: string
          organization_id: string
          payload?: Json
          snapshot_date: string
          snapshot_type: string
          source_sync_run_id?: string | null
        }
        Update: {
          community_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          payload?: Json
          snapshot_date?: string
          snapshot_type?: string
          source_sync_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_daily_snapshots_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_daily_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_daily_snapshots_source_sync_run_id_fkey"
            columns: ["source_sync_run_id"]
            isOneToOne: false
            referencedRelation: "source_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      community_source_mappings: {
        Row: {
          active: boolean
          community_id: string
          created_at: string
          external_id: string
          external_metadata: Json
          external_name: string | null
          id: string
          organization_id: string
          source_type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          community_id: string
          created_at?: string
          external_id: string
          external_metadata?: Json
          external_name?: string | null
          id?: string
          organization_id: string
          source_type: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          community_id?: string
          created_at?: string
          external_id?: string
          external_metadata?: Json
          external_name?: string | null
          id?: string
          organization_id?: string
          source_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_source_mappings_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_source_mappings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_source_mappings_source_type_fkey"
            columns: ["source_type"]
            isOneToOne: false
            referencedRelation: "data_source_types"
            referencedColumns: ["key"]
          },
        ]
      }
      data_source_connections: {
        Row: {
          connection_metadata: Json
          created_at: string
          data_through_date: string | null
          display_name: string
          id: string
          last_attempted_sync_at: string | null
          last_successful_sync_at: string | null
          organization_id: string
          source_type: string
          status: Database["public"]["Enums"]["connection_status"]
          updated_at: string
        }
        Insert: {
          connection_metadata?: Json
          created_at?: string
          data_through_date?: string | null
          display_name: string
          id?: string
          last_attempted_sync_at?: string | null
          last_successful_sync_at?: string | null
          organization_id: string
          source_type: string
          status?: Database["public"]["Enums"]["connection_status"]
          updated_at?: string
        }
        Update: {
          connection_metadata?: Json
          created_at?: string
          data_through_date?: string | null
          display_name?: string
          id?: string
          last_attempted_sync_at?: string | null
          last_successful_sync_at?: string | null
          organization_id?: string
          source_type?: string
          status?: Database["public"]["Enums"]["connection_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_source_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_source_connections_source_type_fkey"
            columns: ["source_type"]
            isOneToOne: false
            referencedRelation: "data_source_types"
            referencedColumns: ["key"]
          },
        ]
      }
      data_source_credentials: {
        Row: {
          connection_id: string
          created_at: string
          credential_kind: string
          id: string
          organization_id: string
          rotated_at: string | null
          secret_ref: string
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          credential_kind?: string
          id?: string
          organization_id: string
          rotated_at?: string | null
          secret_ref: string
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          credential_kind?: string
          id?: string
          organization_id?: string
          rotated_at?: string | null
          secret_ref?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_source_credentials_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "data_source_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_source_credentials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      data_source_types: {
        Row: {
          category: string
          created_at: string
          key: string
          name: string
          supports_api: boolean
          supports_manual_upload: boolean
        }
        Insert: {
          category?: string
          created_at?: string
          key: string
          name: string
          supports_api?: boolean
          supports_manual_upload?: boolean
        }
        Update: {
          category?: string
          created_at?: string
          key?: string
          name?: string
          supports_api?: boolean
          supports_manual_upload?: boolean
        }
        Relationships: []
      }
      insight_signals: {
        Row: {
          attribution_level: Database["public"]["Enums"]["attribution_level"]
          community_id: string | null
          comparison_values: Json
          created_at: string
          data_freshness_at: string | null
          generated_at: string
          id: string
          metric_keys: string[]
          organization_id: string
          period_end: string | null
          period_start: string | null
          severity: string
          signal_type: string
          status: string
          supporting_values: Json
        }
        Insert: {
          attribution_level?: Database["public"]["Enums"]["attribution_level"]
          community_id?: string | null
          comparison_values?: Json
          created_at?: string
          data_freshness_at?: string | null
          generated_at?: string
          id?: string
          metric_keys?: string[]
          organization_id: string
          period_end?: string | null
          period_start?: string | null
          severity?: string
          signal_type: string
          status?: string
          supporting_values?: Json
        }
        Update: {
          attribution_level?: Database["public"]["Enums"]["attribution_level"]
          community_id?: string | null
          comparison_values?: Json
          created_at?: string
          data_freshness_at?: string | null
          generated_at?: string
          id?: string
          metric_keys?: string[]
          organization_id?: string
          period_end?: string | null
          period_start?: string | null
          severity?: string
          signal_type?: string
          status?: string
          supporting_values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "insight_signals_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_signals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_definitions: {
        Row: {
          calculation_definition: Json
          created_at: string
          date_field: string | null
          description: string | null
          effective_end: string | null
          effective_start: string
          exclusion_rules: Json
          id: string
          metric_key: string
          metric_version: number
          name: string
          organization_id: string | null
          source_table: string | null
          source_type: string | null
          status: Database["public"]["Enums"]["metric_status"]
          supersedes_id: string | null
          supported_dimensions: string[]
          updated_at: string
          validation_status: Database["public"]["Enums"]["metric_validation_state"]
        }
        Insert: {
          calculation_definition?: Json
          created_at?: string
          date_field?: string | null
          description?: string | null
          effective_end?: string | null
          effective_start?: string
          exclusion_rules?: Json
          id?: string
          metric_key: string
          metric_version?: number
          name: string
          organization_id?: string | null
          source_table?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["metric_status"]
          supersedes_id?: string | null
          supported_dimensions?: string[]
          updated_at?: string
          validation_status?: Database["public"]["Enums"]["metric_validation_state"]
        }
        Update: {
          calculation_definition?: Json
          created_at?: string
          date_field?: string | null
          description?: string | null
          effective_end?: string | null
          effective_start?: string
          exclusion_rules?: Json
          id?: string
          metric_key?: string
          metric_version?: number
          name?: string
          organization_id?: string | null
          source_table?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["metric_status"]
          supersedes_id?: string | null
          supported_dimensions?: string[]
          updated_at?: string
          validation_status?: Database["public"]["Enums"]["metric_validation_state"]
        }
        Relationships: [
          {
            foreignKeyName: "metric_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_definitions_source_type_fkey"
            columns: ["source_type"]
            isOneToOne: false
            referencedRelation: "data_source_types"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "metric_definitions_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "metric_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_goals: {
        Row: {
          community_id: string | null
          created_at: string
          effective_end: string | null
          effective_start: string
          id: string
          metric_key: string
          notes: string | null
          organization_id: string
          target_value: number
          updated_at: string
        }
        Insert: {
          community_id?: string | null
          created_at?: string
          effective_end?: string | null
          effective_start: string
          id?: string
          metric_key: string
          notes?: string | null
          organization_id: string
          target_value: number
          updated_at?: string
        }
        Update: {
          community_id?: string | null
          created_at?: string
          effective_end?: string | null
          effective_start?: string
          id?: string
          metric_key?: string
          notes?: string | null
          organization_id?: string
          target_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "metric_goals_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_goals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_results: {
        Row: {
          calculated_at: string
          community_id: string | null
          created_at: string
          dimensions: Json
          drill_through_ref: Json
          id: string
          metric_definition_id: string
          metric_key: string
          metric_version: number
          organization_id: string
          period_end: string
          period_start: string
          record_count: number | null
          source_sync_run_id: string | null
          value: number | null
        }
        Insert: {
          calculated_at?: string
          community_id?: string | null
          created_at?: string
          dimensions?: Json
          drill_through_ref?: Json
          id?: string
          metric_definition_id: string
          metric_key: string
          metric_version: number
          organization_id: string
          period_end: string
          period_start: string
          record_count?: number | null
          source_sync_run_id?: string | null
          value?: number | null
        }
        Update: {
          calculated_at?: string
          community_id?: string | null
          created_at?: string
          dimensions?: Json
          drill_through_ref?: Json
          id?: string
          metric_definition_id?: string
          metric_key?: string
          metric_version?: number
          organization_id?: string
          period_end?: string
          period_start?: string
          record_count?: number | null
          source_sync_run_id?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "metric_results_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_results_metric_definition_id_fkey"
            columns: ["metric_definition_id"]
            isOneToOne: false
            referencedRelation: "metric_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_validation_checks: {
        Row: {
          calculated_value: number | null
          community_id: string | null
          created_at: string
          difference: number | null
          expected_value: number | null
          id: string
          metric_key: string
          metric_version: number | null
          organization_id: string
          period_end: string
          period_start: string
          reviewed_by: string | null
          reviewer_notes: string | null
          status: Database["public"]["Enums"]["validation_check_status"]
          updated_at: string
          validated_at: string | null
        }
        Insert: {
          calculated_value?: number | null
          community_id?: string | null
          created_at?: string
          difference?: number | null
          expected_value?: number | null
          id?: string
          metric_key: string
          metric_version?: number | null
          organization_id: string
          period_end: string
          period_start: string
          reviewed_by?: string | null
          reviewer_notes?: string | null
          status?: Database["public"]["Enums"]["validation_check_status"]
          updated_at?: string
          validated_at?: string | null
        }
        Update: {
          calculated_value?: number | null
          community_id?: string | null
          created_at?: string
          difference?: number | null
          expected_value?: number | null
          id?: string
          metric_key?: string
          metric_version?: number | null
          organization_id?: string
          period_end?: string
          period_start?: string
          reviewed_by?: string | null
          reviewer_notes?: string | null
          status?: Database["public"]["Enums"]["validation_check_status"]
          updated_at?: string
          validated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "metric_validation_checks_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_validation_checks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          default_timezone: string
          id: string
          name: string
          slug: string
          status: Database["public"]["Enums"]["entity_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_timezone?: string
          id?: string
          name: string
          slug: string
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_timezone?: string
          id?: string
          name?: string
          slug?: string
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      regions: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string
          parent_region_id: string | null
          slug: string
          status: Database["public"]["Enums"]["entity_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id: string
          parent_region_id?: string | null
          slug: string
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          parent_region_id?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "regions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regions_parent_region_id_fkey"
            columns: ["parent_region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      source_records_raw: {
        Row: {
          community_id: string | null
          connection_id: string
          contains_pii: boolean
          created_at: string
          id: string
          imported_at: string
          is_discarded: boolean
          merged_into_source_id: string | null
          organization_id: string
          payload: Json
          record_type: string
          source_community_external_id: string | null
          source_record_id: string
          source_type: string
          source_updated_at: string | null
          sync_run_id: string | null
          updated_at: string
        }
        Insert: {
          community_id?: string | null
          connection_id: string
          contains_pii?: boolean
          created_at?: string
          id?: string
          imported_at?: string
          is_discarded?: boolean
          merged_into_source_id?: string | null
          organization_id: string
          payload?: Json
          record_type: string
          source_community_external_id?: string | null
          source_record_id: string
          source_type: string
          source_updated_at?: string | null
          sync_run_id?: string | null
          updated_at?: string
        }
        Update: {
          community_id?: string | null
          connection_id?: string
          contains_pii?: boolean
          created_at?: string
          id?: string
          imported_at?: string
          is_discarded?: boolean
          merged_into_source_id?: string | null
          organization_id?: string
          payload?: Json
          record_type?: string
          source_community_external_id?: string | null
          source_record_id?: string
          source_type?: string
          source_updated_at?: string | null
          sync_run_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_records_raw_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_records_raw_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "data_source_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_records_raw_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_records_raw_source_type_fkey"
            columns: ["source_type"]
            isOneToOne: false
            referencedRelation: "data_source_types"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "source_records_raw_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "source_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      source_sync_runs: {
        Row: {
          completed_at: string | null
          connection_id: string
          created_at: string
          error_summary: string | null
          id: string
          organization_id: string
          records_failed: number
          records_inserted: number
          records_received: number
          records_updated: number
          started_at: string
          status: Database["public"]["Enums"]["sync_run_status"]
          sync_cursor: Json
        }
        Insert: {
          completed_at?: string | null
          connection_id: string
          created_at?: string
          error_summary?: string | null
          id?: string
          organization_id: string
          records_failed?: number
          records_inserted?: number
          records_received?: number
          records_updated?: number
          started_at?: string
          status?: Database["public"]["Enums"]["sync_run_status"]
          sync_cursor?: Json
        }
        Update: {
          completed_at?: string | null
          connection_id?: string
          created_at?: string
          error_summary?: string | null
          id?: string
          organization_id?: string
          records_failed?: number
          records_inserted?: number
          records_received?: number
          records_updated?: number
          started_at?: string
          status?: Database["public"]["Enums"]["sync_run_status"]
          sync_cursor?: Json
        }
        Relationships: [
          {
            foreignKeyName: "source_sync_runs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "data_source_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_sync_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      url_mapping_rules: {
        Row: {
          active: boolean
          care_type_id: string | null
          community_id: string | null
          content_type: string
          created_at: string
          id: string
          intent_type: string | null
          match_type: Database["public"]["Enums"]["url_match_type"]
          organization_id: string
          pattern: string
          priority: number
          topic: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          care_type_id?: string | null
          community_id?: string | null
          content_type?: string
          created_at?: string
          id?: string
          intent_type?: string | null
          match_type: Database["public"]["Enums"]["url_match_type"]
          organization_id: string
          pattern: string
          priority?: number
          topic?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          care_type_id?: string | null
          community_id?: string | null
          content_type?: string
          created_at?: string
          id?: string
          intent_type?: string | null
          match_type?: Database["public"]["Enums"]["url_match_type"]
          organization_id?: string
          pattern?: string
          priority?: number
          topic?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "url_mapping_rules_care_type_id_fkey"
            columns: ["care_type_id"]
            isOneToOne: false
            referencedRelation: "care_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "url_mapping_rules_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "url_mapping_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_community_access: {
        Row: {
          community_id: string
          created_at: string
          id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          community_id: string
          created_at?: string
          id?: string
          organization_id: string
          user_id: string
        }
        Update: {
          community_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_community_access_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_community_access_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_region_access: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          region_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          region_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          region_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_region_access_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_region_access_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_admin_view_profile: {
        Args: { _profile_id: string; _user_id?: string }
        Returns: boolean
      }
      has_community_access: {
        Args: { _community_id: string; _user_id?: string }
        Returns: boolean
      }
      has_org_access: {
        Args: { _org_id: string; _user_id?: string }
        Returns: boolean
      }
      has_org_wide_scope: {
        Args: { _org_id: string; _user_id?: string }
        Returns: boolean
      }
      is_org_admin: {
        Args: { _org_id: string; _user_id?: string }
        Returns: boolean
      }
      is_platform_admin: { Args: { _user_id?: string }; Returns: boolean }
    }
    Enums: {
      app_role:
        | "platform_admin"
        | "organization_admin"
        | "regional_user"
        | "community_user"
        | "marketing_user"
        | "read_only"
      attribution_level: "exact" | "joined" | "aggregate"
      connection_status:
        | "connected"
        | "needs_attention"
        | "disconnected"
        | "manual_upload"
        | "syncing"
      entity_status: "active" | "inactive" | "archived" | "pending"
      metric_status: "draft" | "provisional" | "validated" | "deprecated"
      metric_validation_state:
        | "unvalidated"
        | "in_review"
        | "validated"
        | "failed"
      sync_run_status: "running" | "success" | "partial" | "failed"
      url_match_type: "exact_url" | "url_contains" | "path_prefix" | "regex"
      validation_check_status:
        | "pending"
        | "matched"
        | "mismatch"
        | "approved"
        | "needs_review"
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
  public: {
    Enums: {
      app_role: [
        "platform_admin",
        "organization_admin",
        "regional_user",
        "community_user",
        "marketing_user",
        "read_only",
      ],
      attribution_level: ["exact", "joined", "aggregate"],
      connection_status: [
        "connected",
        "needs_attention",
        "disconnected",
        "manual_upload",
        "syncing",
      ],
      entity_status: ["active", "inactive", "archived", "pending"],
      metric_status: ["draft", "provisional", "validated", "deprecated"],
      metric_validation_state: [
        "unvalidated",
        "in_review",
        "validated",
        "failed",
      ],
      sync_run_status: ["running", "success", "partial", "failed"],
      url_match_type: ["exact_url", "url_contains", "path_prefix", "regex"],
      validation_check_status: [
        "pending",
        "matched",
        "mismatch",
        "approved",
        "needs_review",
      ],
    },
  },
} as const
