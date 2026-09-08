create or replace function public.google_ads_paid_report(
  _org_id uuid, _start date, _end date, _community_ids uuid[] default null
) returns jsonb
language plpgsql security definer set search_path to 'public' set statement_timeout to '55s'
as $$
declare
  scope uuid[];
  scoped boolean;
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

  scoped := _community_ids is not null and coalesce(array_length(_community_ids,1),0) > 0;

  with map as (
    select m.campaign_id, m.canonical_community_id, c.name as community_name
      from public.google_ads_campaign_community_mappings m
      left join public.communities c on c.id = m.canonical_community_id
     where m.organization_id = _org_id and m.is_active is true
       and m.canonical_community_id is not null
  ),
  camp as (
    select f.date, f.campaign_id, f.campaign_name, f.campaign_status,
           f.advertising_channel_type, f.impressions, f.clicks, f.cost,
           f.conversions, f.conversions_value,
           mp.canonical_community_id, mp.community_name
      from public.google_ads_api_facts f
      left join map mp on mp.campaign_id = f.campaign_id
     where f.organization_id = _org_id and f.grain = 'campaign_day'
       and f.date between _start and _end
  ),
  camp_scoped as (
    select * from camp
     where not scoped or (canonical_community_id is not null and canonical_community_id = any(scope))
  ),
  acct as (
    select f.date, f.impressions, f.clicks, f.cost, f.conversions, f.conversions_value
      from public.google_ads_api_facts f
     where f.organization_id = _org_id and f.grain = 'account_day'
       and f.date between _start and _end
  ),
  series as (
    select d.date,
           sum(d.cost)::numeric as spend,
           sum(d.impressions)::bigint as impressions,
           sum(d.clicks)::bigint as clicks,
           sum(d.conversions)::numeric as conversions,
           sum(d.conversions_value)::numeric as conversions_value
      from (
        select date, impressions, clicks, cost, conversions, conversions_value from acct where not scoped
        union all
        select date, impressions, clicks, cost, conversions, conversions_value from camp_scoped where scoped
      ) d
     group by d.date
  )
  select jsonb_build_object(
    'scoped', scoped,
    'totals', (select jsonb_build_object(
        'spend', coalesce(sum(spend),0),
        'impressions', coalesce(sum(impressions),0),
        'clicks', coalesce(sum(clicks),0),
        'conversions', coalesce(sum(conversions),0),
        'conversionsValue', coalesce(sum(conversions_value),0),
        'firstDate', min(date), 'lastDate', max(date), 'days', count(*)::int
      ) from series),
    'series', coalesce((select jsonb_agg(jsonb_build_object(
        'date', date, 'spend', spend, 'impressions', impressions,
        'clicks', clicks, 'conversions', conversions, 'conversionsValue', conversions_value
      ) order by date) from series), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(x order by (x->>'spend')::numeric desc) from (
        select jsonb_build_object(
          'campaignId', campaign_id,
          'campaignName', max(campaign_name),
          'status', max(campaign_status),
          'channelType', max(advertising_channel_type),
          'communityId', max(canonical_community_id::text),
          'communityName', max(community_name),
          'spend', sum(cost), 'impressions', sum(impressions), 'clicks', sum(clicks),
          'conversions', sum(conversions), 'conversionsValue', sum(conversions_value)
        ) as x
          from camp_scoped group by campaign_id) q), '[]'::jsonb),
    'byCommunity', coalesce((select jsonb_agg(x order by (x->>'spend')::numeric desc) from (
        select jsonb_build_object(
          'communityId', canonical_community_id,
          'communityName', max(community_name),
          'spend', sum(cost), 'impressions', sum(impressions), 'clicks', sum(clicks),
          'conversions', sum(conversions), 'conversionsValue', sum(conversions_value)
        ) as x
          from camp_scoped
         where canonical_community_id is not null and canonical_community_id = any(scope)
         group by canonical_community_id) q), '[]'::jsonb),
    'unmapped', (select jsonb_build_object(
        'spend', coalesce(sum(cost),0),
        'clicks', coalesce(sum(clicks),0),
        'campaigns', coalesce((select jsonb_agg(distinct jsonb_build_object(
              'campaignId', campaign_id, 'campaignName', campaign_name, 'spend', s))
            from (select campaign_id, max(campaign_name) campaign_name, sum(cost) s
                    from camp where canonical_community_id is null group by campaign_id) u), '[]'::jsonb)
      ) from camp where canonical_community_id is null),
    'totalAccountSpend', (select coalesce(sum(cost),0) from acct),
    'devices', coalesce((select jsonb_agg(x order by (x->>'spend')::numeric desc) from (
        select jsonb_build_object(
          'device', coalesce(f.device,'UNKNOWN'),
          'spend', sum(f.cost), 'impressions', sum(f.impressions), 'clicks', sum(f.clicks),
          'conversions', sum(f.conversions)
        ) as x
          from public.google_ads_api_facts f
         where f.organization_id = _org_id and f.grain = 'device_day'
           and f.date between _start and _end
         group by coalesce(f.device,'UNKNOWN')) q), '[]'::jsonb),
    'conversionActions', coalesce((select jsonb_agg(x order by (x->>'conversions')::numeric desc) from (
        select jsonb_build_object(
          'actionId', f.conversion_action_id,
          'name', max(f.conversion_action_name),
          'category', max(f.conversion_action_category),
          'primary', bool_or(f.conversion_action_primary),
          'conversions', sum(f.conversions),
          'conversionsValue', sum(f.conversions_value),
          'firstDate', min(f.date), 'lastDate', max(f.date)
        ) as x
          from public.google_ads_api_facts f
         where f.organization_id = _org_id and f.grain = 'conversion_action_day'
           and f.date between _start and _end
         group by f.conversion_action_id) q), '[]'::jsonb),
    'health', (select jsonb_build_object(
        'latestDate', max(f.date),
        'currency', max(f.currency_code),
        'timeZone', max(f.time_zone)
      ) from public.google_ads_api_facts f where f.organization_id = _org_id),
    'mappingCoverage', (select jsonb_build_object(
        'campaigns', count(*)::int,
        'mapped', count(*) filter (where mp.campaign_id is not null)::int
      ) from (select distinct campaign_id from public.google_ads_api_facts
               where organization_id = _org_id and grain = 'campaign_day') ci
        left join map mp on mp.campaign_id = ci.campaign_id)
  ) into res;

  return res;
end;
$$;

revoke all on function public.google_ads_paid_report(uuid, date, date, uuid[]) from public, anon;
grant execute on function public.google_ads_paid_report(uuid, date, date, uuid[]) to authenticated, service_role;


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
  mi as (
    select hc.id, pp.community_id, pp.lead_source_id,
           (case when s.move_in_date_field = 'financial_move_in_date'
                 then hc.financial_move_in_date else hc.move_in_date end) as mi_date
      from public.wh_housing_contracts hc
      join paid_p pp on pp.source_id = hc.prospect_source_id
     where hc.organization_id = _org_id and hc.community_id = any(scope)
       and hc.lease_canceled_on is null and hc.count_move_in is true
  ),
  mi_p as (select * from mi where mi_date between _start and _end),
  months as (
    select to_char(inq_local_date,'YYYY-MM') as m, count(*)::int n, 0 t, 0 mv from inq group by 1
    union all
    select to_char(completed_local_date,'YYYY-MM'), 0, count(*)::int, 0 from tours_ok group by 1
    union all
    select to_char(mi_date,'YYYY-MM'), 0, 0, count(*)::int from mi_p group by 1
  ),
  comm as (
    select community_id, count(*)::int n, 0 t, 0 mv from inq group by 1
    union all
    select community_id, 0, count(*)::int, 0 from tours_ok group by 1
    union all
    select community_id, 0, 0, count(*)::int from mi_p group by 1
  )
  select jsonb_build_object(
    'paidLeadSourceIds', to_jsonb(paid_ids),
    'inquiries', (select count(*)::int from inq),
    'tours', (select count(*)::int from tours_ok),
    'moveIns', (select count(*)::int from mi_p),
    'allInquiries', (select count(*)::int from pc where inq_local_date between _start and _end),
    'byMonth', coalesce((select jsonb_agg(jsonb_build_object(
        'month', m, 'inquiries', sum(n), 'tours', sum(t), 'moveIns', sum(mv)) order by m)
        from (select m, sum(n) n, sum(t) t, sum(mv) mv from months group by m) z group by m, n, t, mv), '[]'::jsonb),
    'byCommunity', coalesce((select jsonb_agg(jsonb_build_object(
        'communityId', community_id, 'inquiries', n, 'tours', t, 'moveIns', mv))
        from (select community_id, sum(n) n, sum(t) t, sum(mv) mv from comm group by community_id) z2), '[]'::jsonb),
    'bySource', coalesce((select jsonb_agg(jsonb_build_object(
        'leadSourceId', sid, 'inquiries', n, 'tours', t, 'moveIns', mv))
        from (
          select lead_source_id sid, count(*)::int n, 0 t, 0 mv from inq group by 1
          union all select lead_source_id, 0, count(*)::int, 0 from tours_ok group by 1
          union all select lead_source_id, 0, 0, count(*)::int from mi_p group by 1
        ) src, lateral (select 1) l
        where true), '[]'::jsonb),
    'latestProspectDate', (select max(inq_local_date) from pc)
  ) into res;

  return res;
end;
$$;

revoke all on function public.wh_paid_media_outcomes(uuid, date, date, uuid[]) from public, anon;
grant execute on function public.wh_paid_media_outcomes(uuid, date, date, uuid[]) to authenticated, service_role;