// IST (India Standard Time) utilities
// IST = UTC + 05:30 (fixed, no DST)

const IST_OFFSET_MINUTES = 5 * 60 + 30;

export function nowIST(): Date {
  // Current moment represented in IST, independent of local machine timezone
  return toIST(new Date());
}

export function toIST(date: Date): Date {
  // Create a new date with IST timezone (+05:30)
  // This is a more reliable way to convert to IST
  const utcTime = date.getTime() + (date.getTimezoneOffset() * 60000);
  const istTime = new Date(utcTime + (330 * 60000)); // 330 minutes = 5.5 hours
  return istTime;
}

export function formatYMDIST(date: Date): string {
  // Convert the given local Date to IST, then read calendar components
  // using local getters to avoid a UTC-induced day shift.
  // This ensures selecting 04 in IST produces "YYYY-11-04" and not "YYYY-11-03".
  const d = toIST(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayYMDIST(): string {
  return formatYMDIST(new Date());
}

export function parseYMDToIST(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  // Construct as UTC then shift back so that when converted to IST string it matches
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

export function combineDateTimeIST(ymd: string, hhmm: string): string {
  // Returns ISO-like local string in HH:MM:SS for storage (we keep given hh:mm, assume already IST)
  if (!hhmm) return '';
  return hhmm.length === 5 ? `${hhmm}:00` : hhmm;
}

export function ensureHHMMSS(t: string): string {
  if (!t) return t;
  if (t.length === 5) return `${t}:00`;
  return t;
}

export const IST_LABEL = 'IST (UTC+05:30)';

export function nowISTString(): string {
  // Returns current IST time as ISO string with timezone
  const now = new Date();
  const istTime = toIST(now);
  return istTime.toISOString();
}

export function formatTimeIST(date: Date): string {
  // Format time in 12-hour with seconds and AM/PM for IST.
  // Avoid double-shifting if the Date already represents IST (offset -330 minutes).
  let istDate = date;
  try {
    if (istDate.getTimezoneOffset() !== -IST_OFFSET_MINUTES) {
      istDate = toIST(istDate);
    }
  } catch {
    istDate = toIST(date);
  }
  const h24 = istDate.getHours();
  const h12 = ((h24 + 11) % 12) + 1; // 0 -> 12, 13 -> 1
  const minutes = String(istDate.getMinutes()).padStart(2, '0');
  const seconds = String(istDate.getSeconds()).padStart(2, '0');
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  return `${String(h12).padStart(2, '0')}:${minutes}:${seconds} ${ampm}`;
}

/**
 * Normalize a server-provided timestamp into a Date that represents
 * the same wall-clock time in IST, regardless of input quirks.
 * - Strings with "+05:30" or "IST" are treated as already IST.
 * - Bare ISO (no timezone) strings are interpreted as IST by appending +05:30.
 * - UTC/Z or other-offset strings are converted to IST.
 * - Date objects are converted to IST.
 */
export function normalizeToISTDate(input: string | Date): Date {
  try {
    if (typeof input === 'string') {
      const s = input.trim();
      // Already carries explicit IST offset
      if (/\+05:30|\bIST\b/i.test(s)) {
        const d = new Date(s);
        // If parse fails to reflect IST offset (environment differences), coerce.
        if (d.getTimezoneOffset() !== -IST_OFFSET_MINUTES) {
          return toIST(d);
        }
        return d;
      }
      // Naive timestamp with space separator (common DB format): treat as UTC then shift
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
        const asUtc = new Date(s.replace(' ', 'T') + 'Z');
        return toIST(asUtc);
      }
      // Bare date-only
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return new Date(`${s}T00:00:00.000+05:30`);
      }
      // Bare datetime without timezone
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(s)) {
        return new Date(`${s.length === 16 ? s + ':00' : s}+05:30`);
      }
      // If ends with Z or contains other offset, parse then shift to IST
      const d = new Date(s);
      // If it has an explicit offset other than IST, shift.
      if (/Z|[+\-]\d{2}:?\d{2}$/.test(s) && d.getTimezoneOffset() !== -IST_OFFSET_MINUTES) {
        return toIST(d);
      }
      return d;
    }
    // Date object – convert to IST clock
    if (input.getTimezoneOffset() !== -IST_OFFSET_MINUTES) {
      return toIST(input);
    }
    return input;
  } catch {
    // Fallback: now in IST
    return toIST(new Date());
  }
}
