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

  scoped := (_community_ids is not null and coalesce(array_length(_community_ids,1),0) > 0)
            or not public.has_org_wide_scope(_org_id);

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