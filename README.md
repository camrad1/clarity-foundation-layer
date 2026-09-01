# Performance Clarity

We are building a new SaaS platform called ClarityIQ.

ClarityIQ is a performance intelligence platform that brings disconnected marketing, CRM, sales, and occupancy data together so users can understand what is actually driving performance without having to manually connect the dots.

The long-term performance journey is:

Visibility → Traffic → Conversations → Leads → Tours → Deposits → Move-Ins → Occupancy

Future data sources will include:

Google Search Console

WelcomeHome CRM

Further

GA4

Google Ads

potentially other marketing and CRM platforms

For this phase, do NOT build the finished analytics dashboards yet.

This is Phase 0 — Foundation.

The goal is to create the secure multi-tenant architecture, data model, administration tools, mapping framework, global filters, metric registry, data health system, and validation foundation that all future ClarityIQ dashboards will use.

CORE ARCHITECTURE PRINCIPLES

Please follow these principles throughout the build:

ClarityIQ is an analytics/intelligence platform, not a replacement CRM.

External systems such as WelcomeHome remain the systems of record.

ClarityIQ stores synchronized analytics copies of source data where needed.

Never calculate important business metrics independently with AI.

Metrics must be calculated deterministically from source data.

AI will eventually interpret calculated metrics, not invent them.

Every KPI must ultimately support drill-through to the underlying records that produced it.

Community filtering must be foundational and reusable across the entire app.

The architecture must support multiple organizations/customers from the beginning.

One organization's data must never be accessible by another organization.

Do not hard-code ONELIFE-specific values into the underlying architecture.

API credentials and tokens must never be exposed client-side.

Build this so ClarityIQ can eventually be sold to other companies.

TECHNOLOGY

Use:

React / Lovable frontend

Supabase database

Supabase Auth

Supabase Row Level Security

Supabase Edge Functions/server-side functions where appropriate

Use reusable components and avoid tightly coupling business logic to the UI.

1. MULTI-TENANT ORGANIZATION MODEL

Create the foundation for multiple customer organizations.

Create tables/entities for:

organizations

Fields should include at minimum:

id

name

slug

status

created_at

updated_at

organization_memberships

Connect authenticated users to organizations.

Include:

id

organization_id

user_id

role

created_at

updated_at

Initial ClarityIQ roles:

platform_admin

organization_admin

regional_user

community_user

marketing_user

read_only

Do not rely only on UI hiding.

Implement Row Level Security so users can access only organizations and communities they are explicitly authorized to access.

Platform admins may access all tenants.

2. COMMUNITIES

Create a canonical communities table.

Include:

id

organization_id

name

slug

status

state

city

region_id if applicable

timezone

website_url

primary_domain if useful

created_at

updated_at

A community must have one permanent ClarityIQ ID.

External systems will map to this ID rather than ClarityIQ relying on external names.

Example concept:

ClarityIQ Community:
The Laurel at Vernon Hills

Possible external identifiers:

WelcomeHome ID: 123
Further name/ID: The Laurel
Website URL pattern: /the-laurel-at-vernon-hills/

All external data should ultimately resolve to the canonical ClarityIQ community ID.

3. REGIONS AND COMMUNITY GROUPING

Create support for optional regions or community groups.

Users should eventually be able to filter:

one community

multiple selected communities

all communities

a region/group

Create a flexible structure rather than hard-coding region names.

4. CARE TYPES

Create a reusable care_types structure.

Examples may include:

Independent Living

Assisted Living

Memory Care

Create a community-to-care-type relationship so communities may support multiple care types.

Do not hard-code these examples as the only possible values.

5. DATA SOURCE CONNECTIONS

Create a generic data-source architecture.

Initial source types:

search_console

welcomehome

further

Design this so additional source types can be added later.

Create a data_source_connections table with fields such as:

id

organization_id

source_type

display_name

status

last_successful_sync_at

last_attempted_sync_at

data_through_date if applicable

connection_metadata

created_at

updated_at

Possible statuses:

connected

needs_attention

disconnected

manual_upload

syncing

Do NOT store secrets or API tokens directly in normal client-readable tables.

Use secure server-side secret handling.

6. EXTERNAL COMMUNITY MAPPINGS

Create a reusable community mapping table.

For example:

community_source_mappings

Fields:

id

organization_id

community_id

source_type

external_id

external_name

external_metadata

active

created_at

updated_at

This allows:

WelcomeHome community ID

Further community ID/name

future external community identifiers

to map to one canonical ClarityIQ community.

Build an Admin interface where an organization admin or platform admin can review and manage these mappings.

7. WEBSITE / URL COMMUNITY MAPPING

Create a framework for associating website URLs with ClarityIQ communities.

Create something like:

url_mapping_rules

Fields:

id

organization_id

community_id nullable

match_type

pattern

content_type

intent_type nullable

topic nullable

care_type_id nullable

priority

active

Possible match types:

exact_url

url_contains

path_prefix

regex if safely supported

Examples of future content types:

community

blog

service

resource

corporate

pricing

other

Do NOT build the final SEO classification engine yet.

We only need the architecture and admin interface.

8. METRIC REGISTRY

Create a central versioned metric registry.

This is very important.

Do not allow dashboard components to independently define what a KPI means.

Create metric_definitions.

Fields should include:

id

metric_key

name

description

source_type

source_table

date_field

calculation_definition

exclusion_rules

supported_dimensions

metric_version

status

validation_status

created_at

updated_at

Statuses might include:

draft

provisional

validated

deprecated

Initial placeholder metric keys should include:

WelcomeHome:

wh.new_inquiries

wh.completed_tours

wh.re_tours

wh.deposits

wh.move_ins

wh.move_outs

wh.net_move_ins

wh.occupancy_pct

wh.projected_occupancy_pct

wh.lead_to_tour

wh.tour_to_deposit

wh.lead_to_movein

wh.hot_leads

wh.hot_no_future_activity

wh.stalled_prospects

Search Console:

gsc.clicks

gsc.impressions

gsc.ctr

gsc.avg_position

gsc.local_intent_clicks

gsc.branded_clicks

gsc.informational_clicks

Further:

further.conversations

further.move_ins

further.traffic_source_conversations

These are registry entries only for now.

Do NOT assume provisional calculation logic is final.

Some WelcomeHome calculations will need to be validated against real WelcomeHome reports before being marked validated.

9. METRIC VERSIONING

Metric definitions must be versionable.

If the definition of a metric changes later, historical reporting should be able to identify which metric version produced a result.

Do not silently overwrite a production metric definition in a way that makes historical reports impossible to reproduce.

10. RAW SOURCE DATA FRAMEWORK

Create a flexible architecture for storing imported/synchronized source data.

We will eventually have normalized source-specific tables, but also preserve enough raw source context for debugging and validation.

Create a source_sync_runs table:

id

connection_id

started_at

completed_at

status

records_received

records_inserted

records_updated

records_failed

error_summary

sync_cursor or checkpoint metadata

created_at

Create a suitable raw-source or staging structure that preserves:

source record ID

source type

organization

source community identifier

imported timestamp

updated timestamp from source

raw payload or relevant raw fields

Do not expose raw PII unnecessarily in the frontend.

11. DATA FRESHNESS

Every source must track freshness.

The application should eventually be able to show messages such as:

WelcomeHome
Last successful sync: 2 hours ago

Search Console
Uploaded Sep 1, 2026
Data through Aug 31, 2026

Further
Manual upload
Data through Aug 31, 2026

Create the data model and UI foundation for this.

12. DATA HEALTH PAGE

Create an Admin-facing Data Health page.

It should show cards/rows for each connected data source with:

source name

connection status

last attempted sync

last successful sync

data through date

latest sync result

record counts

errors/warnings

Include a placeholder area for future coverage metrics.

Examples:

Marketing data coverage
Sales funnel coverage
Move-in attribution coverage

Do not invent those percentages yet.

13. VALIDATION CENTER

Create an Admin-only Data Validation area.

This is an important internal tool.

It should eventually allow us to compare ClarityIQ calculations against source-system reports.

For now build the structure for:

validation checks

metric being tested

organization

community

date range

ClarityIQ calculated value

expected/source-system value

difference

status

reviewer notes

validation timestamp

Statuses:

pending

matched

mismatch

approved

needs_review

Create a simple UI to list validation checks.

Do NOT attempt to automatically validate metrics yet.

14. GLOBAL FILTER SYSTEM

Create reusable global filters that future dashboards will use.

At minimum:

Date Range

Support:

custom range

current month

previous month

last 30 days

last 90 days

year to date

Community

Support:

all authorized communities

one community

multiple communities

future region/group selection

Selections should persist while navigating between ClarityIQ sections.

Filters should be reusable and not implemented independently on each page.

Do not build fake analytics results yet.

15. TIMEZONE ARCHITECTURE

WelcomeHome timestamps may arrive in UTC while communities can exist in different time zones.

Store timestamps safely in UTC where appropriate.

Community-level reporting must eventually calculate reporting periods using the community's configured timezone.

Do not hard-code one global timezone.

16. HISTORICAL SNAPSHOTS

Prepare architecture for historical snapshots.

This is especially important for:

pipeline stage distribution

occupancy

projected occupancy

current-state metrics

We must distinguish:

Historical events:
Tour happened Aug 12
Deposit happened Aug 19
Move-in happened Aug 27

from:

Current state:
Prospect is currently Post-Tour
Unit is currently occupied

Create a generic snapshot structure that can later store daily community-level state.

For example:

community_daily_snapshots

Possible fields:

organization_id

community_id

snapshot_date

snapshot_type

metric/state payload

source_sync_run_id

created_at

Do not implement final occupancy snapshots yet.

17. GOALS AND BENCHMARKS

Create architecture for goals.

Goals should be able to vary by:

organization

community

metric

effective date range

Create:

metric_goals

Fields:

organization_id

community_id nullable

metric_key

target_value

effective_start

effective_end nullable

notes

This allows goals such as:

Occupancy target
Monthly inquiry goal
Tour goal
Move-in goal
Conversion target

Do not populate arbitrary business goals.

18. DUPLICATE / MERGE HANDLING FRAMEWORK

Prepare source records for duplicate/merge logic.

WelcomeHome can contain merged prospects.

Source synchronization must preserve:

original source record ID

merged-into ID if supplied

discarded status where supplied

Future metric calculations must be able to exclude records that would create double counting.

Do not invent merge rules beyond what source data supports.

19. PRIVACY / PII RULES

ClarityIQ will eventually receive personal CRM information.

Design the app around data minimization.

Default dashboard views should use aggregated data.

Personally identifiable prospect/resident information should only be shown when a user explicitly drills into an authorized detail view.

Do not display:

phone

email

home address

birthdate

on general analytics dashboards.

Access to identifiable records must respect organization/community permissions.

Create the architecture so field-level restrictions can be expanded later.

20. KPI DRILL-THROUGH ARCHITECTURE

Future KPI cards must support:

Click metric

→ filtered underlying records

Example:

Tours: 47

Click

→ list of the 47 tour records used in the calculation.

Do not build all drill-through views yet, but architect metric results so they can reference or reproduce their contributing source records.

21. CLARITY INSIGHT / AI FOUNDATION

Do NOT connect AI yet.

Create the database structures for deterministic insights and future AI narratives.

Create something like:

insight_signals

Fields:

id

organization_id

community_id nullable

signal_type

severity

metric_keys

supporting_values

comparison_values

attribution_level

generated_at

status

Attribution levels:

exact

joined

aggregate

Create another future-ready structure for AI narratives such as:

ai_insight_narratives

The AI narrative must always reference the deterministic signals/metrics it was given.

The future system must never allow AI to invent KPI values.

22. AI EVIDENCE TRACEABILITY

Prepare the UX so future Clarity insights can have:

Why am I seeing this?

Clicking this should eventually reveal:

supporting metrics

current value

prior value

comparison period

communities included

attribution level

data freshness

For this phase, only create the architectural foundation.

23. INITIAL APP NAVIGATION

Create a clean professional left navigation.

For now:

Overview
Placeholder only

Marketing Intelligence
Placeholder

Sales Intelligence
Placeholder

Occupancy Intelligence
Placeholder

Performance Journey
Placeholder

Data Health

Admin

Organizations if platform admin

Communities

Community Mappings

Data Sources

Metric Registry

Goals

Validation Center

Do not fill placeholders with fake dashboards or fake data.

A tasteful empty state is preferable.

24. OVERVIEW PLACEHOLDER

Create a polished empty-state Overview page explaining:

ClarityIQ brings your performance data together so you can see what is driving results.

Display the future journey:

Visibility
→ Traffic
→ Conversations
→ Leads
→ Tours
→ Deposits
→ Move-Ins
→ Occupancy

Do not show fabricated KPI numbers.

25. DESIGN DIRECTION

ClarityIQ should feel:

modern

premium

professional

clean

executive-friendly

data-focused

calm

trustworthy

Avoid:

excessive gradients

overly playful SaaS styling

neon colors

giant decorative cards

fake charts

clutter

Prioritize:

typography

whitespace

visual hierarchy

readable tables

concise labels

reusable data components

The product should look credible enough to present to a senior living executive team or sell to another operator.

26. PHASE 0.5 VALIDATION HARNESS

Prepare an internal/admin validation environment.

It should eventually support:

inspecting source records

reviewing mapping status

viewing external IDs

reviewing metric definitions

validating source record counts

finding unmapped communities

identifying duplicate source IDs

identifying failed imports

comparing calculated metrics with source values

Build the foundation/UI structure only where source data is not connected yet.

27. SECURITY ACCEPTANCE TESTS

Before Phase 0 is considered complete, the following must be possible to test:

Create Organization A.

Create Organization B.

Assign different users.

Verify Organization A user cannot query Organization B data.

Verify community users cannot access unassigned communities.

Verify platform admin can access authorized platform-wide administration.

Verify API credentials are not exposed through frontend database queries.

Verify RLS is enforced server-side.

28. COMMUNITY FILTER ACCEPTANCE TESTS

The reusable community filter is not complete until:

User can select all authorized communities.

User can select one community.

User can select multiple communities.

Selection persists between app sections.

Unauthorized communities never appear.

Future dashboards can consume the same shared filter state.

29. DATA SOURCE ACCEPTANCE TESTS

We should be able to create:

one Search Console manual-upload connection

one WelcomeHome API connection placeholder

one Further manual-upload connection

The Data Health page should correctly reflect the connection type and status.

Do not require actual WelcomeHome credentials during this foundation phase.

30. PHASE 0 COMPLETION GATE

Do not consider Phase 0 finished simply because the pages render.

Phase 0 is complete only after we confirm:

multi-tenant security works

RLS works

communities work

community mappings work

data-source framework works

metric registry works

Data Health works

Validation Center exists

global date/community filters work

secret handling is server-side

no fake analytics have been introduced

DO NOT BUILD YET

Do NOT yet build:

finished Search Console dashboard

SEO opportunity engine

WelcomeHome API synchronization

final occupancy calculation

finished sales funnel

finished Flash Report

Further ingestion

AI integration

AI chat

PDF reporting

billing

Stripe

public customer signup

revenue analytics

event ROI

Google Ads integration

GA4 integration

Those will be built in later phases.

FINAL REQUEST

Please implement Phase 0 only.

Before changing the database, first review the proposed schema for architectural conflicts or unnecessary duplication.

Preserve modularity.

Do not invent metric definitions where the specification marks them as provisional.

Do not use fake business data just to make the interface look populated.

When complete, summarize:

Tables created

RLS policies created

Pages/components created

Global filter architecture

Secret-handling architecture

Anything you could not safely implement

Any architectural recommendation you believe should be resolved before Phase 1

Do not proceed into Phase 1 automatically.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://clarity-foundation-layer.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ffcd4ad5-5fcf-4b24-aa99-0403342a98db).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
