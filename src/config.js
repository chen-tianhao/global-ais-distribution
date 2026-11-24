// Vessel type categorization for colored display.
// Order matters: first match wins; unknown types fall back to OTHER.

export const CATEGORIES = {
  CARGO: { key: 'CARGO', color: '#4FC3F7', en: 'Cargo', zh: '货船' },
  TANKER: { key: 'TANKER', color: '#FF7043', en: 'Tanker', zh: '油轮' },
  FISHING: { key: 'FISHING', color: '#66BB6A', en: 'Fishing', zh: '渔船' },
  PASSENGER: { key: 'PASSENGER', color: '#AB47BC', en: 'Passenger', zh: '客船' },
  TUG: { key: 'TUG', color: '#FFCA28', en: 'Tug / Towing', zh: '拖轮' },
  SPECIAL: { key: 'SPECIAL', color: '#26C6DA', en: 'Special purpose', zh: '特种船' },
  LEISURE: { key: 'LEISURE', color: '#EC407A', en: 'Leisure / Sailing', zh: '休闲/帆船' },
  OTHER: { key: 'OTHER', color: '#9E9E9E', en: 'Other / Unknown', zh: '其他/未知' },
};

export const CATEGORY_ORDER = [
  'CARGO', 'TANKER', 'FISHING', 'PASSENGER',
  'TUG', 'SPECIAL', 'LEISURE', 'OTHER',
];

const TYPE_RULES = [
  ['CARGO', ['cargo', 'container', 'bulk carrier', 'general cargo', 'refrigerated']],
  ['TANKER', ['tanker', 'lng', 'lpg', 'chemical']],
  ['FISHING', ['fishing']],
  ['PASSENGER', ['passenger', 'cruise', 'ferry', 'hsc']],
  ['TUG', ['tug', 'towing']],
  ['SPECIAL', ['dredging', 'pilot', 'sar', 'search and rescue', 'law enforcement',
    'military', 'port tender', 'diving', 'anti-pollution', 'medical', 'wig',
    'spare', 'reserved']],
  ['LEISURE', ['pleasure', 'sailing', 'yacht']],
];

export function categorize(vesselType) {
  const t = String(vesselType || '').toLowerCase().trim();
  if (!t || t === 'unknown' || t === 'not available' || t === 'unavailable') {
    return CATEGORIES.OTHER;
  }
  for (const [key, words] of TYPE_RULES) {
    if (words.some((w) => t.includes(w))) return CATEGORIES[key];
  }
  return CATEGORIES.OTHER;
}

// Two root-level CSV files; add more filenames here to extend the timeline.
export const CSV_FILES = [
  'exactEarth-20231111-111000.csv',
  'exactEarth-20231111-111500.csv',
];

export const POINT_SIZE = 6;
export const POINT_SIZE_SELECTED = 11;
export const MAX_GAP_MS = 20 * 60 * 1000; // hold last known position up to 20 min
