import type { Database } from "@/integrations/supabase/types";

export type QueryClassification = Database["public"]["Enums"]["query_classification"];
export type QueryMatchType = Database["public"]["Enums"]["query_match_type"];

/**
 * Classification is rule driven and organization specific. Nothing is inferred
 * by a model: a query is only branded, local or care-type intent because an
 * administrator wrote a rule that says so. Unmatched queries stay
 * "Unclassified" instead of being guessed.
 */
export const CLASSIFICATION_LABELS: Record<QueryClassification, string> = {
  branded: "Branded",
  local_intent: "Local intent",
  cost_intent: "Cost intent",
  informational: "Informational",
  care_type_intent: "Care type intent",
  competitor: "Competitor",
};

export const CLASSIFICATIONS = Object.keys(CLASSIFICATION_LABELS) as QueryClassification[];

export const MATCH_TYPE_LABELS: Record<QueryMatchType, string> = {
  exact_phrase: "Exact phrase",
  contains: "Contains",
  starts_with: "Starts with",
  regex: "Regular expression",
};

export const MATCH_TYPES = Object.keys(MATCH_TYPE_LABELS) as QueryMatchType[];

export const UNCLASSIFIED_LABEL = "Unclassified";

export function classificationLabel(value: string | null | undefined): string {
  if (!value) return UNCLASSIFIED_LABEL;
  return CLASSIFICATION_LABELS[value as QueryClassification] ?? UNCLASSIFIED_LABEL;
}
