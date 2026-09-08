create or replace function public.wh_paid_media_outcomes(
  _org_id uuid, _start date, _end date, _community_ids uuid[] default null
) returns jsonb
language plpgsql security definer set search_path to 'public' set statement_timeout to '55s'
as $$
declare
  scope uuid[];
  s record;
  tour_ids text[];
  ok_ids text[];
  paid_ids text[];
  res jsonb;
begin
  if not public.has_org_access(_org_id) then
    raise exception 'Not authorized for this organization';
  end if;

  select coalesce(array_agg(c.id), array[]::uuid[]) into scope
    from public.communities c
   where c.organization_id = _org_id
     and public.has_community_access(c.id)
     and (_community_ids is null or coalesce(array_length(_community_ids,1),0) = 0
          or c.id = any(_community_ids));

  select coalesce(x.inquiry_date_field,'created_at_source') as inquiry_date_field,
         coalesce(x.move_in_date_field,'move_in_date') as move_in_date_field,
         coalesce(x.exclude_merged_prospects,true) as exclude_merged_prospects,
         coalesce(x.exclude_discarded_prospects,true) as exclude_discarded_prospects
    into s
    from (select 1) d left join public.wh_settings x on x.organization_id = _org_id;

  select array_agg(activity_type_id) into tour_ids
    from public.wh_activity_type_mappings
   where organization_id = _org_id and category = 'tour';
  ok_ids := public.wh_successful_result_ids(_org_id);

  select array_agg(lead_source_id) into paid_ids
    from public.wh_paid_lead_source_classifications
   where organization_id = _org_id and include_in_google_ads_cost is true;
  paid_ids := coalesce(paid_ids, array[]::text[]);

  with p as (
    select pr.id, pr.source_id, pr.community_id, pr.lead_source_id,
           pr.merged_into_prospect_id, pr.discarded_at,
           (case s.inquiry_date_field
              when 'initial_contact_at' then pr.initial_contact_at
              when 'active_at' then pr.active_at
              else pr.created_at_source end
            at time zone coalesce(c.timezone,'UTC'))::date as inq_local_date
      from public.wh_prospects pr
      left join public.communities c on c.id = pr.community_id
     where pr.organization_id = _org_id and pr.community_id = any(scope)
  ),
  pc as (
    select * from p
     where (not s.exclude_merged_prospects or merged_into_prospect_id is null)
       and (not s.exclude_discarded_prospects or discarded_at is null)
  ),
  paid_p as (select * from pc where lead_source_id = any(paid_ids)),
  inq as (select * from paid_p where inq_local_date between _start and _end),
  tours_ok as (
    select ac.id, ac.completed_local_date, pp.community_id, pp.lead_source_id
      from public.wh_activities ac
      join paid_p pp on pp.source_id = ac.prospect_source_id
     where ac.organization_id = _org_id and ac.community_id = any(scope)
       and ac.discarded_at is null and ac.completed_at is not null
       and ac.completed_local_date between _start and _end
       and tour_ids is not null and ac.activity_type_id = any(tour_ids)
       and ac.result_id is not null and ac.result_id = any(ok_ids)
  ),
  mi_p as (
    select hc.id, pp.community_id, pp.lead_source_id, x.mi_date
      from public.wh_housing_contracts hc
      join paid_p pp on pp.source_id = hc.prospect_source_id
      cross join lateral (select (case when s.move_in_date_field = 'financial_move_in_date'
                 then hc.financial_move_in_date else hc.move_in_date end) as mi_date) x
     where hc.organization_id = _org_id and hc.community_id = any(scope)
       and hc.lease_canceled_on is null and hc.count_move_in is true
       and x.mi_date between _start and _end
  ),
  parts as (
    select to_char(inq_local_date,'YYYY-MM') as m, community_id, lead_source_id, 1 n, 0 t, 0 mv from inq
    union all
    select to_char(completed_local_date,'YYYY-MM'), community_id, lead_source_id, 0, 1, 0 from tours_ok
    union all
    select to_char(mi_date,'YYYY-MM'), community_id, lead_source_id, 0, 0, 1 from mi_p
  ),
  by_month as (select m, sum(n)::int n, sum(t)::int t, sum(mv)::int mv from parts group by m),
  by_comm as (select community_id, sum(n)::int n, sum(t)::int t, sum(mv)::int mv from parts group by community_id),
  by_src as (select lead_source_id, sum(n)::int n, sum(t)::int t, sum(mv)::int mv from parts group by lead_source_id)
  select jsonb_build_object(
    'paidLeadSourceIds', to_jsonb(paid_ids),
    'inquiries', (select count(*)::int from inq),
    'tours', (select count(*)::int from tours_ok),
    'moveIns', (select count(*)::int from mi_p),
    'allInquiries', (select count(*)::int from pc where inq_local_date between _start and _end),
    'byMonth', coalesce((select jsonb_agg(jsonb_build_object(
        'month', m, 'inquiries', n, 'tours', t, 'moveIns', mv) order by m) from by_month), '[]'::jsonb),
    'byCommunity', coalesce((select jsonb_agg(jsonb_build_object(
        'communityId', community_id, 'inquiries', n, 'tours', t, 'moveIns', mv)) from by_comm), '[]'::jsonb),
    'bySource', coalesce((select jsonb_agg(jsonb_build_object(
        'leadSourceId', lead_source_id, 'inquiries', n, 'tours', t, 'moveIns', mv)) from by_src), '[]'::jsonb),
    'latestProspectDate', (select max(inq_local_date) from pc)
  ) into res;

  return res;
end;
$$;

revoke all on function public.wh_paid_media_outcomes(uuid, date, date, uuid[]) from public, anon;
grant execute on function public.wh_paid_media_outcomes(uuid, date, date, uuid[]) to authenticated, service_role;