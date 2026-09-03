/**
 * Supported reporting timezones.
 *
 * Admins pick from friendly labels; ClarityIQ always stores the canonical IANA
 * identifier. The common US operating zones are listed first, then the full
 * maintained IANA list from the runtime (`Intl.supportedValuesOf`) so the set
 * stays current without hardcoding every zone.
 */
export type TimezoneOption = { value: string; label: string };

/** Curated zones ClarityIQ communities normally operate in. */
export const COMMON_TIMEZONES: TimezoneOption[] = [
  { value: "America/Los_Angeles", label: "Pacific Time" },
  { value: "America/Denver", label: "Mountain Time" },
  { value: "America/Phoenix", label: "Arizona (no DST)" },
  { value: "America/Chicago", label: "Central Time" },
  { value: "America/New_York", label: "Eastern Time" },
  { value: "America/Anchorage", label: "Alaska Time" },
  { value: "Pacific/Honolulu", label: "Hawaii Time" },
];

const COMMON_VALUES = new Set(COMMON_TIMEZONES.map((t) => t.value));

/** Every IANA zone the runtime knows about, minus the curated ones. */
export function allTimezones(): TimezoneOption[] {
  let names: string[] = [];
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf;
    names = supported ? supported("timeZone") : [];
  } catch {
    names = [];
  }
  return names
    .filter((n) => !COMMON_VALUES.has(n))
    .map((n) => ({ value: n, label: n.replace(/_/g, " ").replace("/", " — ") }));
}

/** Friendly label for a stored canonical value. */
export function timezoneLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return COMMON_TIMEZONES.find((t) => t.value === value)?.label ?? value;
}

/** True when the value is a canonical zone this runtime recognises. */
export function isValidTimezone(value: string): boolean {
  if (!value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
