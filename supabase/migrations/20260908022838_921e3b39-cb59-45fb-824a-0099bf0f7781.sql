-- Paid Media Intelligence: explicit paid lead-source classification.
create table if not exists public.wh_paid_lead_source_classifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_source_id text not null,
  lead_source_label text not null,
  channel text not null check (channel in ('google_ads_explicit','paid_search_generic','other_paid')),
  include_in_google_ads_cost boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, lead_source_id)
);

grant select on public.wh_paid_lead_source_classifications to authenticated;
grant all on public.wh_paid_lead_source_classifications to service_role;
alter table public.wh_paid_lead_source_classifications enable row level security;

drop policy if exists "org members read paid source classifications" on public.wh_paid_lead_source_classifications;
create policy "org members read paid source classifications"
on public.wh_paid_lead_source_classifications for select to authenticated
using (public.has_org_access(organization_id));

drop policy if exists "import managers manage paid source classifications" on public.wh_paid_lead_source_classifications;
create policy "import managers manage paid source classifications"
on public.wh_paid_lead_source_classifications for all to authenticated
using (public.can_manage_imports(organization_id))
with check (public.can_manage_imports(organization_id));

insert into public.wh_paid_lead_source_classifications
  (organization_id, lead_source_id, lead_source_label, channel, include_in_google_ads_cost, notes)
select distinct on (l.organization_id, l.source_id)
  l.organization_id,
  l.source_id,
  l.label,
  case
    when l.label in ('Google Ads Search','Google Ads Display','PMAX') then 'google_ads_explicit'
    when l.label in ('Paid Search','Paid search','Paid Search (online1)','Google') then 'paid_search_generic'
    else 'other_paid'
  end,
  l.label in ('Google Ads Search','Google Ads Display','PMAX','Paid Search','Paid search','Paid Search (online1)','Google'),
  'Seeded from the WelcomeHome lead-source list.'
from public.wh_lookups l
where l.lookup_type = 'lead_source'
  and l.label in ('Google Ads Search','Google Ads Display','PMAX','Paid Search','Paid search',
                  'Paid Search (online1)','Google','Bing','Paid social','Display','ConversionLogix')
on conflict (organization_id, lead_source_id) do nothing;