alter table public.google_connections drop constraint google_connections_service_check;
alter table public.google_connections add constraint google_connections_service_check check (service = any (array['search_console','ga4','google_ads']));
alter table public.google_oauth_states drop constraint google_oauth_states_service_check;
alter table public.google_oauth_states add constraint google_oauth_states_service_check check (service = any (array['search_console','ga4','google_ads']));
alter table public.google_sync_runs drop constraint google_sync_runs_service_check;
alter table public.google_sync_runs add constraint google_sync_runs_service_check check (service = any (array['search_console','ga4','google_ads']));

alter table public.google_connections
  add column if not exists ads_manager_customer_id text,
  add column if not exists ads_customer_id text,
  add column if not exists ads_customer_name text,
  add column if not exists ads_currency_code text,
  add column if not exists ads_time_zone text,
  add column if not exists ads_test_ok_at timestamptz;

create table if not exists public.google_ads_api_facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid references public.google_connections(id) on delete set null,
  sync_run_id uuid references public.google_sync_runs(id) on delete set null,
  source_system text not null default 'google_ads_api',
  customer_id text not null,
  login_customer_id text,
  grain text not null check (grain = any (array['account_day','campaign_day','device_day','ad_group_day','conversion_action_day'])),
  date date not null,
  dim_key text not null default '-',
  campaign_id text,
  campaign_name text,
  campaign_status text,
  advertising_channel_type text,
  ad_group_id text,
  ad_group_name text,
  device text,
  conversion_action_id text,
  conversion_action_name text,
  conversion_action_category text,
  conversion_action_primary boolean,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  cost_micros bigint not null default 0,
  cost numeric,
  ctr numeric,
  average_cpc_micros bigint,
  average_cpc numeric,
  conversions numeric not null default 0,
  conversions_value numeric not null default 0,
  currency_code text,
  time_zone text,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, customer_id, grain, date, dim_key)
);

create index if not exists google_ads_api_facts_org_grain_date_idx
  on public.google_ads_api_facts (organization_id, grain, date);

grant select on public.google_ads_api_facts to authenticated;
grant all on public.google_ads_api_facts to service_role;
alter table public.google_ads_api_facts enable row level security;
create policy "Import managers read google ads api facts"
  on public.google_ads_api_facts for select to authenticated
  using (public.can_manage_imports(organization_id));