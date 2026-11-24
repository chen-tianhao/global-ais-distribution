// Field parsing, validation and dataset assembly.
//
// This module is deliberately free of DOM and Node APIs so that the exact same
// code path is used by the browser worker (CSV fallback) and by the offline
// binary builder (scripts/prepare-data.mjs). Divergence between those two
// paths would produce datasets that differ depending on how they were loaded.

import { CATEGORY_ORDER, categorize } from '../config.js';

const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;
const COMPACT_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;

/**
 * Parse an AIS timestamp into epoch milliseconds.
 *
 * Only the two formats present in the feed are accepted, and both are treated
 * as UTC. Anything else returns NaN instead of falling through to Date.parse,
 * whose behaviour depends on the local timezone and would silently shift the
 * timeline for users outside UTC.
 */
export function parseUtc(value) {
  if (value === null || value === undefined) return NaN;
  const s = String(value).trim();
  if (!s || s === '0') return NaN;

  let m = DATE_TIME_RE.exec(s);
  if (m) {
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }
  m = COMPACT_RE.exec(s);
  if (m) {
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }
  return NaN;
}

export function toNumber(value) {
  if (value === null || value === undefined) return NaN;
  const s = String(value).trim();
  if (!s || s.toLowerCase() === 'null') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// AIS encodes "not available" as sentinel values near 102.3 kn, 360 deg and
// 511 deg. Values beyond the physical range are dropped rather than displayed.
export function sanitizeSog(value) {
  const n = toNumber(value);
  if (!Number.isFinite(n) || n < 0 || n > 102.2) return NaN;
  return n;
}

export function sanitizeCourse(value) {
  const n = toNumber(value);
  if (!Number.isFinite(n) || n < 0 || n >= 360) return NaN;
  return n;
}

export function sanitizeHeading(value) {
  const n = toNumber(value);
  if (!Number.isFinite(n) || n < 0 || n >= 360) return NaN;
  return n;
}

export function sanitizeNavStatus(value) {
  const n = toNumber(value);
  if (!Number.isFinite(n) || n < 0 || n > 15) return 255;
  return n | 0;
}

function sanitizeDimension(value) {
  const n = toNumber(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1000) return 0;
  return Math.round(n);
}

function text(value, max = 120) {
  const s = String(value ?? '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

// The binary layout stores strings as offset+length into a single UTF-8 blob,
// with a single-byte length, so 255 is the hard ceiling.
export const MAX_STRING_BYTES = 255;

/**
 * IMO number check digit: seven digits, the last being the weighted sum of the
 * first six (weights 7..2) modulo 10. Mis-typed IMOs are common in AIS feeds,
 * so this is reported as a data-quality metric rather than silently trusted.
 */
export function isValidImo(value) {
  const s = String(value ?? '').trim();
  if (!/^\d{7}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 6; i += 1) sum += Number(s[i]) * (7 - i);
  return sum % 10 === Number(s[6]);
}

/**
 * Ship stations use a nine-digit MMSI starting with 2-7. Values starting with
 * 0, 1, 8 or 9 are base stations, SAR aircraft, handheld radios or aids to
 * navigation and are not vessels.
 */
export function isShipMmsi(value) {
  return /^[2-7]\d{8}$/.test(String(value ?? '').trim());
}

/**
 * Collects rows and assembles a flat, typed-array dataset.
 *
 * Layout: every vessel owns a contiguous slice [fixStart, fixStart+fixCount) of
 * the parallel fix arrays. Accessing fix k of vessel v therefore needs no
 * pointer chasing, and the whole dataset can be transferred to the main thread
 * without cloning per-object graphs.
 */
export class DatasetBuilder {
  constructor() {
    this.vessels = new Map();
    this.skipped = 0;
    this.dropped = 0;
    this.quality = { invalidImo: 0, nonShipMmsi: 0 };
  }

  /**
   * @param {object} row normalised row; see addCsvRow for the CSV adapter.
   * @returns {boolean} whether the row was accepted
   */
  add(row) {
    const { mmsi, time, lon, lat } = row;
    if (!mmsi || !Number.isFinite(time) || !Number.isFinite(lon) || !Number.isFinite(lat)) {
      this.skipped += 1;
      return false;
    }
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      this.skipped += 1;
      return false;
    }

    let v = this.vessels.get(mmsi);
    if (!v) {
      v = {
        mmsi,
        name: row.name || '',
        imo: row.imo || '',
        callsign: row.callsign || '',
        type: row.type || '',
        flag: row.flag || '',
        dest: row.dest || '',
        length: row.length || 0,
        width: row.width || 0,
        fixes: [],
      };
      this.vessels.set(mmsi, v);
      // Quality metrics are counted per vessel, not per report.
      if (row.imo && !isValidImo(row.imo)) this.quality.invalidImo += 1;
      if (!isShipMmsi(mmsi)) this.quality.nonShipMmsi += 1;
    } else {
      // Backfill descriptive fields that may be empty in the first sighting.
      if (!v.name && row.name) v.name = row.name;
      if (!v.imo && row.imo) v.imo = row.imo;
      if (!v.callsign && row.callsign) v.callsign = row.callsign;
      if (!v.type && row.type) v.type = row.type;
      if (!v.flag && row.flag) v.flag = row.flag;
      if (!v.dest && row.dest) v.dest = row.dest;
      if (!v.length && row.length) v.length = row.length;
      if (!v.width && row.width) v.width = row.width;
    }

    v.fixes.push([
      time,
      lon,
      lat,
      sanitizeSog(row.sog),
      sanitizeCourse(row.cog),
      sanitizeHeading(row.heading),
      sanitizeNavStatus(row.navStatus),
    ]);
    return true;
  }

  /** Adapt a raw CSV record (headers already trimmed) and add it. */
  addCsvRow(r) {
    return this.add({
      mmsi: text(r.mmsi, 16),
      time: parseUtc(r.dt_pos_utc ?? r.ts_pos_utc),
      lon: toNumber(r.longitude),
      lat: toNumber(r.latitude),
      sog: r.sog,
      cog: r.cog,
      heading: r.heading,
      navStatus: r.nav_status_code ?? r.nav_status,
      name: text(r.vessel_name),
      imo: text(r.imo, 16),
      callsign: text(r.callsign, 16),
      type: text(r.vessel_type, 64),
      flag: text(r.flag_country, 64),
      dest: text(r.destination, 64),
      length: sanitizeDimension(r.length),
      width: sanitizeDimension(r.width),
    });
  }

  /**
   * Sort, de-duplicate and flatten into typed arrays.
   * @returns {object} dataset
   */
  finish() {
    const accepted = [];
    let totalFixes = 0;

    for (const v of this.vessels.values()) {
      const fixes = v.fixes;
      if (!fixes.length) { this.dropped += 1; continue; }
      fixes.sort((a, b) => a[0] - b[0]);

      const deduped = [];
      for (const f of fixes) {
        const prev = deduped[deduped.length - 1];
        // Same MMSI and same second: keep the later record, which in practice
        // carries the more complete static fields.
        if (prev && prev[0] === f[0]) deduped[deduped.length - 1] = f;
        else deduped.push(f);
      }
      if (!deduped.length) { this.dropped += 1; continue; }

      v.fixes = deduped;
      totalFixes += deduped.length;
      accepted.push(v);
    }

    accepted.sort((a, b) => a.fixes[0][0] - b.fixes[0][0]);

    const n = accepted.length;
    const fixTime = new Float32Array(totalFixes);
    const fixLon = new Float32Array(totalFixes);
    const fixLat = new Float32Array(totalFixes);
    const fixSog = new Float32Array(totalFixes);
    const fixCog = new Float32Array(totalFixes);
    const fixHeading = new Float32Array(totalFixes);
    const fixNav = new Uint8Array(totalFixes);

    let timeBase = Infinity;
    let timeMax = -Infinity;
    for (const v of accepted) {
      const a = v.fixes[0][0];
      const b = v.fixes[v.fixes.length - 1][0];
      if (a < timeBase) timeBase = a;
      if (b > timeMax) timeMax = b;
    }
    if (!Number.isFinite(timeBase)) timeBase = 0;
    if (!Number.isFinite(timeMax)) timeMax = timeBase;

    const vessels = new Array(n);
    let cursor = 0;
    for (let i = 0; i < n; i += 1) {
      const src = accepted[i];
      const count = src.fixes.length;
      const cat = categorize(src.type);
      const catId = CATEGORY_ORDER.indexOf(cat.key);

      for (let k = 0; k < count; k += 1) {
        const f = src.fixes[k];
        const p = cursor + k;
        fixTime[p] = (f[0] - timeBase) / 1000;
        fixLon[p] = f[1];
        fixLat[p] = f[2];
        fixSog[p] = f[3];
        fixCog[p] = f[4];
        fixHeading[p] = f[5];
        fixNav[p] = f[6];
      }

      vessels[i] = {
        mmsi: src.mmsi,
        name: src.name,
        imo: src.imo,
        callsign: src.callsign,
        type: src.type,
        flag: src.flag,
        dest: src.dest,
        length: src.length,
        width: src.width,
        category: cat.key,
        categoryId: catId < 0 ? CATEGORY_ORDER.length - 1 : catId,
        fixStart: cursor,
        fixCount: count,
        firstTime: src.fixes[0][0],
        lastTime: src.fixes[count - 1][0],
      };
      cursor += count;
    }

    return {
      timeBase,
      timeMin: timeBase,
      timeMax,
      vessels,
      fixTime,
      fixLon,
      fixLat,
      fixSog,
      fixCog,
      fixHeading,
      fixNav,
      stats: {
        vesselCount: n,
        reportCount: totalFixes,
        skipped: this.skipped,
        dropped: this.dropped,
        invalidImo: this.quality.invalidImo,
        nonShipMmsi: this.quality.nonShipMmsi,
      },
    };
  }
}
