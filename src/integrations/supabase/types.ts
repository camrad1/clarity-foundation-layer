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
          occupancy_capacity_basis: string
          organization_id: string
          primary_domain: string | null
          region_id: string | null
          slug: string
          state: string | null
          status: Database["public"]["Enums"]["entity_status"]
          street_address: string | null
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
          occupancy_capacity_basis?: string
          organization_id: string
          primary_domain?: string | null
          region_id?: string | null
          slug: string
          state?: string | null
          status?: Database["public"]["Enums"]["entity_status"]
          street_address?: string | null
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
          occupancy_capacity_basis?: string
          organization_id?: string
          primary_domain?: string | null
          region_id?: string | null
          slug?: string
          state?: string | null
          status?: Database["public"]["Enums"]["entity_status"]
          street_address?: string | null
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
      community_daily_occupancy_history: {
        Row: {
          beginning_occupancy_pct: number | null
          beginning_occupied_units: number | null
          community_id: string
          created_at: string
          ending_occupancy_pct: number | null
          ending_occupied_units: number | null
          id: string
          import_batch_id: string | null
          imported_at: string
          imported_by: string | null
          move_ins: number | null
          move_outs: number | null
          net_move_ins_move_outs: number | null
          notes: string | null
          occupancy_date: string
          organization_id: string
          raw_source_community_name: string | null
          raw_source_date_label: string | null
          source_file_name: string | null
          source_sheet_name: string | null
          source_type: string
          total_units: number | null
          validation_status: string
        }
        Insert: {
          beginning_occupancy_pct?: number | null
          beginning_occupied_units?: number | null
          community_id: string
          created_at?: string
          ending_occupancy_pct?: number | null
          ending_occupied_units?: number | null
          id?: string
          import_batch_id?: string | null
          imported_at?: string
          imported_by?: string | null
          move_ins?: number | null
          move_outs?: number | null
          net_move_ins_move_outs?: number | null
          notes?: string | null
          occupancy_date: string
          organization_id: string
          raw_source_community_name?: string | null
          raw_source_date_label?: string | null
          source_file_name?: string | null
          source_sheet_name?: string | null
          source_type?: string
          total_units?: number | null
          validation_status?: string
        }
        Update: {
          beginning_occupancy_pct?: number | null
          beginning_occupied_units?: number | null
          community_id?: string
          created_at?: string
          ending_occupancy_pct?: number | null
          ending_occupied_units?: number | null
          id?: string
          import_batch_id?: string | null
          imported_at?: string
          imported_by?: string | null
          move_ins?: number | null
          move_outs?: number | null
          net_move_ins_move_outs?: number | null
          notes?: string | null
          occupancy_date?: string
          organization_id?: string
          raw_source_community_name?: string | null
          raw_source_date_label?: string | null
          source_file_name?: string | null
          source_sheet_name?: string | null
          source_type?: string
          total_units?: number | null
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_daily_occupancy_history_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_daily_occupancy_history_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "occupancy_history_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_daily_occupancy_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      community_daily_snapshot_care_types: {
        Row: {
          care_type_label: string
          census_units: number
          community_id: string
          created_at: string
          id: string
          occupancy_pct: number | null
          occupied_units: number
          organization_id: string
          snapshot_date: string
          snapshot_id: string
        }
        Insert: {
          care_type_label: string
          census_units?: number
          community_id: string
          created_at?: string
          id?: string
          occupancy_pct?: number | null
          occupied_units?: number
          organization_id: string
          snapshot_date: string
          snapshot_id: string
        }
        Update: {
          care_type_label?: string
          census_units?: number
          community_id?: string
          created_at?: string
          id?: string
          occupancy_pct?: number | null
          occupied_units?: number
          organization_id?: string
          snapshot_date?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_daily_snapshot_care_types_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_daily_snapshot_care_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_daily_snapshot_care_types_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "community_daily_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      community_daily_snapshots: {
        Row: {
          budget_pct: number | null
          budget_units: number | null
          canonical_for_trend: boolean
          capacity_basis: string | null
          census_capacity: number | null
          census_rooms: number | null
          census_units: number | null
          community_id: string
          configured_operational_units: number | null
          created_at: string
          failure_reason: string | null
          hot_leads: number | null
          hot_no_future_activity: number | null
          id: string
          inactive_units: number | null
          local_timezone: string | null
          metric_version: string
          noncanonical_reason: string | null
          notice_count: number | null
          occupancy_pct: number | null
          occupancy_variance_pct: number | null
          occupancy_variance_units: number | null
          occupied_capacity: number | null
          occupied_rooms: number | null
          occupied_units: number | null
          off_census_units: number | null
          open_pipeline: number | null
          organization_id: string
          pending_move_ins: number | null
          pending_move_outs: number | null
          pseudo_units: number | null
          reserved_count: number | null
          residents_count: number | null
          snapshot_at: string
          snapshot_date: string
          source_connection_id: string | null
          source_data_through_at: string | null
          stalled_prospects: number | null
          status: string
          sync_run_id: string | null
          total_unit_records: number | null
          vacant_units: number | null
        }
        Insert: {
          budget_pct?: number | null
          budget_units?: number | null
          canonical_for_trend?: boolean
          capacity_basis?: string | null
          census_capacity?: number | null
          census_rooms?: number | null
          census_units?: number | null
          community_id: string
          configured_operational_units?: number | null
          created_at?: string
          failure_reason?: string | null
          hot_leads?: number | null
          hot_no_future_activity?: number | null
          id?: string
          inactive_units?: number | null
          local_timezone?: string | null
          metric_version?: string
          noncanonical_reason?: string | null
          notice_count?: number | null
          occupancy_pct?: number | null
          occupancy_variance_pct?: number | null
          occupancy_variance_units?: number | null
          occupied_capacity?: number | null
          occupied_rooms?: number | null
          occupied_units?: number | null
          off_census_units?: number | null
          open_pipeline?: number | null
          organization_id: string
          pending_move_ins?: number | null
          pending_move_outs?: number | null
          pseudo_units?: number | null
          reserved_count?: number | null
          residents_count?: number | null
          snapshot_at?: string
          snapshot_date: string
          source_connection_id?: string | null
          source_data_through_at?: string | null
          stalled_prospects?: number | null
          status?: string
          sync_run_id?: string | null
          total_unit_records?: number | null
          vacant_units?: number | null
        }
        Update: {
          budget_pct?: number | null
          budget_units?: number | null
          canonical_for_trend?: boolean
          capacity_basis?: string | null
          census_capacity?: number | null
          census_rooms?: number | null
          census_units?: number | null
          community_id?: string
          configured_operational_units?: number | null
          created_at?: string
          failure_reason?: string | null
          hot_leads?: number | null
          hot_no_future_activity?: number | null
          id?: string
          inactive_units?: number | null
          local_timezone?: string | null
          metric_version?: string
          noncanonical_reason?: string | null
          notice_count?: number | null
          occupancy_pct?: number | null
          occupancy_variance_pct?: number | null
          occupancy_variance_units?: number | null
          occupied_capacity?: number | null
          occupied_rooms?: number | null
          occupied_units?: number | null
          off_census_units?: number | null
          open_pipeline?: number | null
          organization_id?: string
          pending_move_ins?: number | null
          pending_move_outs?: number | null
          pseudo_units?: number | null
          reserved_count?: number | null
          residents_count?: number | null
          snapshot_at?: string
          snapshot_date?: string
          source_connection_id?: string | null
          source_data_through_at?: string | null
          stalled_prospects?: number | null
          status?: string
          sync_run_id?: string | null
          total_unit_records?: number | null
          vacant_units?: number | null
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
            foreignKeyName: "community_daily_snapshots_source_connection_id_fkey"
            columns: ["source_connection_id"]
            isOneToOne: false
            referencedRelation: "data_source_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_daily_snapshots_sync_run_id_fkey"
            columns: ["sync_run_id"]
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
          last_verification_error: string | null
          last_verified_at: string | null
          organization_id: string
          rotated_at: string | null
          secret_ref: string
          secret_value: string | null
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          credential_kind?: string
          id?: string
          last_verification_error?: string | null
          last_verified_at?: string | null
          organization_id: string
          rotated_at?: string | null
          secret_ref: string
          secret_value?: string | null
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          credential_kind?: string
          id?: string
          last_verification_error?: string | null
          last_verified_at?: string | null
          organization_id?: string
          rotated_at?: string | null
          secret_ref?: string
          secret_value?: string | null
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
      flash_manual_entries: {
        Row: {
          attended_count: number | null
          community_id: string
          created_at: string
          created_by: string | null
          entry_date: string
          id: string
          invited_count: number | null
          kind: string
          notes: string | null
          organization_id: string
          reporting_month: string | null
          reporting_week_start: string | null
          target_audience: string | null
          title: string
          updated_at: string
        }
        Insert: {
          attended_count?: number | null
          community_id: string
          created_at?: string
          created_by?: string | null
          entry_date: string
          id?: string
          invited_count?: number | null
          kind?: string
          notes?: string | null
          organization_id: string
          reporting_month?: string | null
          reporting_week_start?: string | null
          target_audience?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          attended_count?: number | null
          community_id?: string
          created_at?: string
          created_by?: string | null
          entry_date?: string
          id?: string
          invited_count?: number | null
          kind?: string
          notes?: string | null
          organization_id?: string
          reporting_month?: string | null
          reporting_week_start?: string | null
          target_audience?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flash_manual_entries_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flash_manual_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      flash_note_revisions: {
        Row: {
          body: string
          community_id: string
          edited_at: string
          edited_by: string | null
          id: string
          note_id: string
          organization_id: string
        }
        Insert: {
          body: string
          community_id: string
          edited_at?: string
          edited_by?: string | null
          id?: string
          note_id: string
          organization_id: string
        }
        Update: {
          body?: string
          community_id?: string
          edited_at?: string
          edited_by?: string | null
          id?: string
          note_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flash_note_revisions_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "flash_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      flash_notes: {
        Row: {
          body: string
          community_id: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          reporting_month: string | null
          reporting_week_start: string | null
          subject_key: string
          subject_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body: string
          community_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          reporting_month?: string | null
          reporting_week_start?: string | null
          subject_key: string
          subject_type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string
          community_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          reporting_month?: string | null
          reporting_week_start?: string | null
          subject_key?: string
          subject_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flash_notes_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flash_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      flash_occupancy_budgets: {
        Row: {
          budget_occupancy_pct: number | null
          budget_occupied_units: number | null
          community_id: string
          created_at: string
          created_by: string | null
          effective_end: string | null
          effective_start: string
          id: string
          notes: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          budget_occupancy_pct?: number | null
          budget_occupied_units?: number | null
          community_id: string
          created_at?: string
          created_by?: string | null
          effective_end?: string | null
          effective_start: string
          id?: string
          notes?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          budget_occupancy_pct?: number | null
          budget_occupied_units?: number | null
          community_id?: string
          created_at?: string
          created_by?: string | null
          effective_end?: string | null
          effective_start?: string
          id?: string
          notes?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flash_occupancy_budgets_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flash_occupancy_budgets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_community_mappings: {
        Row: {
          community_id: string | null
          created_at: string
          created_by: string | null
          id: string
          ignored: boolean
          normalized_name: string
          organization_id: string
          source_community_name: string
          updated_at: string
        }
        Insert: {
          community_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          ignored?: boolean
          normalized_name: string
          organization_id: string
          source_community_name: string
          updated_at?: string
        }
        Update: {
          community_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          ignored?: boolean
          normalized_name?: string
          organization_id?: string
          source_community_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "forecast_community_mappings_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_community_mappings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_entry_revisions: {
        Row: {
          changed_at: string
          changed_by: string | null
          community_id: string
          correction_reason: string | null
          entry_id: string
          forecast_date: string
          id: string
          organization_id: string
          previous_move_ins: number | null
          previous_move_outs: number | null
          previous_notes: string | null
          previous_stretch_goal: number | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          community_id: string
          correction_reason?: string | null
          entry_id: string
          forecast_date: string
          id?: string
          organization_id: string
          previous_move_ins?: number | null
          previous_move_outs?: number | null
          previous_notes?: string | null
          previous_stretch_goal?: number | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          community_id?: string
          correction_reason?: string | null
          entry_id?: string
          forecast_date?: string
          id?: string
          organization_id?: string
          previous_move_ins?: number | null
          previous_move_outs?: number | null
          previous_notes?: string | null
          previous_stretch_goal?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "forecast_entry_revisions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "forecast_weekly_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_eom_source_values: {
        Row: {
          community_id: string
          created_at: string
          forecast_month: string
          id: string
          import_batch_id: string | null
          organization_id: string
          source_file_name: string | null
          source_move_ins: number | null
          source_move_outs: number | null
          source_note: string | null
          updated_at: string
        }
        Insert: {
          community_id: string
          created_at?: string
          forecast_month: string
          id?: string
          import_batch_id?: string | null
          organization_id: string
          source_file_name?: string | null
          source_move_ins?: number | null
          source_move_outs?: number | null
          source_note?: string | null
          updated_at?: string
        }
        Update: {
          community_id?: string
          created_at?: string
          forecast_month?: string
          id?: string
          import_batch_id?: string | null
          organization_id?: string
          source_file_name?: string | null
          source_move_ins?: number | null
          source_move_outs?: number | null
          source_note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "forecast_eom_source_values_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_eom_source_values_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "forecast_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_eom_source_values_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_import_batches: {
        Row: {
          ambiguous_cells: number
          communities_detected: number
          forecast_dates_detected: number
          id: string
          imported_at: string
          imported_by: string | null
          notes_imported: number
          organization_id: string
          records_imported: number
          report: Json | null
          rows_skipped: number
          source_file_name: string
          source_sheet_name: string | null
          unmapped_communities: string[]
        }
        Insert: {
          ambiguous_cells?: number
          communities_detected?: number
          forecast_dates_detected?: number
          id?: string
          imported_at?: string
          imported_by?: string | null
          notes_imported?: number
          organization_id: string
          records_imported?: number
          report?: Json | null
          rows_skipped?: number
          source_file_name: string
          source_sheet_name?: string | null
          unmapped_communities?: string[]
        }
        Update: {
          ambiguous_cells?: number
          communities_detected?: number
          forecast_dates_detected?: number
          id?: string
          imported_at?: string
          imported_by?: string | null
          notes_imported?: number
          organization_id?: string
          records_imported?: number
          report?: Json | null
          rows_skipped?: number
          source_file_name?: string
          source_sheet_name?: string | null
          unmapped_communities?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "forecast_import_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_weekly_entries: {
        Row: {
          community_id: string
          entered_at: string
          entered_by: string | null
          forecast_date: string
          forecast_month: string
          historical_source_note: string | null
          id: string
          import_batch_id: string | null
          notes: string | null
          organization_id: string
          projected_move_ins: number | null
          projected_move_outs: number | null
          projected_net: number | null
          source_file_name: string | null
          source_type: string
          stretch_goal: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          community_id: string
          entered_at?: string
          entered_by?: string | null
          forecast_date: string
          forecast_month: string
          historical_source_note?: string | null
          id?: string
          import_batch_id?: string | null
          notes?: string | null
          organization_id: string
          projected_move_ins?: number | null
          projected_move_outs?: number | null
          projected_net?: number | null
          source_file_name?: string | null
          source_type?: string
          stretch_goal?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          community_id?: string
          entered_at?: string
          entered_by?: string | null
          forecast_date?: string
          forecast_month?: string
          historical_source_note?: string | null
          id?: string
          import_batch_id?: string | null
          notes?: string | null
          organization_id?: string
          projected_move_ins?: number | null
          projected_move_outs?: number | null
          projected_net?: number | null
          source_file_name?: string | null
          source_type?: string
          stretch_goal?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forecast_weekly_entries_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_weekly_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gsc_country_facts: {
        Row: {
          clicks: number
          country: string
          created_at: string
          ctr: number | null
          id: string
          import_id: string
          impressions: number
          organization_id: string
          position: number | null
        }
        Insert: {
          clicks?: number
          country: string
          created_at?: string
          ctr?: number | null
          id?: string
          import_id: string
          impressions?: number
          organization_id: string
          position?: number | null
        }
        Update: {
          clicks?: number
          country?: string
          created_at?: string
          ctr?: number | null
          id?: string
          import_id?: string
          impressions?: number
          organization_id?: string
          position?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gsc_country_facts_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "gsc_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gsc_country_facts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gsc_daily_facts: {
        Row: {
          clicks: number
          created_at: string
          ctr: number | null
          date: string
          id: string
          import_id: string
          impressions: number
          organization_id: string
          position: number | null
        }
        Insert: {
          clicks?: number
          created_at?: string
          ctr?: number | null
          date: string
          id?: string
          import_id: string
          impressions?: number
          organization_id: string
          position?: number | null
        }
        Update: {
          clicks?: number
          created_at?: string
          ctr?: number | null
          date?: string
          id?: string
          import_id?: string
          impressions?: number
          organization_id?: string
          position?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gsc_daily_facts_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "gsc_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gsc_daily_facts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gsc_device_facts: {
        Row: {
          clicks: number
          created_at: string
          ctr: number | null
          device: string
          id: string
          import_id: string
          impressions: number
          organization_id: string
          position: number | null
        }
        Insert: {
          clicks?: number
          created_at?: string
          ctr?: number | null
          device: string
          id?: string
          import_id: string
          impressions?: number
          organization_id: string
          position?: number | null
        }
        Update: {
          clicks?: number
          created_at?: string
          ctr?: number | null
          device?: string
          id?: string
          import_id?: string
          impressions?: number
          organization_id?: string
          position?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gsc_device_facts_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "gsc_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gsc_device_facts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gsc_import_grains: {
        Row: {
          connection_id: string
          created_at: string
          grain: Database["public"]["Enums"]["gsc_grain"]
          id: string
          import_id: string
          is_active: boolean
          organization_id: string
          period_end: string | null
          period_start: string | null
          row_count: number
          source_file: string | null
        }
        Insert: {
          connection_id: string
          created_at?: string
          grain: Database["public"]["Enums"]["gsc_grain"]
          id?: string
          import_id: string
          is_active?: boolean
          organization_id: string
          period_end?: string | null
          period_start?: string | null
          row_count?: number
          source_file?: string | null
        }
        Update: {
          connection_id?: string
          created_at?: string
          grain?: Database["public"]["Enums"]["gsc_grain"]
          id?: string
          import_id?: string
          is_active?: boolean
          organization_id?: string
          period_end?: string | null
          period_start?: string | null
          row_count?: number
          source_file?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gsc_import_grains_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "data_source_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gsc_import_grains_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "gsc_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gsc_import_grains_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gsc_imports: {
        Row: {
          connection_id: string
          created_at: string
          created_by: string | null
          data_end_date: string | null
          data_start_date: string | null
          error_summary: string | null
          file_hash: string
          file_name: string
          file_size_bytes: number | null
          id: string
          import_status: Database["public"]["Enums"]["gsc_import_state"]
          imported_at: string
          metadata: Json
          organization_id: string
          source_sync_run_id: string | null
          updated_at: string
          warnings: string[]
        }
        Insert: {
          connection_id: string
          created_at?: string
          created_by?: string | null
          data_end_date?: string | null
          data_start_date?: string | null
          error_summary?: string | null
          file_hash: string
          file_name: string
          file_size_bytes?: number | null
          id?: string
          import_status?: Database["public"]["Enums"]["gsc_import_state"]
          imported_at?: string
          metadata?: Json
          organization_id: string
          source_sync_run_id?: string | null
          updated_at?: string
          warnings?: string[]
        }
        Update: {
          connection_id?: string
          created_at?: string
          created_by?: string | null
          data_end_date?: string | null
          data_start_date?: string | null
          error_summary?: string | null
          file_hash?: string
          file_name?: string
          file_size_bytes?: number | null
          id?: string
          import_status?: Database["public"]["Enums"]["gsc_import_state"]
          imported_at?: string
          metadata?: Json
          organization_id?: string
          source_sync_run_id?: string | null
          updated_at?: string
          warnings?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "gsc_imports_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "data_source_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gsc_imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gsc_imports_source_sync_run_id_fkey"
            columns: ["source_sync_run_id"]
            isOneToOne: false
            referencedRelation: "source_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      gsc_page_facts: {
        Row: {
          clicks: number
          created_at: string
          ctr: number | null
          id: string
          import_id: string
          impressions: number
          mapped_care_type_id: string | null
          mapped_community_id: string | null
          mapped_content_type: string | null
          mapped_intent_type: string | null
          mapped_topic: string | null
          mapping_rule_id: string | null
          normalized_url: string
          organization_id: string
          page_url: string
          position: number | null
        }
        Insert: {
          clicks?: number
          created_at?: string
          ctr?: number | null
          id?: string
          import_id: string
          impressions?: number
          mapped_care_type_id?: string | null
          mapped_community_id?: string | null
          mapped_content_type?: string | null
          mapped_intent_type?: string | null
          mapped_topic?: string | null
          mapping_rule_id?: string | null
          normalized_url: string
          organization_id: string
          page_url: string
          position?: number | null
        }
        Update: {
          clicks?: number
          created_at?: string
          ctr?: number | null
          id?: string
          import_id?: string
          impressions?: number
          mapped_care_type_id?: string | null
          mapped_community_id?: string | null
          mapped_content_type?: string | null
          mapped_intent_type?: string | null
          mapped_topic?: string | null
          mapping_rule_id?: string | null
          normalized_url?: string
          organization_id?: string
          page_url?: string
          position?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gsc_page_facts_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "gsc_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gsc_page_facts_mapped_care_type_id_fkey"
            columns: ["mapped_care_type_id"]
            isOneToOne: false
            referencedRelation: "care_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gsc_page_facts_mapped_community_id_fkey"
            columns: ["mapped_community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gsc_page_facts_mapping_rule_id_fkey"
            columns: ["mapping_rule_id"]
            isOneToOne: false
            referencedRelation: "url_mapping_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gsc_page_facts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gsc_query_classification_rules: {
        Row: {
          active: boolean
          classification: Database["public"]["Enums"]["query_classification"]
          created_at: string
          id: string
          match_type: Database["public"]["Enums"]["query_match_type"]
          name: string
          organization_id: string
          pattern: string
          priority: number
          secondary_tags: string[]
          updated_at: string
        }
        Insert: {
          active?: boolean
          classification: Database["public"]["Enums"]["query_classification"]
          created_at?: string
          id?: string
          match_type?: Database["public"]["Enums"]["query_match_type"]
          name: string
          organization_id: string
          pattern: string
          priority?: number
          secondary_tags?: string[]
          updated_at?: string
        }
        Update: {
          active?: boolean
          classification?: Database["public"]["Enums"]["query_classification"]
          created_at?: string
          id?: string
          match_type?: Database["public"]["Enums"]["query_match_type"]
          name?: string
          organization_id?: string
          pattern?: string
          priority?: number
          secondary_tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gsc_query_classification_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gsc_query_facts: {
        Row: {
          clicks: number
          created_at: string
          ctr: number | null
          id: string
          import_id: string
          impressions: number
          normalized_query: string
          organization_id: string
          position: number | null
          query: string
        }
        Insert: {
          clicks?: number
          created_at?: string
          ctr?: number | null
          id?: string
          import_id: string
          impressions?: number
          normalized_query: string
          organization_id: string
          position?: number | null
          query: string
        }
        Update: {
          clicks?: number
          created_at?: string
          ctr?: number | null
          id?: string
          import_id?: string
          impressions?: number
          normalized_query?: string
          organization_id?: string
          position?: number | null
          query?: string
        }
        Relationships: [
          {
            foreignKeyName: "gsc_query_facts_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "gsc_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gsc_query_facts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gsc_search_appearance_facts: {
        Row: {
          clicks: number
          created_at: string
          ctr: number | null
          id: string
          import_id: string
          impressions: number
          organization_id: string
          position: number | null
          search_appearance: string
        }
        Insert: {
          clicks?: number
          created_at?: string
          ctr?: number | null
          id?: string
          import_id: string
          impressions?: number
          organization_id: string
          position?: number | null
          search_appearance: string
        }
        Update: {
          clicks?: number
          created_at?: string
          ctr?: number | null
          id?: string
          import_id?: string
          impressions?: number
          organization_id?: string
          position?: number | null
          search_appearance?: string
        }
        Relationships: [
          {
            foreignKeyName: "gsc_search_appearance_facts_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "gsc_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gsc_search_appearance_facts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          evidence_scope: string
          expected_value: number | null
          id: string
          metric_key: string
          metric_version: number | null
          official_source: string | null
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
          evidence_scope?: string
          expected_value?: number | null
          id?: string
          metric_key: string
          metric_version?: number | null
          official_source?: string | null
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
          evidence_scope?: string
          expected_value?: number | null
          id?: string
          metric_key?: string
          metric_version?: number | null
          official_source?: string | null
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
      occupancy_history_community_mappings: {
        Row: {
          community_id: string | null
          created_at: string
          created_by: string | null
          id: string
          ignored: boolean
          normalized_name: string
          organization_id: string
          source_community_name: string
          updated_at: string
        }
        Insert: {
          community_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          ignored?: boolean
          normalized_name: string
          organization_id: string
          source_community_name: string
          updated_at?: string
        }
        Update: {
          community_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          ignored?: boolean
          normalized_name?: string
          organization_id?: string
          source_community_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "occupancy_history_community_mappings_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occupancy_history_community_mappings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      occupancy_history_import_batches: {
        Row: {
          communities_imported: number
          created_at: string
          cutoff_date: string
          future_rows_skipped: number
          id: string
          imported_at: string
          imported_by: string | null
          mapping_used: Json
          organization_id: string
          records_imported: number
          records_updated: number
          report: Json
          rows_skipped: number
          source_file_name: string
          source_range_end: string | null
          source_range_start: string | null
          source_sheet_name: string | null
          source_type: string
          source_year: number | null
          unmapped_communities: string[]
          validation_warnings: number
        }
        Insert: {
          communities_imported?: number
          created_at?: string
          cutoff_date: string
          future_rows_skipped?: number
          id?: string
          imported_at?: string
          imported_by?: string | null
          mapping_used?: Json
          organization_id: string
          records_imported?: number
          records_updated?: number
          report?: Json
          rows_skipped?: number
          source_file_name: string
          source_range_end?: string | null
          source_range_start?: string | null
          source_sheet_name?: string | null
          source_type?: string
          source_year?: number | null
          unmapped_communities?: string[]
          validation_warnings?: number
        }
        Update: {
          communities_imported?: number
          created_at?: string
          cutoff_date?: string
          future_rows_skipped?: number
          id?: string
          imported_at?: string
          imported_by?: string | null
          mapping_used?: Json
          organization_id?: string
          records_imported?: number
          records_updated?: number
          report?: Json
          rows_skipped?: number
          source_file_name?: string
          source_range_end?: string | null
          source_range_start?: string | null
          source_sheet_name?: string | null
          source_type?: string
          source_year?: number | null
          unmapped_communities?: string[]
          validation_warnings?: number
        }
        Relationships: [
          {
            foreignKeyName: "occupancy_history_import_batches_organization_id_fkey"
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
          quarantine_reason: string | null
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
          quarantine_reason?: string | null
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
          quarantine_reason?: string | null
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
      wh_activities: {
        Row: {
          activity_type_id: string | null
          activity_type_label: string | null
          assigned_to_id: string | null
          auto_performed: boolean | null
          community_id: string | null
          completed_at: string | null
          completed_local_date: string | null
          completed_successfully: boolean | null
          connection_id: string
          created_at: string
          created_at_source: string | null
          created_by_id: string | null
          direction: string | null
          discarded_at: string | null
          first_completed_of_type: boolean | null
          id: string
          ingested_at: string
          metadata: Json
          organization_id: string
          prospect_source_id: string | null
          raw_record_id: string | null
          record_id: string | null
          record_type: string | null
          result_id: string | null
          result_label: string | null
          scheduled_at: string | null
          scheduled_local_date: string | null
          source_community_id: string | null
          source_id: string
          source_timezone: string | null
          stage_id: string | null
          stage_label: string | null
          updated_at: string
          updated_at_source: string | null
          user_id_source: string | null
        }
        Insert: {
          activity_type_id?: string | null
          activity_type_label?: string | null
          assigned_to_id?: string | null
          auto_performed?: boolean | null
          community_id?: string | null
          completed_at?: string | null
          completed_local_date?: string | null
          completed_successfully?: boolean | null
          connection_id: string
          created_at?: string
          created_at_source?: string | null
          created_by_id?: string | null
          direction?: string | null
          discarded_at?: string | null
          first_completed_of_type?: boolean | null
          id?: string
          ingested_at?: string
          metadata?: Json
          organization_id: string
          prospect_source_id?: string | null
          raw_record_id?: string | null
          record_id?: string | null
          record_type?: string | null
          result_id?: string | null
          result_label?: string | null
          scheduled_at?: string | null
          scheduled_local_date?: string | null
          source_community_id?: string | null
          source_id: string
          source_timezone?: string | null
          stage_id?: string | null
          stage_label?: string | null
          updated_at?: string
          updated_at_source?: string | null
          user_id_source?: string | null
        }
        Update: {
          activity_type_id?: string | null
          activity_type_label?: string | null
          assigned_to_id?: string | null
          auto_performed?: boolean | null
          community_id?: string | null
          completed_at?: string | null
          completed_local_date?: string | null
          completed_successfully?: boolean | null
          connection_id?: string
          created_at?: string
          created_at_source?: string | null
          created_by_id?: string | null
          direction?: string | null
          discarded_at?: string | null
          first_completed_of_type?: boolean | null
          id?: string
          ingested_at?: string
          metadata?: Json
          organization_id?: string
          prospect_source_id?: string | null
          raw_record_id?: string | null
          record_id?: string | null
          record_type?: string | null
          result_id?: string | null
          result_label?: string | null
          scheduled_at?: string | null
          scheduled_local_date?: string | null
          source_community_id?: string | null
          source_id?: string
          source_timezone?: string | null
          stage_id?: string | null
          stage_label?: string | null
          updated_at?: string
          updated_at_source?: string | null
          user_id_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wh_activities_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_activities_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "data_source_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wh_activity_type_mappings: {
        Row: {
          activity_type_id: string
          activity_type_label: string | null
          category: Database["public"]["Enums"]["wh_activity_category"]
          connection_id: string
          created_at: string
          id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          activity_type_id: string
          activity_type_label?: string | null
          category?: Database["public"]["Enums"]["wh_activity_category"]
          connection_id: string
          created_at?: string
          id?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          activity_type_id?: string
          activity_type_label?: string | null
          category?: Database["public"]["Enums"]["wh_activity_category"]
          connection_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wh_activity_type_mappings_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "data_source_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_activity_type_mappings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wh_deposit_transactions: {
        Row: {
          amount: number | null
          community_id: string | null
          connection_id: string
          created_at: string
          created_at_source: string | null
          deposit_type: string | null
          deposit_type_id: string | null
          discarded_at: string | null
          housing_contract_source_id: string | null
          id: string
          ingested_at: string
          is_refund: boolean | null
          metadata: Json
          occurred_at: string | null
          occurred_local_date: string | null
          organization_id: string
          prospect_source_id: string | null
          raw_record_id: string | null
          refunded_at: string | null
          resident_source_id: string | null
          source_community_id: string | null
          source_id: string
          transaction_type: string | null
          updated_at: string
          updated_at_source: string | null
        }
        Insert: {
          amount?: number | null
          community_id?: string | null
          connection_id: string
          created_at?: string
          created_at_source?: string | null
          deposit_type?: string | null
          deposit_type_id?: string | null
          discarded_at?: string | null
          housing_contract_source_id?: string | null
          id?: string
          ingested_at?: string
          is_refund?: boolean | null
          metadata?: Json
          occurred_at?: string | null
          occurred_local_date?: string | null
          organization_id: string
          prospect_source_id?: string | null
          raw_record_id?: string | null
          refunded_at?: string | null
          resident_source_id?: string | null
          source_community_id?: string | null
          source_id: string
          transaction_type?: string | null
          updated_at?: string
          updated_at_source?: string | null
        }
        Update: {
          amount?: number | null
          community_id?: string | null
          connection_id?: string
          created_at?: string
          created_at_source?: string | null
          deposit_type?: string | null
          deposit_type_id?: string | null
          discarded_at?: string | null
          housing_contract_source_id?: string | null
          id?: string
          ingested_at?: string
          is_refund?: boolean | null
          metadata?: Json
          occurred_at?: string | null
          occurred_local_date?: string | null
          organization_id?: string
          prospect_source_id?: string | null
          raw_record_id?: string | null
          refunded_at?: string | null
          resident_source_id?: string | null
          source_community_id?: string | null
          source_id?: string
          transaction_type?: string | null
          updated_at?: string
          updated_at_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wh_deposit_transactions_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_deposit_transactions_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "data_source_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_deposit_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wh_housing_contracts: {
        Row: {
          care_rate: number | null
          care_type_id_source: string | null
          care_type_label: string | null
          community_fee: number | null
          community_fee_received_on: string | null
          community_id: string | null
          concessions: number | null
          connection_id: string
          contract_type: string | null
          count_move_in: boolean | null
          count_move_out: boolean | null
          created_at: string
          created_at_source: string | null
          deposit_amount: number | null
          deposit_received_at: string | null
          deposit_received_date: string | null
          discarded_at: string | null
          financial_move_in_date: string | null
          financial_move_out_date: string | null
          financial_status: string | null
          id: string
          ingested_at: string
          is_transfer: boolean | null
          lease_canceled_on: string | null
          leased_on: string | null
          metadata: Json
          monthly_rate: number | null
          move_in_date: string | null
          move_out_date: string | null
          move_out_reason_id: string | null
          move_out_reason_label: string | null
          notice_date: string | null
          occupancy_point_factor: number | null
          one_time_concession: number | null
          organization_id: string
          person_name: string | null
          privacy_level_id: string | null
          privacy_level_label: string | null
          prospect_source_id: string | null
          raw_record_id: string | null
          recurring_concession: number | null
          resident_count: number | null
          resident_source_id: string | null
          resident_source_ids: string | null
          risk_level: string | null
          sales_counselor_id: string | null
          source_community_id: string | null
          source_id: string
          status: string | null
          stay_type: string | null
          unit_number: string | null
          unit_source_id: string | null
          updated_at: string
          updated_at_source: string | null
        }
        Insert: {
          care_rate?: number | null
          care_type_id_source?: string | null
          care_type_label?: string | null
          community_fee?: number | null
          community_fee_received_on?: string | null
          community_id?: string | null
          concessions?: number | null
          connection_id: string
          contract_type?: string | null
          count_move_in?: boolean | null
          count_move_out?: boolean | null
          created_at?: string
          created_at_source?: string | null
          deposit_amount?: number | null
          deposit_received_at?: string | null
          deposit_received_date?: string | null
          discarded_at?: string | null
          financial_move_in_date?: string | null
          financial_move_out_date?: string | null
          financial_status?: string | null
          id?: string
          ingested_at?: string
          is_transfer?: boolean | null
          lease_canceled_on?: string | null
          leased_on?: string | null
          metadata?: Json
          monthly_rate?: number | null
          move_in_date?: string | null
          move_out_date?: string | null
          move_out_reason_id?: string | null
          move_out_reason_label?: string | null
          notice_date?: string | null
          occupancy_point_factor?: number | null
          one_time_concession?: number | null
          organization_id: string
          person_name?: string | null
          privacy_level_id?: string | null
          privacy_level_label?: string | null
          prospect_source_id?: string | null
          raw_record_id?: string | null
          recurring_concession?: number | null
          resident_count?: number | null
          resident_source_id?: string | null
          resident_source_ids?: string | null
          risk_level?: string | null
          sales_counselor_id?: string | null
          source_community_id?: string | null
          source_id: string
          status?: string | null
          stay_type?: string | null
          unit_number?: string | null
          unit_source_id?: string | null
          updated_at?: string
          updated_at_source?: string | null
        }
        Update: {
          care_rate?: number | null
          care_type_id_source?: string | null
          care_type_label?: string | null
          community_fee?: number | null
          community_fee_received_on?: string | null
          community_id?: string | null
          concessions?: number | null
          connection_id?: string
          contract_type?: string | null
          count_move_in?: boolean | null
          count_move_out?: boolean | null
          created_at?: string
          created_at_source?: string | null
          deposit_amount?: number | null
          deposit_received_at?: string | null
          deposit_received_date?: string | null
          discarded_at?: string | null
          financial_move_in_date?: string | null
          financial_move_out_date?: string | null
          financial_status?: string | null
          id?: string
          ingested_at?: string
          is_transfer?: boolean | null
          lease_canceled_on?: string | null
          leased_on?: string | null
          metadata?: Json
          monthly_rate?: number | null
          move_in_date?: string | null
          move_out_date?: string | null
          move_out_reason_id?: string | null
          move_out_reason_label?: string | null
          notice_date?: string | null
          occupancy_point_factor?: number | null
          one_time_concession?: number | null
          organization_id?: string
          person_name?: string | null
          privacy_level_id?: string | null
          privacy_level_label?: string | null
          prospect_source_id?: string | null
          raw_record_id?: string | null
          recurring_concession?: number | null
          resident_count?: number | null
          resident_source_id?: string | null
          resident_source_ids?: string | null
          risk_level?: string | null
          sales_counselor_id?: string | null
          source_community_id?: string | null
          source_id?: string
          status?: string | null
          stay_type?: string | null
          unit_number?: string | null
          unit_source_id?: string | null
          updated_at?: string
          updated_at_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wh_housing_contracts_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_housing_contracts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "data_source_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_housing_contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wh_lookups: {
        Row: {
          connection_id: string
          created_at: string
          id: string
          ingested_at: string
          label: string | null
          lookup_type: string
          organization_id: string
          payload: Json
          source_community_id: string | null
          source_id: string
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          id?: string
          ingested_at?: string
          label?: string | null
          lookup_type: string
          organization_id: string
          payload?: Json
          source_community_id?: string | null
          source_id: string
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          id?: string
          ingested_at?: string
          label?: string | null
          lookup_type?: string
          organization_id?: string
          payload?: Json
          source_community_id?: string | null
          source_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wh_lookups_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "data_source_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_lookups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wh_marketing_touchpoints: {
        Row: {
          added_by_type: string | null
          campaign_name: string | null
          community_id: string | null
          connection_id: string
          created_at: string
          created_at_source: string | null
          id: string
          ingested_at: string
          lead_source_id: string | null
          lead_source_label: string | null
          locked: boolean | null
          metadata: Json
          occurred_at: string | null
          occurred_local_date: string | null
          organization_id: string
          prospect_source_id: string | null
          raw_record_id: string | null
          source_community_id: string | null
          source_id: string
          updated_at: string
          updated_at_source: string | null
        }
        Insert: {
          added_by_type?: string | null
          campaign_name?: string | null
          community_id?: string | null
          connection_id: string
          created_at?: string
          created_at_source?: string | null
          id?: string
          ingested_at?: string
          lead_source_id?: string | null
          lead_source_label?: string | null
          locked?: boolean | null
          metadata?: Json
          occurred_at?: string | null
          occurred_local_date?: string | null
          organization_id: string
          prospect_source_id?: string | null
          raw_record_id?: string | null
          source_community_id?: string | null
          source_id: string
          updated_at?: string
          updated_at_source?: string | null
        }
        Update: {
          added_by_type?: string | null
          campaign_name?: string | null
          community_id?: string | null
          connection_id?: string
          created_at?: string
          created_at_source?: string | null
          id?: string
          ingested_at?: string
          lead_source_id?: string | null
          lead_source_label?: string | null
          locked?: boolean | null
          metadata?: Json
          occurred_at?: string | null
          occurred_local_date?: string | null
          organization_id?: string
          prospect_source_id?: string | null
          raw_record_id?: string | null
          source_community_id?: string | null
          source_id?: string
          updated_at?: string
          updated_at_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wh_marketing_touchpoints_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_marketing_touchpoints_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "data_source_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_marketing_touchpoints_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wh_nightly_runs: {
        Row: {
          communities_done: number
          communities_failed: number
          communities_total: number
          connection_id: string
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          lease_expires_at: string | null
          lease_token: string | null
          organization_id: string
          run_date: string
          snapshots_written: number
          started_at: string | null
          status: string
          ticks: number
          triggered_by: string
          triggered_by_user: string | null
          updated_at: string
        }
        Insert: {
          communities_done?: number
          communities_failed?: number
          communities_total?: number
          connection_id: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          organization_id: string
          run_date?: string
          snapshots_written?: number
          started_at?: string | null
          status?: string
          ticks?: number
          triggered_by?: string
          triggered_by_user?: string | null
          updated_at?: string
        }
        Update: {
          communities_done?: number
          communities_failed?: number
          communities_total?: number
          connection_id?: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          organization_id?: string
          run_date?: string
          snapshots_written?: number
          started_at?: string | null
          status?: string
          ticks?: number
          triggered_by?: string
          triggered_by_user?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wh_nightly_runs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "data_source_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_nightly_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wh_nightly_units: {
        Row: {
          attempts: number
          community_id: string
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          organization_id: string
          run_id: string
          snapshot_date: string | null
          started_at: string | null
          status: string
          sync_run_id: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          community_id: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          organization_id: string
          run_id: string
          snapshot_date?: string | null
          started_at?: string | null
          status?: string
          sync_run_id?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          community_id?: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          organization_id?: string
          run_id?: string
          snapshot_date?: string | null
          started_at?: string | null
          status?: string
          sync_run_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wh_nightly_units_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_nightly_units_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_nightly_units_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "wh_nightly_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_nightly_units_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "source_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      wh_prospects: {
        Row: {
          account_id: string | null
          active_at: string | null
          close_reason_id: string | null
          close_reason_label: string | null
          community_id: string | null
          connection_id: string
          created_at: string
          created_at_source: string | null
          current_sales_counselor_id: string | null
          discarded_at: string | null
          display_name: string | null
          expected_move_timing_id: string | null
          expected_stay_type: string | null
          id: string
          ingested_at: string
          initial_contact_at: string | null
          inquiry_date: string | null
          last_contact_at: string | null
          lead_source_category: string | null
          lead_source_id: string | null
          lead_source_label: string | null
          merged_into_prospect_id: string | null
          metadata: Json
          next_activity_scheduled_at: string | null
          organization_id: string
          original_sales_counselor_id: string | null
          raw_record_id: string | null
          referrer_id: string | null
          score_id: string | null
          score_label: string | null
          secondary_lead_source_id: string | null
          source_community_id: string | null
          source_id: string
          stage_id: string | null
          stage_label: string | null
          status: string | null
          status_changed_at: string | null
          updated_at: string
          updated_at_source: string | null
        }
        Insert: {
          account_id?: string | null
          active_at?: string | null
          close_reason_id?: string | null
          close_reason_label?: string | null
          community_id?: string | null
          connection_id: string
          created_at?: string
          created_at_source?: string | null
          current_sales_counselor_id?: string | null
          discarded_at?: string | null
          display_name?: string | null
          expected_move_timing_id?: string | null
          expected_stay_type?: string | null
          id?: string
          ingested_at?: string
          initial_contact_at?: string | null
          inquiry_date?: string | null
          last_contact_at?: string | null
          lead_source_category?: string | null
          lead_source_id?: string | null
          lead_source_label?: string | null
          merged_into_prospect_id?: string | null
          metadata?: Json
          next_activity_scheduled_at?: string | null
          organization_id: string
          original_sales_counselor_id?: string | null
          raw_record_id?: string | null
          referrer_id?: string | null
          score_id?: string | null
          score_label?: string | null
          secondary_lead_source_id?: string | null
          source_community_id?: string | null
          source_id: string
          stage_id?: string | null
          stage_label?: string | null
          status?: string | null
          status_changed_at?: string | null
          updated_at?: string
          updated_at_source?: string | null
        }
        Update: {
          account_id?: string | null
          active_at?: string | null
          close_reason_id?: string | null
          close_reason_label?: string | null
          community_id?: string | null
          connection_id?: string
          created_at?: string
          created_at_source?: string | null
          current_sales_counselor_id?: string | null
          discarded_at?: string | null
          display_name?: string | null
          expected_move_timing_id?: string | null
          expected_stay_type?: string | null
          id?: string
          ingested_at?: string
          initial_contact_at?: string | null
          inquiry_date?: string | null
          last_contact_at?: string | null
          lead_source_category?: string | null
          lead_source_id?: string | null
          lead_source_label?: string | null
          merged_into_prospect_id?: string | null
          metadata?: Json
          next_activity_scheduled_at?: string | null
          organization_id?: string
          original_sales_counselor_id?: string | null
          raw_record_id?: string | null
          referrer_id?: string | null
          score_id?: string | null
          score_label?: string | null
          secondary_lead_source_id?: string | null
          source_community_id?: string | null
          source_id?: string
          stage_id?: string | null
          stage_label?: string | null
          status?: string | null
          status_changed_at?: string | null
          updated_at?: string
          updated_at_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wh_prospects_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_prospects_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "data_source_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_prospects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wh_residents: {
        Row: {
          care_type_label: string | null
          community_id: string | null
          connection_id: string
          created_at: string
          created_at_source: string | null
          current_residence: string | null
          discarded_at: string | null
          display_name: string | null
          first_resident: boolean | null
          id: string
          marital_status: string | null
          marked_deceased_at: string | null
          metadata: Json
          organization_id: string
          person_source_id: string | null
          prospect_source_id: string | null
          source_community_id: string | null
          source_id: string
          updated_at: string
          updated_at_source: string | null
          veteran_status: string | null
          yardi_code: string | null
          yardi_id: string | null
          yardi_p_code: string | null
        }
        Insert: {
          care_type_label?: string | null
          community_id?: string | null
          connection_id: string
          created_at?: string
          created_at_source?: string | null
          current_residence?: string | null
          discarded_at?: string | null
          display_name?: string | null
          first_resident?: boolean | null
          id?: string
          marital_status?: string | null
          marked_deceased_at?: string | null
          metadata?: Json
          organization_id: string
          person_source_id?: string | null
          prospect_source_id?: string | null
          source_community_id?: string | null
          source_id: string
          updated_at?: string
          updated_at_source?: string | null
          veteran_status?: string | null
          yardi_code?: string | null
          yardi_id?: string | null
          yardi_p_code?: string | null
        }
        Update: {
          care_type_label?: string | null
          community_id?: string | null
          connection_id?: string
          created_at?: string
          created_at_source?: string | null
          current_residence?: string | null
          discarded_at?: string | null
          display_name?: string | null
          first_resident?: boolean | null
          id?: string
          marital_status?: string | null
          marked_deceased_at?: string | null
          metadata?: Json
          organization_id?: string
          person_source_id?: string | null
          prospect_source_id?: string | null
          source_community_id?: string | null
          source_id?: string
          updated_at?: string
          updated_at_source?: string | null
          veteran_status?: string | null
          yardi_code?: string | null
          yardi_id?: string | null
          yardi_p_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wh_residents_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_residents_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "data_source_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_residents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wh_score_mappings: {
        Row: {
          connection_id: string
          created_at: string
          id: string
          level: Database["public"]["Enums"]["wh_score_level"]
          organization_id: string
          score_id: string
          score_label: string | null
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["wh_score_level"]
          organization_id: string
          score_id: string
          score_label?: string | null
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["wh_score_level"]
          organization_id?: string
          score_id?: string
          score_label?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wh_score_mappings_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "data_source_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_score_mappings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wh_settings: {
        Row: {
          created_at: string
          daily_snapshots_state: string
          deposit_source: string
          exclude_discarded_prospects: boolean
          exclude_merged_prospects: boolean
          hot_no_activity_mode: string
          incremental_overlap_minutes: number
          inquiry_date_field: string
          move_in_date_field: string
          move_out_date_field: string
          organization_id: string
          pseudo_unit_patterns: string[]
          stalled_threshold_days: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_snapshots_state?: string
          deposit_source?: string
          exclude_discarded_prospects?: boolean
          exclude_merged_prospects?: boolean
          hot_no_activity_mode?: string
          incremental_overlap_minutes?: number
          inquiry_date_field?: string
          move_in_date_field?: string
          move_out_date_field?: string
          organization_id: string
          pseudo_unit_patterns?: string[]
          stalled_threshold_days?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_snapshots_state?: string
          deposit_source?: string
          exclude_discarded_prospects?: boolean
          exclude_merged_prospects?: boolean
          hot_no_activity_mode?: string
          incremental_overlap_minutes?: number
          inquiry_date_field?: string
          move_in_date_field?: string
          move_out_date_field?: string
          organization_id?: string
          pseudo_unit_patterns?: string[]
          stalled_threshold_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wh_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wh_source_communities: {
        Row: {
          connection_id: string
          created_at: string
          discovered_at: string
          id: string
          name: string | null
          organization_id: string
          payload: Json
          source_id: string
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          discovered_at?: string
          id?: string
          name?: string | null
          organization_id: string
          payload?: Json
          source_id: string
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          discovered_at?: string
          id?: string
          name?: string | null
          organization_id?: string
          payload?: Json
          source_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wh_source_communities_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "data_source_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_source_communities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wh_sync_state: {
        Row: {
          community_id: string | null
          community_scope: string
          connection_id: string
          created_at: string
          duration_ms: number | null
          error_summary: string | null
          id: string
          last_attempted_at: string | null
          last_mode: Database["public"]["Enums"]["wh_sync_mode"] | null
          last_successful_at: string | null
          organization_id: string
          resume_cursor_url: string | null
          resume_pages: number
          resume_rows: number
          resume_saved_at: string | null
          resume_updated_after: string | null
          rows_failed: number
          rows_inserted: number
          rows_received: number
          rows_unmapped: number
          rows_updated: number
          source_max_updated_at: string | null
          source_table: string
          updated_at: string
          warnings: string[]
          watermark: string | null
        }
        Insert: {
          community_id?: string | null
          community_scope?: string
          connection_id: string
          created_at?: string
          duration_ms?: number | null
          error_summary?: string | null
          id?: string
          last_attempted_at?: string | null
          last_mode?: Database["public"]["Enums"]["wh_sync_mode"] | null
          last_successful_at?: string | null
          organization_id: string
          resume_cursor_url?: string | null
          resume_pages?: number
          resume_rows?: number
          resume_saved_at?: string | null
          resume_updated_after?: string | null
          rows_failed?: number
          rows_inserted?: number
          rows_received?: number
          rows_unmapped?: number
          rows_updated?: number
          source_max_updated_at?: string | null
          source_table: string
          updated_at?: string
          warnings?: string[]
          watermark?: string | null
        }
        Update: {
          community_id?: string | null
          community_scope?: string
          connection_id?: string
          created_at?: string
          duration_ms?: number | null
          error_summary?: string | null
          id?: string
          last_attempted_at?: string | null
          last_mode?: Database["public"]["Enums"]["wh_sync_mode"] | null
          last_successful_at?: string | null
          organization_id?: string
          resume_cursor_url?: string | null
          resume_pages?: number
          resume_rows?: number
          resume_saved_at?: string | null
          resume_updated_after?: string | null
          rows_failed?: number
          rows_inserted?: number
          rows_received?: number
          rows_unmapped?: number
          rows_updated?: number
          source_max_updated_at?: string | null
          source_table?: string
          updated_at?: string
          warnings?: string[]
          watermark?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wh_sync_state_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_sync_state_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "data_source_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_sync_state_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wh_sync_table_runs: {
        Row: {
          community_id: string | null
          completed_at: string | null
          connection_id: string
          created_at: string
          current_page: number | null
          duration_ms: number | null
          error_summary: string | null
          id: string
          last_error: string | null
          last_progress_at: string | null
          mode: Database["public"]["Enums"]["wh_sync_mode"]
          organization_id: string
          pages_fetched: number
          pages_processed: number
          raw_rows_stored: number
          requested_after: string | null
          retry_count: number
          rows_failed: number
          rows_inserted: number
          rows_processed: number
          rows_received: number
          rows_unmapped: number
          rows_updated: number
          source_community_id: string | null
          source_max_updated_at: string | null
          source_table: string
          started_at: string
          status: string
          sync_run_id: string | null
          warnings: string[]
        }
        Insert: {
          community_id?: string | null
          completed_at?: string | null
          connection_id: string
          created_at?: string
          current_page?: number | null
          duration_ms?: number | null
          error_summary?: string | null
          id?: string
          last_error?: string | null
          last_progress_at?: string | null
          mode: Database["public"]["Enums"]["wh_sync_mode"]
          organization_id: string
          pages_fetched?: number
          pages_processed?: number
          raw_rows_stored?: number
          requested_after?: string | null
          retry_count?: number
          rows_failed?: number
          rows_inserted?: number
          rows_processed?: number
          rows_received?: number
          rows_unmapped?: number
          rows_updated?: number
          source_community_id?: string | null
          source_max_updated_at?: string | null
          source_table: string
          started_at?: string
          status?: string
          sync_run_id?: string | null
          warnings?: string[]
        }
        Update: {
          community_id?: string | null
          completed_at?: string | null
          connection_id?: string
          created_at?: string
          current_page?: number | null
          duration_ms?: number | null
          error_summary?: string | null
          id?: string
          last_error?: string | null
          last_progress_at?: string | null
          mode?: Database["public"]["Enums"]["wh_sync_mode"]
          organization_id?: string
          pages_fetched?: number
          pages_processed?: number
          raw_rows_stored?: number
          requested_after?: string | null
          retry_count?: number
          rows_failed?: number
          rows_inserted?: number
          rows_processed?: number
          rows_received?: number
          rows_unmapped?: number
          rows_updated?: number
          source_community_id?: string | null
          source_max_updated_at?: string | null
          source_table?: string
          started_at?: string
          status?: string
          sync_run_id?: string | null
          warnings?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "wh_sync_table_runs_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_sync_table_runs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "data_source_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_sync_table_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_sync_table_runs_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "source_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      wh_units: {
        Row: {
          care_type_id_source: string | null
          care_type_label: string | null
          community_id: string | null
          connection_id: string
          created_at: string
          created_at_source: string | null
          discarded_at: string | null
          floor: string | null
          floor_plan_id: string | null
          floor_plan_label: string | null
          floor_plan_occupancy_points: number | null
          id: string
          ingested_at: string
          market_rate: number | null
          metadata: Json
          occupancy_point_factor: number | null
          off_census: boolean | null
          organization_id: string
          privacy_level_id: string | null
          raw_record_id: string | null
          source_community_id: string | null
          source_id: string
          square_feet: number | null
          status: string | null
          unit_name: string | null
          unit_number: string | null
          updated_at: string
          updated_at_source: string | null
        }
        Insert: {
          care_type_id_source?: string | null
          care_type_label?: string | null
          community_id?: string | null
          connection_id: string
          created_at?: string
          created_at_source?: string | null
          discarded_at?: string | null
          floor?: string | null
          floor_plan_id?: string | null
          floor_plan_label?: string | null
          floor_plan_occupancy_points?: number | null
          id?: string
          ingested_at?: string
          market_rate?: number | null
          metadata?: Json
          occupancy_point_factor?: number | null
          off_census?: boolean | null
          organization_id: string
          privacy_level_id?: string | null
          raw_record_id?: string | null
          source_community_id?: string | null
          source_id: string
          square_feet?: number | null
          status?: string | null
          unit_name?: string | null
          unit_number?: string | null
          updated_at?: string
          updated_at_source?: string | null
        }
        Update: {
          care_type_id_source?: string | null
          care_type_label?: string | null
          community_id?: string | null
          connection_id?: string
          created_at?: string
          created_at_source?: string | null
          discarded_at?: string | null
          floor?: string | null
          floor_plan_id?: string | null
          floor_plan_label?: string | null
          floor_plan_occupancy_points?: number | null
          id?: string
          ingested_at?: string
          market_rate?: number | null
          metadata?: Json
          occupancy_point_factor?: number | null
          off_census?: boolean | null
          organization_id?: string
          privacy_level_id?: string | null
          raw_record_id?: string | null
          source_community_id?: string | null
          source_id?: string
          square_feet?: number | null
          status?: string | null
          unit_name?: string | null
          unit_number?: string | null
          updated_at?: string
          updated_at_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wh_units_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_units_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "data_source_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wh_units_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      can_manage_imports: {
        Args: { _org_id: string; _user_id?: string }
        Returns: boolean
      }
      flash_budget_units: {
        Args: { _as_of: string; _org_id: string; _scope: string[] }
        Returns: Json
      }
      flash_week_start: { Args: { _d: string }; Returns: string }
      forecast_eom_actuals: {
        Args: {
          _community_ids?: string[]
          _end: string
          _org_id: string
          _start: string
        }
        Returns: {
          community_id: string
          move_ins: number
          move_outs: number
          net_move_ins: number
        }[]
      }
      gsc_apply_page_mappings: { Args: { _import_id: string }; Returns: number }
      gsc_classify_query: {
        Args: { _org_id: string; _query: string }
        Returns: Database["public"]["Enums"]["query_classification"]
      }
      gsc_complete_import: {
        Args: { _import_id: string; _metadata?: Json; _through?: string }
        Returns: undefined
      }
      gsc_daily_series: {
        Args: { _end: string; _org_id: string; _start: string }
        Returns: {
          avg_position: number
          clicks: number
          ctr: number
          date: string
          impressions: number
        }[]
      }
      gsc_daily_totals: {
        Args: { _end: string; _org_id: string; _start: string }
        Returns: {
          avg_position: number
          clicks: number
          ctr: number
          days: number
          first_date: string
          impressions: number
          last_date: string
        }[]
      }
      gsc_discard_failed_import: {
        Args: { _error?: string; _import_id: string }
        Returns: undefined
      }
      gsc_import_daily_totals: {
        Args: { _end?: string; _import_id: string; _start?: string }
        Returns: {
          avg_position: number
          clicks: number
          ctr: number
          days: number
          first_date: string
          impressions: number
          last_date: string
        }[]
      }
      gsc_page_report: {
        Args: {
          _compare_import_id?: string
          _import_id: string
          _org_id: string
        }
        Returns: {
          clicks: number
          community_name: string
          ctr: number
          impressions: number
          mapped_community_id: string
          mapped_content_type: string
          mapped_intent_type: string
          mapped_topic: string
          mapping_rule_id: string
          normalized_url: string
          page_url: string
          position_value: number
          prev_clicks: number
          prev_ctr: number
          prev_impressions: number
          prev_position_value: number
        }[]
      }
      gsc_query_report: {
        Args: {
          _compare_import_id?: string
          _import_id: string
          _org_id: string
        }
        Returns: {
          classification: Database["public"]["Enums"]["query_classification"]
          clicks: number
          ctr: number
          impressions: number
          normalized_query: string
          position_value: number
          prev_clicks: number
          prev_ctr: number
          prev_impressions: number
          prev_position_value: number
          query: string
        }[]
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
      occ_history_health: {
        Args: { _community_ids?: string[]; _org_id: string }
        Returns: {
          community_id: string
          community_name: string
          first_date: string
          last_date: string
          last_import_at: string
          missing_days: number
          record_count: number
          source_type: string
          warning_count: number
        }[]
      }
      verify_cron_token: {
        Args: { _name: string; _token: string }
        Returns: boolean
      }
      wh_activity_mix: {
        Args: {
          _community_ids?: string[]
          _end: string
          _org_id: string
          _start: string
        }
        Returns: {
          activities: number
          category: string
        }[]
      }
      wh_community_capacity: {
        Args: { _org_id: string; _scope: string[] }
        Returns: {
          canonical_census: number
          canonical_occupied: number
          capacity_basis: string
          census_capacity: number
          census_rooms: number
          community_id: string
          configured_capacity: number
          excluded_units: number
          inactive_units: number
          name: string
          notice_capacity: number
          notice_rooms: number
          occupied_capacity: number
          occupied_rooms: number
          off_census_units: number
          pseudo_units: number
          reserved_capacity: number
          reserved_rooms: number
          total_unit_records: number
        }[]
      }
      wh_current_occupancy: {
        Args: { _community_ids?: string[]; _org_id: string }
        Returns: Json
      }
      wh_data_completeness: {
        Args: { _community_ids?: string[]; _org_id: string }
        Returns: {
          last_sync_at: string
          last_sync_rows: number
          source_table: string
          stored_rows: number
        }[]
      }
      wh_deposit_page: {
        Args: {
          _community_ids?: string[]
          _end: string
          _limit?: number
          _offset?: number
          _org_id: string
          _start: string
        }
        Returns: {
          amount: number
          community_id: string
          deposit_type: string
          id: string
          occurred_local_date: string
          person_name: string
          prospect_source_id: string
          source_id: string
          total_count: number
          transaction_type: string
        }[]
      }
      wh_flash_deposits: {
        Args: {
          _community_ids?: string[]
          _end: string
          _limit?: number
          _offset?: number
          _org_id: string
          _start: string
        }
        Returns: {
          amount: number
          care_type: string
          community_id: string
          deposit_date: string
          depositor_key: string
          expected_move_in_date: string
          person_name: string
          prospect_source_id: string
          source_id: string
          total_count: number
          unit_label: string
        }[]
      }
      wh_flash_hot_leads: {
        Args: {
          _community_ids?: string[]
          _limit?: number
          _offset?: number
          _org_id: string
        }
        Returns: {
          community_id: string
          counselor_id: string
          counselor_name: string
          inquiry_date: string
          last_contact_at: string
          lead_source_id: string
          lead_source_label: string
          next_activity_scheduled_at: string
          next_activity_type: string
          person_name: string
          score_label: string
          source_id: string
          stage_id: string
          stage_label: string
          status: string
          total_count: number
        }[]
      }
      wh_flash_move_ins: {
        Args: {
          _community_ids?: string[]
          _end: string
          _limit?: number
          _offset?: number
          _org_id: string
          _start: string
        }
        Returns: {
          care_type: string
          community_id: string
          is_transfer: boolean
          monthly_rate: number
          move_in_date: string
          person_name: string
          prospect_source_id: string
          resident_source_id: string
          source_id: string
          total_count: number
          unit_label: string
        }[]
      }
      wh_flash_move_outs: {
        Args: {
          _community_ids?: string[]
          _end: string
          _limit?: number
          _offset?: number
          _org_id: string
          _start: string
        }
        Returns: {
          care_type: string
          community_id: string
          move_out_date: string
          notice_date: string
          person_name: string
          prospect_source_id: string
          reason: string
          resident_source_id: string
          source_id: string
          total_count: number
          unit_label: string
        }[]
      }
      wh_flash_notices: {
        Args: {
          _community_ids?: string[]
          _end: string
          _limit?: number
          _offset?: number
          _org_id: string
          _start: string
        }
        Returns: {
          care_type: string
          community_id: string
          expected_move_out_date: string
          notice_date: string
          person_name: string
          reason: string
          resident_source_id: string
          source_id: string
          total_count: number
          unit_label: string
        }[]
      }
      wh_flash_occupancy: {
        Args: { _org_id: string; _scope: string[] }
        Returns: Json
      }
      wh_flash_period_metrics: {
        Args: {
          _end: string
          _org_id: string
          _scope: string[]
          _start: string
        }
        Returns: Json
      }
      wh_flash_report: {
        Args: {
          _community_ids?: string[]
          _end: string
          _month: string
          _org_id: string
          _start: string
        }
        Returns: Json
      }
      wh_flash_scope: {
        Args: { _community_ids: string[]; _org_id: string }
        Returns: string[]
      }
      wh_is_hot_score: {
        Args: { _org_id: string; _score_id: string; _score_label: string }
        Returns: boolean
      }
      wh_lookup_coverage: {
        Args: { _community_ids?: string[]; _org_id: string }
        Returns: {
          lookup_type: string
          referenced: number
          resolved: number
          unresolved: number
          unresolved_ids: string[]
        }[]
      }
      wh_lost_lead_summary: {
        Args: {
          _community_ids?: string[]
          _end: string
          _months?: number
          _org_id: string
        }
        Returns: {
          lost_leads: number
          month: string
          reason_label: string
        }[]
      }
      wh_move_in_page: {
        Args: {
          _community_ids?: string[]
          _end: string
          _limit?: number
          _mode?: string
          _offset?: number
          _org_id: string
          _start: string
        }
        Returns: {
          care_type: string
          community_id: string
          financial_move_in_date: string
          id: string
          person_name: string
          prospect_source_id: string
          source_id: string
          status: string
          total_count: number
          unit_label: string
          unit_source_id: string
        }[]
      }
      wh_move_ins_by_lead_source_monthly: {
        Args: {
          _community_ids?: string[]
          _end: string
          _months?: number
          _org_id: string
        }
        Returns: {
          lead_source_label: string
          month: string
          move_ins: number
        }[]
      }
      wh_move_out_reason_summary: {
        Args: {
          _community_ids?: string[]
          _end: string
          _months?: number
          _org_id: string
        }
        Returns: {
          los_days: number
          los_sample: number
          month: string
          move_outs: number
          reason_label: string
        }[]
      }
      wh_new_inquiries_monthly: {
        Args: {
          _community_ids?: string[]
          _end: string
          _grain?: string
          _org_id: string
          _periods?: number
        }
        Returns: {
          bucket: string
          inquiries: number
        }[]
      }
      wh_nightly_claim: {
        Args: { _lease_seconds?: number; _run_id: string }
        Returns: string
      }
      wh_nightly_claim_unit: {
        Args: { _lease_token: string; _run_id: string }
        Returns: string
      }
      wh_nightly_release: {
        Args: { _lease_token: string; _run_id: string }
        Returns: undefined
      }
      wh_norm_unit_label: { Args: { _v: string }; Returns: string }
      wh_occupancy_asof: {
        Args: {
          _community_ids?: string[]
          _date?: string
          _org_id: string
          _tolerance?: number
        }
        Returns: Json
      }
      wh_occupancy_history_daily: {
        Args: {
          _end: string
          _org_id: string
          _scope: string[]
          _start: string
        }
        Returns: {
          beginning_occupied: number
          budget: number
          census: number
          community_id: string
          d: string
          notice: number
          occupied: number
          reserved: number
          src: string
          vacant: number
        }[]
      }
      wh_occupancy_monthly_history: {
        Args: {
          _community_ids?: string[]
          _end: string
          _org_id: string
          _start: string
        }
        Returns: {
          backfill_communities: number
          beginning_census: number
          beginning_occupied: number
          beginning_pct: number
          budget_pct: number
          communities_in_scope: number
          communities_with_history: number
          ending_census: number
          ending_occupied: number
          ending_pct: number
          month: string
          move_ins: number
          move_outs: number
          net_move_ins: number
          period_end: string
          period_start: string
          snapshot_communities: number
        }[]
      }
      wh_occupancy_trend: {
        Args: {
          _community_ids?: string[]
          _end?: string
          _grain?: string
          _org_id: string
          _start?: string
        }
        Returns: {
          backfill_communities: number
          beginning_occupied: number
          budget_pct: number
          budget_units: number
          census_units: number
          communities: number
          notice_count: number
          occupancy_pct: number
          occupied_units: number
          period_start: string
          reserved_count: number
          snapshot_communities: number
          snapshot_date: string
          vacant_units: number
          variance_units: number
        }[]
      }
      wh_person_label: {
        Args: {
          _org_id: string
          _prospect_source_id: string
          _resident_source_id: string
        }
        Returns: string
      }
      wh_prospect_page: {
        Args: {
          _bucket: string
          _community_ids?: string[]
          _limit?: number
          _offset?: number
          _org_id: string
        }
        Returns: {
          community_id: string
          current_sales_counselor_id: string
          id: string
          last_contact_at: string
          next_activity_scheduled_at: string
          person_name: string
          score_id: string
          source_id: string
          stage_id: string
          status: string
          total_count: number
        }[]
      }
      wh_record_snapshot_failure: {
        Args: {
          _community_id: string
          _connection_id?: string
          _org_id: string
          _reason: string
          _snapshot_date?: string
          _sync_run_id?: string
        }
        Returns: Json
      }
      wh_sales_summary: {
        Args: {
          _community_ids?: string[]
          _end: string
          _org_id: string
          _start: string
        }
        Returns: Json
      }
      wh_sales_trend: {
        Args: {
          _community_ids?: string[]
          _end: string
          _months?: number
          _org_id: string
        }
        Returns: {
          deposits: number
          inquiries: number
          month: string
          move_ins: number
          move_outs: number
          net_move_ins: number
          re_tours: number
          tours: number
        }[]
      }
      wh_snapshot_asof: {
        Args: {
          _date: string
          _org_id: string
          _scope: string[]
          _tolerance?: number
        }
        Returns: Json
      }
      wh_snapshot_health: {
        Args: { _community_ids?: string[]; _org_id: string }
        Returns: {
          community_id: string
          community_name: string
          days_behind: number
          expected_snapshot_date: string
          first_snapshot_date: string
          last_failure_date: string
          last_failure_reason: string
          last_snapshot_at: string
          last_snapshot_date: string
          last_successful_sync_at: string
          last_sync_status: string
          snapshot_count: number
          snapshot_missing: boolean
          source_stale: boolean
          timezone: string
        }[]
      }
      wh_successful_result_ids: { Args: { _org_id: string }; Returns: string[] }
      wh_successful_result_labels: {
        Args: { _org_id: string }
        Returns: string[]
      }
      wh_sync_reap_stalled: {
        Args: { _org_id: string; _stall_minutes?: number }
        Returns: Json
      }
      wh_tour_page: {
        Args: {
          _community_ids?: string[]
          _end: string
          _limit?: number
          _mode?: string
          _offset?: number
          _org_id: string
          _start: string
        }
        Returns: {
          activity_type_label: string
          community_id: string
          completed_local_date: string
          first_completed_of_type: boolean
          id: string
          person_name: string
          prospect_source_id: string
          result_label: string
          source_id: string
          successful: boolean
          total_count: number
        }[]
      }
      wh_unit_census_exclusion: {
        Args: {
          _discarded_at: string
          _floor_plan_label: string
          _off_census: boolean
          _pseudo_patterns: string[]
          _status: string
          _unit_name: string
          _unit_number: string
        }
        Returns: string
      }
      wh_unit_census_report: {
        Args: { _community_ids?: string[]; _org_id: string }
        Returns: {
          exclusion_reason: string
          floor_plan_label: string
          source_id: string
          unit_name: string
          unit_number: string
        }[]
      }
      wh_unit_census_rows: {
        Args: { _org_id: string; _scope: string[] }
        Returns: {
          care_type: string
          community_id: string
          exclusion_reason: string
          notice_capacity: number
          notice_room: number
          occupied_capacity: number
          occupied_room: number
          points: number
          reserved_capacity: number
          reserved_room: number
          source_id: string
        }[]
      }
      wh_user_label: {
        Args: { _org_id: string; _user_id: string }
        Returns: string
      }
      wh_write_daily_snapshot: {
        Args: {
          _community_id: string
          _connection_id?: string
          _org_id: string
          _snapshot_date?: string
          _source_through?: string
          _sync_run_id?: string
        }
        Returns: Json
      }
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
      gsc_grain:
        | "daily"
        | "query"
        | "page"
        | "device"
        | "country"
        | "search_appearance"
      gsc_import_state:
        | "pending"
        | "parsed"
        | "imported"
        | "failed"
        | "duplicate"
      metric_status: "draft" | "provisional" | "validated" | "deprecated"
      metric_validation_state:
        | "unvalidated"
        | "in_review"
        | "validated"
        | "failed"
      query_classification:
        | "branded"
        | "local_intent"
        | "cost_intent"
        | "informational"
        | "care_type_intent"
        | "competitor"
        | "other"
      query_match_type: "exact_phrase" | "contains" | "starts_with" | "regex"
      sync_run_status:
        | "running"
        | "success"
        | "partial"
        | "failed"
        | "unsupported"
        | "queued"
        | "canceled"
      url_match_type: "exact_url" | "url_contains" | "path_prefix" | "regex"
      validation_check_status:
        | "pending"
        | "matched"
        | "mismatch"
        | "approved"
        | "needs_review"
      wh_activity_category:
        | "tour"
        | "re_tour"
        | "call"
        | "email"
        | "outreach"
        | "appointment"
        | "other"
        | "unmapped"
        | "text"
        | "salesmail"
      wh_score_level: "hot" | "warm" | "cold" | "unknown"
      wh_sync_mode: "full" | "incremental"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      gsc_grain: [
        "daily",
        "query",
        "page",
        "device",
        "country",
        "search_appearance",
      ],
      gsc_import_state: [
        "pending",
        "parsed",
        "imported",
        "failed",
        "duplicate",
      ],
      metric_status: ["draft", "provisional", "validated", "deprecated"],
      metric_validation_state: [
        "unvalidated",
        "in_review",
        "validated",
        "failed",
      ],
      query_classification: [
        "branded",
        "local_intent",
        "cost_intent",
        "informational",
        "care_type_intent",
        "competitor",
        "other",
      ],
      query_match_type: ["exact_phrase", "contains", "starts_with", "regex"],
      sync_run_status: [
        "running",
        "success",
        "partial",
        "failed",
        "unsupported",
        "queued",
        "canceled",
      ],
      url_match_type: ["exact_url", "url_contains", "path_prefix", "regex"],
      validation_check_status: [
        "pending",
        "matched",
        "mismatch",
        "approved",
        "needs_review",
      ],
      wh_activity_category: [
        "tour",
        "re_tour",
        "call",
        "email",
        "outreach",
        "appointment",
        "other",
        "unmapped",
        "text",
        "salesmail",
      ],
      wh_score_level: ["hot", "warm", "cold", "unknown"],
      wh_sync_mode: ["full", "incremental"],
    },
  },
} as const
