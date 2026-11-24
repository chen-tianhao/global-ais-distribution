import { describe, it, expect } from 'vitest';
import { encodeDataset, decodeDataset, HEADER_SIZE, VESSEL_STRIDE, FIX_STRIDE } from './format.js';
import { DatasetBuilder } from './normalize.js';

function sampleDataset() {
  const builder = new DatasetBuilder();
  const base = Date.parse('2023-11-11T11:05:00Z');
  const add = (mmsi, offsetSec, lon, lat, type, name, sog) => builder.add({
    mmsi,
    time: base + offsetSec * 1000,
    lon, lat,
    sog, cog: 123.4, heading: 120, navStatus: 0,
    name, imo: '9123453', callsign: 'CALL1', type, flag: 'China', dest: 'SINGAPORE',
    length: 200, width: 32,
  });

  add('200000001', 0, 103.8, 1.29, 'Cargo', 'ALPHA', 12.3);
  add('200000001', 300, 103.9, 1.3, 'Cargo', 'ALPHA', 12.5);
  add('200000002', 60, -4.5, 48.4, 'Tanker', 'BETA', NaN);
  return builder.finish();
}

describe('AISB binary format', () => {
  it('round-trips vessel and fix data', () => {
    const original = sampleDataset();
    const buffer = encodeDataset(original);
    const decoded = decodeDataset(buffer);

    expect(decoded.vessels).toHaveLength(2);
    expect(decoded.fixTime).toHaveLength(3);
    expect(decoded.timeBase).toBe(original.timeBase);
    expect(decoded.timeMax).toBe(original.timeMax);

    const a = decoded.vessels[0];
    expect(a.mmsi).toBe('200000001');
    expect(a.name).toBe('ALPHA');
    expect(a.imo).toBe('9123453');
    expect(a.callsign).toBe('CALL1');
    expect(a.flag).toBe('China');
    expect(a.dest).toBe('SINGAPORE');
    expect(a.length).toBe(200);
    expect(a.width).toBe(32);
    expect(a.categoryId).toBe(original.vessels[0].categoryId);
    expect(a.fixCount).toBe(2);

    expect(decoded.fixLon[a.fixStart]).toBeCloseTo(103.8, 4);
    expect(decoded.fixLat[a.fixStart]).toBeCloseTo(1.29, 4);
    expect(decoded.fixSog[a.fixStart]).toBeCloseTo(12.3, 1);
    expect(decoded.fixCog[a.fixStart]).toBeCloseTo(123.4, 1);
    expect(decoded.fixHeading[a.fixStart]).toBe(120);
    expect(decoded.fixNav[a.fixStart]).toBe(0);

    const b = decoded.vessels[1];
    expect(Number.isNaN(decoded.fixSog[b.fixStart])).toBe(true);
  });

  it('produces a compact layout', () => {
    const original = sampleDataset();
    const buffer = encodeDataset(original);
    const minimum = HEADER_SIZE
      + original.vessels.length * VESSEL_STRIDE
      + original.fixTime.length * FIX_STRIDE;
    expect(buffer.byteLength).toBeGreaterThanOrEqual(minimum);
    expect(buffer.byteLength).toBeLessThan(minimum + 1024);
  });

  it('rejects foreign buffers and truncated data', () => {
    expect(() => decodeDataset(new ArrayBuffer(128))).toThrow(/Not an AIS binary dataset/);

    const buffer = encodeDataset(sampleDataset());
    const truncated = buffer.slice(0, 60);
    expect(() => decodeDataset(truncated)).toThrow();
  });

  it('preserves the documented header magic', () => {
    const buffer = encodeDataset(sampleDataset());
    const bytes = new Uint8Array(buffer, 0, 4);
    expect(String.fromCharCode(...bytes)).toBe('AISB');
  });
});
