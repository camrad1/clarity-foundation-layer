import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { GoogleService } from "./config";

/**
 * Browser reads of Google connection state. RLS restricts these rows to people
 * who can manage imports for the organization. Tokens live in a separate
 * server-only table and are never readable here.
 */
export type GoogleConnection = {
  id: string;
  organization_id: string;
  service: GoogleService;
  status: string;
  google_account_email: string | null;
  granted_scopes: string[] | null;
  selected_property_id: string | null;
  selected_property_name: string | null;
  selected_property_type: string | null;
  last_successful_sync_at: string | null;
  last_attempted_sync_at: string | null;
  latest_data_date: string | null;
  rows_synced: number;
  last_error: string | null;
  updated_at: string;
};

export function useGoogleConnection(organizationId: string | null, service: GoogleService) {
  return useQuery({
    queryKey: ["google_connection", organizationId, service],
    enabled: !!organizationId,
    queryFn: async (): Promise<GoogleConnection | null> => {
      const { data, error } = await supabase
        .from("google_connections")
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("service", service)
        .maybeSingle();
      if (error) throw error;
      return (data as GoogleConnection | null) ?? null;
    },
  });
}
