// Lightweight Tamil calendar helper (approximate month boundaries & festivals)
// NOTE: Month start dates can shift by a day year-to-year (solar calendar adjustments).
// For scheduling UI we use widely accepted standard start dates for most years.

export interface TamilDateInfo {
  tamilMonth: string;
  tamilDay: number;
  tamilDayTamilNumeral: string;
}

const tamilMonths = [
  'Chithirai', // starts mid April
  'Vaikasi',
  'Aani',
  'Aadi',
  'Avani',
  'Purattasi',
  'Aippasi',
  'Karthigai',
  'Margazhi',
  'Thai',
  'Maasi',
  'Panguni'
];

// Approximate Gregorian start dates for Tamil months (month index 0-11). Values: [month (0-based), day]
// These cover most years; tiny drift (±1 day) is acceptable for display-only augmentation.
const monthStartTemplate: Array<[number, number, string]> = [
  [3, 14, 'Chithirai'],   // Apr 14
  [4, 15, 'Vaikasi'],     // May 15
  [5, 15, 'Aani'],        // Jun 15
  [6, 17, 'Aadi'],        // Jul 17
  [7, 17, 'Avani'],       // Aug 17
  [8, 17, 'Purattasi'],   // Sep 17
  [9, 17, 'Aippasi'],     // Oct 17
  [10,16, 'Karthigai'],   // Nov 16
  [11,16, 'Margazhi'],    // Dec 16
  [0, 14, 'Thai'],        // Jan 14
  [1, 13, 'Maasi'],       // Feb 13
  [2, 14, 'Panguni']      // Mar 14
];

// Tamil numerals map
const tamilDigits: Record<string, string> = {
  '0': '௦',
  '1': '௧',
  '2': '௨',
  '3': '௩',
  '4': '௪',
  '5': '௫',
  '6': '௬',
  '7': '௭',
  '8': '௮',
  '9': '௯'
};

function toTamilNumeral(n: number): string {
  return String(n).split('').map(d => tamilDigits[d] || d).join('');
}

export function getTamilDate(date: Date): TamilDateInfo {
  // Determine which Tamil year cycle the date belongs to (Chithirai 1 ~ Apr 14)
  const gy = date.getFullYear();
  const cycleStartYear = (date.getMonth() > 3 || (date.getMonth() === 3 && date.getDate() >= 14)) ? gy : gy - 1;

  // Build concrete start dates from the template for this cycle
  // For months Jan/Feb/Mar (indices 9,10,11) use cycleStartYear+1; others use cycleStartYear
  const starts = monthStartTemplate.map(([m, d, name]) => {
    const year = (m <= 2) ? cycleStartYear + 1 : cycleStartYear; // Jan/Feb/Mar after New Year rollover
    return { name, gDate: new Date(year, m, d) };
  }).sort((a,b)=> a.gDate.getTime() - b.gDate.getTime());

  // Year-specific fine tuning (based on provided authoritative 2025 calendar image)
  // Aippasi 2025 actually begins on Oct 18 (not Oct 17) making Nov 15 = Aippasi 29.
  if (cycleStartYear === 2025) {
    const aippasi = starts.find(s => s.name === 'Aippasi');
    const karthigai = starts.find(s => s.name === 'Karthigai');
    if (aippasi) {
      aippasi.gDate = new Date(cycleStartYear, 9, 18); // Oct 18 2025
    }
    // Keep Karthigai at Nov 16 so Aippasi length = 29 days.
    // Re-sort to ensure order after adjustment.
    starts.sort((a,b)=> a.gDate.getTime() - b.gDate.getTime());
  }

  // Ensure chronological order from Chithirai onwards (already sorted by template design)
  const nextYearChithirai = new Date(cycleStartYear + 1, 3, 14); // next cycle start

  // Find current month: last start <= date
  let currentIdx = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i].gDate.getTime() <= date.getTime()) currentIdx = i; else break;
  }
  const current = starts[currentIdx];
  const next = (currentIdx === starts.length -1) ? nextYearChithirai : starts[currentIdx + 1].gDate;
  const tamilDay = Math.max(1, Math.floor((date.getTime() - current.gDate.getTime())/86400000) + 1);
  // Guard: if beyond next start (rare timezone edge) clamp to last day
  const maxDay = Math.max(1, Math.floor((next.getTime() - current.gDate.getTime())/86400000));
  const day = Math.min(tamilDay, maxDay);
  return { tamilMonth: current.name, tamilDay: day, tamilDayTamilNumeral: toTamilNumeral(day) };
}

// Minimal festival / event icons (emoji) keyed by YYYY-MM-DD
// Icons chosen: 🕉️ (Om), 🔥 (fire), ☀️ (sun), 🎆 (celebration), 🌾 (harvest), 🔱 (trident), 🪔 (lamp)
// Extend as needed.
const festivalIcons: Record<string, string> = {
  // Tamil New Year (Chithirai 1)
  '2025-04-14': '🕉️',
  '2026-04-14': '🕉️',
  // Pongal (Thai 1-4) – show harvest 🌾 on first day, sun on Surya Pongal (day 2)
  '2025-01-14': '🌾',
  '2025-01-15': '☀️',
  '2026-01-14': '🌾',
  '2026-01-15': '☀️',
  // Deepavali 2025 (approx Oct 20), 2026 (Nov 8) – lamp icon
  '2025-10-20': '🪔',
  '2026-11-08': '🪔',
  // Karthigai Deepam (approx Dec 5 2025) – fire
  '2025-12-05': '🔥',
  // Aadi Perukku (Aug 2 2025) – water/river representation using trident
  '2025-08-02': '🔱'
};

export function getFestivalIcon(date: Date): string | null {
  // Use local date components to avoid timezone UTC shift (toISOString() caused previous-day key in UTC+ offsets)
  const key = formatLocalYMD(date);
  return festivalIcons[key] || null;
}

// ---------------- MUHURTHAM (Auspicious Wedding) DATES ----------------
export interface MuhurthamEntry {
  date: string;          // YYYY-MM-DD
  weekday: string;
  pirai: 'Valarpirai' | 'Theipirai';
  piraiTamil: 'வளர்பிறை' | 'தேய்பிறை';
  tamilMonth: string;    // English transliteration
  tamilMonthTamil: string;
  icon: string;          // suggested icon (kept for completeness)
}

// 2025 dataset (provided) – kept verbatim.
// Muhurtham data moved to external JSON for maintainability
import muhurtham2025Raw from '@/data/muhurtham2025.json';
import muhurtham2026Raw from '@/data/muhurtham2026.json';
export const muhurtham2025: MuhurthamEntry[] = (muhurtham2025Raw as MuhurthamEntry[]);
export const muhurtham2026: MuhurthamEntry[] = (muhurtham2026Raw as MuhurthamEntry[]);

// Build per-year indices
const muhurthamYearIndex: Record<number, Record<string, MuhurthamEntry>> = {};
function buildIndex(year: number, entries: MuhurthamEntry[]) {
  muhurthamYearIndex[year] = Object.fromEntries(entries.map(e => [e.date, e]));
}
buildIndex(2025, muhurtham2025);
buildIndex(2026, muhurtham2026);

// Unified API (supports multiple years)
export function getMuhurthamMarker(date: Date): { type: 'image'; value: string; entry: MuhurthamEntry } | null {
  const key = formatLocalYMD(date);
  const idx = muhurthamYearIndex[date.getFullYear()];
  if (!idx) return null;
  const entry = idx[key];
  return entry ? { type: 'image', value: '/muhurtham.png', entry } : null;
}

// Helper to format local date as YYYY-MM-DD (avoids timezone shift issues from toISOString)
function formatLocalYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

