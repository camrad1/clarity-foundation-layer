# Diagnostic: does Further expose event RSVP activity?

Goal: find out whether Further's conversation timeline for one lead (Cay Cooney, Waterhouse Ridge Memory Care) includes the "RSVP'D TO EVENT — Stronger Together Support Chat" activity seen in Further's own screen.

This is a read-only test. No database changes, no changes to the existing Further integration, no EventList work.

## Steps

1. Confirm the Further API key is available server-side. The integration currently reads the key from the stored credentials row for the Further connection. If a `FURTHER_API_KEY` environment secret is preferred for this test, save it through the secure secret form; the value never appears in chat, code, or logs.
2. Run a one-off server-side diagnostic (no UI, nothing persisted):
   - `GET /api/v1/leads/?search=Cay Cooney` and pick the record matching Waterhouse Ridge Memory Care; capture its lead id.
   - `GET /api/v1/conversations/leads/{lead_id}`.
3. Write the raw, untransformed JSON of the conversation response to a file under `/mnt/documents/` and attach it, so nothing is truncated in chat.
4. Report alongside it:
   - the Further lead id
   - the full list of distinct `message_type` values returned
   - any object whose type or payload mentions RSVP, event, "Stronger Together Support Chat", or Aug 19 2026 — quoted exactly
   - whether the event name is present
   - whether any event id / community event id / event instance UUID is present
   - whether an RSVP timestamp is present
   - if nothing event-related appears, state that plainly and list what the timeline does contain

## Technical notes

- Calls go out from a temporary server-side script using the existing `furtherGet` client in `src/lib/further/api.server.ts`, which already sets `Authorization: Org-Api-Key <key>`, paces requests under the 300/min limit, and redacts key-shaped strings from errors.
- Search may not be a supported filter on `/api/v1/leads/`; if it returns 400 or ignores the parameter, fall back to locating the lead by name within the already-synced `further_leads` rows and use that `external_lead_id`.
- Nothing is written to `further_*` tables, sync state, or any event table.
