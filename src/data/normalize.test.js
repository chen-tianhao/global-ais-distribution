import { describe, it, expect } from 'vitest';
import { CATEGORIES, categorize } from '../config.js';
import {
  parseUtc,
  sanitizeSog,
  sanitizeCourse,
  sanitizeHeading,
  sanitizeNavStatus,
  isValidImo,
  isShipMmsi,
  DatasetBuilder,
} from './normalize.js';

describe('categorize', () => {
  it('maps the standard AIS type names', () => {
    expect(categorize('Cargo')).toBe(CATEGORIES.CARGO);
    expect(categorize('Tanker')).toBe(CATEGORIES.TANKER);
    expect(categorize('Fishing')).toBe(CATEGORIES.FISHING);
    expect(categorize('Passenger')).toBe(CATEGORIES.PASSENGER);
    expect(categorize('HSC')).toBe(CATEGORIES.PASSENGER);
    expect(categorize('Tug')).toBe(CATEGORIES.TUG);
    expect(categorize('Towing')).toBe(CATEGORIES.TUG);
    expect(categorize('Pleasure Craft')).toBe(CATEGORIES.LEISURE);
    expect(categorize('SAR')).toBe(CATEGORIES.SPECIAL);
  });

  it('treats AIS null and reserved values as unknown', () => {
    expect(categorize('Spare')).toBe(CATEGORIES.OTHER);
    expect(categorize('Reserved')).toBe(CATEGORIES.OTHER);
    expect(categorize('Not Available')).toBe(CATEGORIES.OTHER);
    expect(categorize('UNAVAILABLE')).toBe(CATEGORIES.OTHER);
    expect(categorize('Ships Not Party to Armed Conflict')).toBe(CATEGORIES.OTHER);
    expect(categorize('')).toBe(CATEGORIES.OTHER);
  });

  it('falls back to keyword matching for verbose provider strings', () => {
    expect(categorize('Oil Products Tanker')).toBe(CATEGORIES.TANKER);
    expect(categorize('Bulk Carrier')).toBe(CATEGORIES.CARGO);
    expect(categorize('Search and Rescue vessel')).toBe(CATEGORIES.SPECIAL);
  });
});

describe('parseUtc', () => {
  it('parses both feed formats as UTC', () => {
    const expected = Date.UTC(2023, 10, 11, 11, 5, 0);
    expect(parseUtc('2023-11-11 11:05:00')).toBe(expected);
    expect(parseUtc('20231111110500')).toBe(expected);
  });

  it('rejects unparseable input instead of guessing a timezone', () => {
    expect(parseUtc('')).toBeNaN();
    expect(parseUtc('0')).toBeNaN();
    expect(parseUtc('not a date')).toBeNaN();
    expect(parseUtc(null)).toBeNaN();
  });
});

describe('sanitizers', () => {
  it('keeps physical values and drops AIS sentinels', () => {
    expect(sanitizeSog('18.6')).toBe(18.6);
    expect(sanitizeSog('102.3')).toBeNaN();
    expect(sanitizeSog('-1')).toBeNaN();

    expect(sanitizeCourse('359.9')).toBe(359.9);
    expect(sanitizeCourse('405.6')).toBeNaN();
    expect(sanitizeHeading('359')).toBe(359);
    expect(sanitizeHeading('508')).toBeNaN();
  });

  it('maps unknown navigation status codes to 255', () => {
    expect(sanitizeNavStatus('0')).toBe(0);
    expect(sanitizeNavStatus('7')).toBe(7);
    expect(sanitizeNavStatus('16')).toBe(255);
    expect(sanitizeNavStatus('')).toBe(255);
  });
});

describe('identity validation', () => {
  it('validates the IMO check digit', () => {
    expect(isValidImo('9123453')).toBe(true);
    expect(isValidImo('9123456')).toBe(false);
    expect(isValidImo('123456')).toBe(false);
    expect(isValidImo('')).toBe(false);
  });

  it('distinguishes ship MMSIs from other station classes', () => {
    expect(isShipMmsi('205264000')).toBe(true);
    expect(isShipMmsi('413973726')).toBe(true);
    expect(isShipMmsi('002320000')).toBe(false); // base station
    expect(isShipMmsi('992051234')).toBe(false); // aid to navigation
    expect(isShipMmsi('20526400')).toBe(false);
  });
});

describe('DatasetBuilder', () => {
  const row = (mmsi, time, lon, lat, extra = {}) => ({
    mmsi, time: Date.parse(time), lon, lat,
    sog: 10, cog: 90, heading: 90, navStatus: 0,
    name: '', imo: '', callsign: '', type: 'Cargo', flag: '', dest: '',
    length: 100, width: 20, ...extra,
  });

  it('sorts fixes, dedupes timestamps and builds contiguous slices', () => {
    const builder = new DatasetBuilder();
    builder.add(row('200000001', '2023-11-11T11:10:00Z', 4, 52));
    builder.add(row('200000001', '2023-11-11T11:05:00Z', 3, 51));
    builder.add(row('200000001', '2023-11-11T11:05:00Z', 3.5, 51.5));
    builder.add(row('200000002', '2023-11-11T11:05:00Z', 10, 60));

    const dataset = builder.finish();

    expect(dataset.vessels).toHaveLength(2);
    expect(dataset.fixTime).toHaveLength(3); // 2 for the first vessel, 1 for the second

    const first = dataset.vessels[0];
    expect(first.mmsi).toBe('200000001');
    expect(first.fixCount).toBe(2);
    expect(dataset.fixLon[first.fixStart]).toBeCloseTo(3.5, 5); // later duplicate wins
    expect(dataset.fixTime[first.fixStart]).toBe(0);
    expect(dataset.fixTime[first.fixStart + 1]).toBe(300);

    const second = dataset.vessels[1];
    expect(second.fixStart).toBe(2);
    expect(dataset.stats.reportCount).toBe(3);
  });

  it('rejects rows without a usable position', () => {
    const builder = new DatasetBuilder();
    expect(builder.add(row('200000003', '2023-11-11T11:05:00Z', 0, 0))).toBe(true);
    expect(builder.add(row('200000004', '2023-11-11T11:05:00Z', 200, 0))).toBe(false);
    expect(builder.add(row('200000005', '2023-11-11T11:05:00Z', 0, 95))).toBe(false);
    expect(builder.add(row('', '2023-11-11T11:05:00Z', 1, 1))).toBe(false);
    expect(builder.add(row('200000006', 'x', 1, 1))).toBe(false);
    expect(builder.skipped).toBe(4);
  });

  it('carries static fields from the first sighting', () => {
    const builder = new DatasetBuilder();
    builder.add(row('200000007', '2023-11-11T11:05:00Z', 1, 1, {
      name: 'TEST VESSEL', imo: '9123453', callsign: 'ABC1', flag: 'China', dest: 'SINGAPORE',
    }));
    const dataset = builder.finish();
    expect(dataset.vessels[0].name).toBe('TEST VESSEL');
    expect(dataset.vessels[0].imo).toBe('9123453');
    expect(dataset.vessels[0].callsign).toBe('ABC1');
    expect(dataset.vessels[0].flag).toBe('China');
    expect(dataset.vessels[0].dest).toBe('SINGAPORE');
  });
});
