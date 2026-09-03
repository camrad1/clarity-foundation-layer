import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COMMON_TIMEZONES, allTimezones } from "@/lib/timezones";

/**
 * Reporting timezone picker. Admins see plain-language labels; the canonical
 * IANA value is what gets stored, and free text is not possible.
 */
export function TimezoneSelect({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  const others = useMemo(() => allTimezones(), []);
  // A legacy/unrecognised stored value stays selectable so the field renders
  // truthfully until an admin corrects it.
  const isKnown =
    COMMON_TIMEZONES.some((t) => t.value === value) || others.some((t) => t.value === value);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <SelectValue placeholder="Select a timezone" />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {value && !isKnown ? (
          <SelectGroup>
            <SelectLabel>Needs correction</SelectLabel>
            <SelectItem value={value}>{value} (not recognized)</SelectItem>
          </SelectGroup>
        ) : null}
        <SelectGroup>
          <SelectLabel>Common</SelectLabel>
          {COMMON_TIMEZONES.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label} <span className="text-muted-foreground">({t.value})</span>
            </SelectItem>
          ))}
        </SelectGroup>
        {others.length ? (
          <SelectGroup>
            <SelectLabel>All time zones</SelectLabel>
            {others.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.value}
              </SelectItem>
            ))}
          </SelectGroup>
        ) : null}
      </SelectContent>
    </Select>
  );
}
