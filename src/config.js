// Central configuration: vessel categories, AIS code tables, scene and data
// constants. Everything that tuning or translation may want to touch lives
// here so that scene/UI modules stay free of magic numbers.

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

// AIS vessel_type is a closed enumeration in most feeds. Exact matching keeps
// short tokens such as "SAR" from matching unrelated strings, while the
// keyword pass keeps other providers (which emit verbose type names) working.
const TYPE_EXACT = {
  cargo: 'CARGO',
  tanker: 'TANKER',
  fishing: 'FISHING',
  tug: 'TUG',
  towing: 'TUG',
  pusher: 'TUG',
  passenger: 'PASSENGER',
  hsc: 'PASSENGER',
  'pleasure craft': 'LEISURE',
  pleasure: 'LEISURE',
  sailing: 'LEISURE',
  yacht: 'LEISURE',
  dredging: 'SPECIAL',
  pilot: 'SPECIAL',
  sar: 'SPECIAL',
  military: 'SPECIAL',
  'port tender': 'SPECIAL',
  'law enforcement': 'SPECIAL',
  diving: 'SPECIAL',
  'medical transport': 'SPECIAL',
  wig: 'SPECIAL',
  'vessel with anti-pollution equipment': 'SPECIAL',
  'anti-pollution': 'SPECIAL',
};

// Values that AIS uses to mean "no information". They must not reach the
// keyword pass, otherwise "spare"/"reserved" would read as real types.
const TYPE_NULL = new Set([
  '', 'other', 'unknown', 'undefined', 'not available', 'unavailable',
  'spare', 'reserved', 'ships not party to armed conflict',
]);

const TYPE_KEYWORDS = [
  ['CARGO', ['cargo', 'container', 'bulk carrier', 'refrigerated']],
  ['TANKER', ['tanker', 'lng', 'lpg', 'chemical']],
  ['FISHING', ['fishing']],
  ['PASSENGER', ['passenger', 'cruise', 'ferry']],
  ['TUG', ['tug', 'towing']],
  ['LEISURE', ['pleasure', 'sailing', 'yacht']],
  ['SPECIAL', ['dredging', 'pilot', 'search and rescue', 'law enforcement',
    'military', 'port tender', 'diving', 'anti-pollution', 'medical']],
];

export function categorize(vesselType) {
  const raw = String(vesselType ?? '').toLowerCase().trim();
  if (TYPE_NULL.has(raw)) return CATEGORIES.OTHER;
  const exact = TYPE_EXACT[raw];
  if (exact) return CATEGORIES[exact];
  for (const [key, words] of TYPE_KEYWORDS) {
    if (words.some((w) => raw.includes(w))) return CATEGORIES[key];
  }
  return CATEGORIES.OTHER;
}

// AIS navigation status is defined for 0-15. Values outside that range occur
// in real feeds (this dataset contains 16) and are reported as unknown.
export const NAV_STATUS_MAX = 15;

// Scene tuning -------------------------------------------------------------

// Vessel markers are billboards drawn as a hull silhouette with the bow up, so
// heading is expressed by rotation rather than by a symmetric dot.
export const ICON_SIZE = 18;
// Points sit above the ellipsoid so that linear interpolation between fixes
// never sinks the marker below the globe surface.
export const ICON_ALTITUDE_M = 300;
export const ICON_SELECTED_SCALE = 1.7;
// Distant vessels shrink: at a global view 18 px icons overlap into a smear.
export const ICON_SCALE_NEAR = 1.5;
export const ICON_SCALE_FAR = 0.6;
export const ICON_NEAR_DISTANCE = 150_000;
export const ICON_FAR_DISTANCE = 12_000_000;

// Level of detail. Vessels are assigned to one of LOD_BUCKETS buckets by class
// priority and a stable hash of the MMSI; a view draws only the leading
// buckets. Selection is stable, so markers do not flicker between frames and
// the same vessels stay visible while the camera moves.
export const LOD_BUCKETS = 64;
export const LOD_LEVELS = [
  { maxHeight: 400_000, buckets: 64 },
  { maxHeight: 1_500_000, buckets: 32 },
  { maxHeight: 5_000_000, buckets: 16 },
  { maxHeight: 12_000_000, buckets: 4 },
  { maxHeight: Number.POSITIVE_INFINITY, buckets: 1 },
];
// Lower bucket half = shown earlier when zoomed out (commercial traffic first).
export const LOD_CLASS_PRIORITY = {
  CARGO: 0, TANKER: 0,
  PASSENGER: 1, FISHING: 1, TUG: 1,
  SPECIAL: 2, LEISURE: 2,
  OTHER: 3,
};

// A gap longer than this is treated as a track break: the vessel keeps its
// last position but is drawn as stale instead of being interpolated across.
export const MAX_SEGMENT_GAP_MS = 30 * 60 * 1000;
// Keep a vessel on screen this long after its final report.
export const MAX_HOLD_MS = 20 * 60 * 1000;
// No new report within this window => marker dims (position is inferred).
export const STALE_AFTER_MS = 12 * 60 * 1000;

export const CAMERA_MIN_ZOOM_M = 1000;
// Update cadence by camera height: far views do not need 60 Hz point updates.
export const UPDATE_INTERVAL_FAR_MS = 350;
export const UPDATE_INTERVAL_MID_MS = 140;
export const UPDATE_INTERVAL_NEAR_MS = 60;
export const CAMERA_FAR_M = 6_000_000;
export const CAMERA_MID_M = 1_000_000;

// Data ---------------------------------------------------------------------

// Root-level CSV files used as the fallback path when no prebuilt binary is
// available. Add more filenames here to extend the timeline.
export const CSV_FILES = [
  'exactEarth-20231111-111000.csv',
  'exactEarth-20231111-111500.csv',
];

export const MANIFEST_URL = '/data/manifest.json';
export const DATA_BASE = '/data/';

// Basemap tiles. Esri's World Imagery is used by default: it needs no key,
// is served from a CDN that tolerates an interactive globe, and resolves
// coastlines and terminal outlines at harbour zoom. All candidate providers
// (Esri, OSM) publish Web Mercator tiles in WGS84, so AIS positions need no
// datum shift. Note the {z}/{y}/{x} order, which is Esri-specific.
// Override with VITE_TILE_URL for production or self-hosting.
export const TILE_URL = import.meta.env?.VITE_TILE_URL
  || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const TILE_CREDIT = 'Esri, Maxar, Earthstar Geographics';
export const TILE_MAX_LEVEL = 19;
