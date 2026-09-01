import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Link2 } from "lucide-react";
import { DataTable } from "@/components/clarity/data-table";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { RecordFormDialog } from "@/components/clarity/record-form-dialog";
import { StatusPill } from "@/components/clarity/status-pill";
import { supabase } from "@/integrations/supabase/client";
import { useCommunities, useCommunityMappings, useSourceTypes } from "@/lib/clarity-queries";
import { useAppState } from "@/state/app-state";

export const Route = createFileRoute("/_authenticated/admin/mappings")({
  head: () => ({
    meta: [
      { title: "Community Mappings — ClarityIQ Admin" },
      {
        name: "description",
        content:
          "Map external system identifiers to canonical ClarityIQ communities so every source resolves consistently.",
      },
      { property: "og:title", content: "Community Mappings — ClarityIQ Admin" },
      {
        property: "og:description",
        content: "Resolve WelcomeHome, Further and Search Console identifiers to one community ID.",
      },
    ],
  }),
  component: Mappings;
});

function Mappings() {
  return null;
}
