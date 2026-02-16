// Central list of selectable time options for hall schedule fields.
// Values stored in DB should be HH:MM:SS (24h) to match TIME column type.
// Adjust granularity (e.g. every 15 minutes) as needed.
export interface TimeOption { label: string; value: string }

// Generate hour slots 00:00 to 23:00 plus some common half-hour marks.
// Build every 30-minute slot for the full 24h day.
// Label format examples:
// 09:00 -> 9.00 AM
// 13:30 -> 1.30 PM
// 00:00 -> 12.00 AM
// 12:00 -> 12.00 PM
function toLabel(h: number, m: number): string {
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour12 = (h % 12) === 0 ? 12 : (h % 12);
  const hourStr = `${hour12}`; // no leading zero
  const minStr = m === 0 ? '00' : '30';
  return `${hourStr}.${minStr} ${suffix}`;
}

const slots: TimeOption[] = [];
for (let h = 0; h < 24; h++) {
  for (let m of [0, 30]) {
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    const value = `${hh}:${mm}:00`; // DB value
    slots.push({ label: toLabel(h, m), value });
  }
}

export const TIME_OPTIONS: TimeOption[] = slots;

// Convenience: default start/end suggestions
export const DEFAULT_FROM_TIME = '09:00:00';
export const DEFAULT_TO_TIME = '10:00:00';
