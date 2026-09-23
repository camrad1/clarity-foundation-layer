import type { ReactNode } from "react";
import { EmptyState } from "@/components/clarity/empty-state";
import { PageHeader } from "@/components/clarity/page-header";
import { useOrgRole } from "@/lib/clarity-queries";
import { useAppState } from "@/state/app-state";

/**
 * Administrative access is a separate concept from data scope. Seeing every
 * community (Corporate Admin, Corporate User) does not imply system-level
 * administration.
 *
 * - "system": metric registry, goals, validation, mapping and configuration
 *   surfaces — Super Admin only.
 * - "imports": integrations, connections and import surfaces — Super Admin and
 *   the existing Marketing User import role.
 *
 * This is the interface half of the rule only; RLS remains the enforcement
 * boundary, so a denied user cannot read or write the underlying data even by
 * opening the URL directly. The gate wraps the page rather than returning early
 * from inside it, so the page's own hooks never run for a denied user.
 */
export type AdminCapability = "system" | "imports";

export function AdminGate({
  capability,
  title,
  children,
}: {
  capability: AdminCapability;
  title: string;
  children: ReactNode;
}) {
  const { organizationId } = useAppState();
  const { loading, isPlatformAdmin, canManageImports } = useOrgRole(organizationId);
  const allowed = capability === "system" ? isPlatformAdmin : canManageImports;

  if (loading) return null;
  if (allowed) return <>{children}</>;

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Admin" title={title} />
      <EmptyState
        title="You do not have access to this page"
        description="This area is reserved for super administrators. Ask a super administrator if you need changes made here."
      />
    </div>
  );
}
