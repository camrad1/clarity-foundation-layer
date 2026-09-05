/**
 * Further source registry (client-safe constants).
 *
 * ClarityIQ treats Further as a READ-ONLY analytics source. Nothing in this
 * integration writes to Further: no lead creation, no messages, no community,
 * pricing or tour/move-in write-back. Only GET requests are ever issued.
 */

export const FURTHER_API_BASE = "https://api.talkfurther.com";

/** Datasets ClarityIQ ingests. Each is one bounded sync work unit. */
export const FURTHER_DATASETS = [
  "communities",
  "leads",
  "lead_details",
  "conversations",
  "visitors",
] as const;
export type FurtherDataset = (typeof FURTHER_DATASETS)[number];

export const FURTHER_DATASET_LABELS: Record<FurtherDataset, string> = {
  communities: "Communities",
  leads: "Leads",
  lead_details: "Lead details",
  conversations: "Conversation events",
  visitors: "Visitors",
};

/** Datasets an hourly incremental tick refreshes. */
export const FURTHER_HOURLY_DATASETS: FurtherDataset[] = [
  "leads",
  "lead_details",
  "conversations",
];

/** Datasets the nightly reconciliation tick refreshes in addition. */
export const FURTHER_NIGHTLY_DATASETS: FurtherDataset[] = [
  "communities",
  "visitors",
  "leads",
  "lead_details",
  "conversations",
];

/** Datasets whose failure makes a run failed rather than partial. */
export const FURTHER_CORE_DATASETS: FurtherDataset[] = ["leads"];

/** Minutes without a persisted heartbeat before a work unit counts as stalled. */
export const FURTHER_STALL_MINUTES = 10;

/** Safety overlap subtracted from the watermark on incremental syncs. */
export const FURTHER_OVERLAP_MINUTES = 5;

/** Further publishes 300 requests/minute per API key. */
export const FURTHER_RATE_LIMIT_PER_MINUTE = 300;
