import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Building2,
  ChevronsUpDown,
  Compass,
  Database,
  GitCompareArrows,
  Globe,
  Goal,
  LayoutDashboard,
  Link2,
  PlugZap,
  LogOut,
  Ruler,
  ShieldCheck,
  Signal,
  TrendingUp,
  Users,
  Tags,
  Upload,
  Zap,

} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useMyMemberships, useOrgRole } from "@/lib/clarity-queries";
import { useAppState } from "@/state/app-state";
import { cn } from "@/lib/utils";
import { GlobalFilterBar } from "./global-filter-bar";

type NavItem = { to: string; label: string; icon: typeof Compass };

const INTELLIGENCE: NavItem[] = [
  { to: "/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/flash", label: "Flash Report", icon: Zap },

  { to: "/marketing", label: "Marketing Intelligence", icon: Globe },
  { to: "/sales", label: "Sales Intelligence", icon: TrendingUp },
  { to: "/occupancy", label: "Occupancy Intelligence", icon: Building2 },
  { to: "/journey", label: "Performance Journey", icon: Compass },
  { to: "/data-health", label: "Data Health", icon: Activity },
];

const ADMIN: NavItem[] = [
  { to: "/admin/communities", label: "Communities", icon: Building2 },
  { to: "/admin/mappings", label: "Community Mappings", icon: Link2 },
  { to: "/admin/url-rules", label: "URL Mapping Rules", icon: Signal },
  { to: "/admin/query-rules", label: "Query Classification", icon: Tags },
  { to: "/admin/gsc-imports", label: "Search Console Imports", icon: Upload },
  { to: "/admin/occupancy-history", label: "Occupancy History Import", icon: Upload },
  { to: "/admin/welcomehome", label: "WelcomeHome Connection", icon: PlugZap },
  { to: "/admin/wh-mappings", label: "WelcomeHome Mapping", icon: Link2 },
  { to: "/admin/data-sources", label: "Data Sources", icon: Database },
  { to: "/admin/metrics", label: "Metric Registry", icon: Ruler },
  { to: "/admin/goals", label: "Goals", icon: Goal },
  { to: "/admin/validation", label: "Validation Center", icon: GitCompareArrows },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const memberships = useMyMemberships();
  const { organizationId, setOrganizationId } = useAppState();
  const { isPlatformAdmin, isOrgAdmin, canManageImports } = useOrgRole(organizationId);

  const orgs = (memberships.data ?? [])
    .map((m) => m.organizations)
    .filter((o): o is NonNullable<typeof o> => !!o)
    .filter((o, i, arr) => arr.findIndex((x) => x.id === o.id) === i);

  const activeOrg = orgs.find((o) => o.id === organizationId) ?? orgs[0] ?? null;

  useEffect(() => {
    if (activeOrg && activeOrg.id !== organizationId) setOrganizationId(activeOrg.id);
  }, [activeOrg, organizationId, setOrganizationId]);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-5">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Signal className="size-4" />
          </div>
          <span className="font-display text-base font-semibold tracking-tight">ClarityIQ</span>
        </div>

        <div className="px-3 py-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-between bg-surface font-normal"
                size="sm"
              >
                <span className="truncate">{activeOrg?.name ?? "No organization"}</span>
                <ChevronsUpDown className="size-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Organizations</DropdownMenuLabel>
              {orgs.length ? (
                orgs.map((o) => (
                  <DropdownMenuItem key={o.id} onSelect={() => setOrganizationId(o.id)}>
                    {o.name}
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuItem disabled>No memberships</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
          <div className="space-y-0.5">
            {INTELLIGENCE.map((item) => (
              <NavLink
                key={item.to}
                item={item}
                active={pathname === item.to || pathname.startsWith(`${item.to}/`)}
              />
            ))}
          </div>

          {isOrgAdmin ? (
            <div className="space-y-0.5">
              <p className="px-2.5 pb-1 eyebrow">Admin</p>
              {isPlatformAdmin ? (
                <NavLink
                  item={{ to: "/admin/organizations", label: "Organizations", icon: ShieldCheck }}
                  active={pathname === "/admin/organizations"}
                />
              ) : null}
              {ADMIN.map((item) => (
                <NavLink
                key={item.to}
                item={item}
                active={pathname === item.to || pathname.startsWith(`${item.to}/`)}
              />
              ))}
              <NavLink
                item={{ to: "/admin/access", label: "Users & Access", icon: Users }}
                active={pathname === "/admin/access"}
              />
            </div>
          ) : canManageImports ? (
            // Marketing users manage Search Console imports only — no other
            // organization administration is exposed to them.
            <div className="space-y-0.5">
              <p className="px-2.5 pb-1 eyebrow">Admin</p>
              <NavLink
                item={{ to: "/admin/gsc-imports", label: "Search Console Imports", icon: Upload }}
                active={pathname === "/admin/gsc-imports"}
              />
              <NavLink
                item={{ to: "/admin/welcomehome", label: "WelcomeHome Connection", icon: PlugZap }}
                active={pathname === "/admin/welcomehome"}
              />
              <NavLink
                item={{ to: "/admin/wh-mappings", label: "WelcomeHome Mapping", icon: Link2 }}
                active={pathname === "/admin/wh-mappings"}
              />
            </div>
          ) : null}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 font-normal text-muted-foreground"
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/auth";
            }}
          >
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-border bg-background/85 px-6 backdrop-blur">
          <GlobalFilterBar />
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-8 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
