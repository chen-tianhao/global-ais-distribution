// Binary dataset format (AISB v1).
//
// Layout (little endian):
//   header      64 bytes
//   vessel[]    VESSEL_STRIDE bytes each
//   fix[]       FIX_STRIDE bytes each
//   strings     UTF-8 blob, referenced as (offset, length) pairs
//
// The format exists to avoid shipping ~58 MB of CSV: the same data compresses
// to roughly 11 MB and decodes in tens of milliseconds instead of seconds,
// because the client never runs a general-purpose CSV parser.

export const MAGIC = 'AISB';
export const VERSION = 1;
export const HEADER_SIZE = 64;
export const VESSEL_STRIDE = 48;
export const FIX_STRIDE = 20;

const VESSEL_STRING_SLOTS = 6; // name, imo, callsign, type, flag, dest
const STRING_SLOT_SIZE = 5;    // u32 offset + u8 length
const STRING_SLOT_BASE = 16;

const NO_VALUE = 0xffff;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

function toScaled(value, factor, limit) {
  if (!Number.isFinite(value)) return NO_VALUE;
  const scaled = Math.round(value * factor);
  if (scaled < 0 || scaled >= limit) return NO_VALUE;
  return scaled;
}

function fromScaled(raw, factor) {
  return raw === NO_VALUE ? NaN : raw / factor;
}

/**
 * Encode a dataset produced by DatasetBuilder.finish().
 * @param {object} dataset
 * @returns {ArrayBuffer}
 */
export function encodeDataset(dataset) {
  const { vessels, fixTime, fixLon, fixLat, fixSog, fixCog, fixHeading, fixNav } = dataset;
  const vesselCount = vessels.length;
  const fixCount = fixTime.length;

  // Intern strings: feeds repeat vessel names and destinations heavily.
  const stringOffsets = new Map();
  const chunks = [];
  let blobLength = 0;

  const intern = (value) => {
    const s = value == null ? '' : String(value);
    if (!s) return { offset: 0, length: 0 };
    const cached = stringOffsets.get(s);
    if (cached) return cached;
    let bytes = encoder.encode(s);
    if (bytes.length > 255) {
      // Truncate on a character boundary by decoding with a partial stream.
      bytes = encoder.encode(decoder.decode(bytes.subarray(0, 255)));
      if (bytes.length > 255) bytes = bytes.subarray(0, 255);
    }
    const entry = { offset: blobLength, length: bytes.length };
    chunks.push(bytes);
    blobLength += bytes.length;
    stringOffsets.set(s, entry);
    return entry;
  };

  const refs = new Array(vesselCount);
  for (let i = 0; i < vesselCount; i += 1) {
    const v = vessels[i];
    refs[i] = [
      intern(v.name), intern(v.imo), intern(v.callsign),
      intern(v.type), intern(v.flag), intern(v.dest),
    ];
  }

  const vesselTableOffset = HEADER_SIZE;
  const fixTableOffset = vesselTableOffset + vesselCount * VESSEL_STRIDE;
  const stringBlobOffset = fixTableOffset + fixCount * FIX_STRIDE;
  const total = stringBlobOffset + blobLength;

  const buffer = new ArrayBuffer(total);
  const dv = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  for (let i = 0; i < 4; i += 1) u8[i] = MAGIC.charCodeAt(i);
  dv.setUint16(4, VERSION, true);
  dv.setUint16(6, 0, true);
  dv.setUint32(8, vesselCount, true);
  dv.setUint32(12, fixCount, true);
  dv.setFloat64(16, dataset.timeBase, true);
  dv.setFloat64(24, dataset.timeMin, true);
  dv.setFloat64(32, dataset.timeMax, true);
  dv.setUint32(40, blobLength, true);
  dv.setUint32(44, vesselTableOffset, true);
  dv.setUint32(48, fixTableOffset, true);
  dv.setUint32(52, stringBlobOffset, true);
  dv.setUint32(56, 0, true);
  dv.setUint32(60, 0, true);

  for (let i = 0; i < vesselCount; i += 1) {
    const v = vessels[i];
    const base = vesselTableOffset + i * VESSEL_STRIDE;
    dv.setUint32(base, Number(v.mmsi) >>> 0, true);
    dv.setUint32(base + 4, v.fixStart, true);
    dv.setUint16(base + 8, v.fixCount, true);
    dv.setUint16(base + 10, v.length || 0, true);
    dv.setUint16(base + 12, v.width || 0, true);
    dv.setUint8(base + 14, v.categoryId & 0xff);
    dv.setUint8(base + 15, 0);
    for (let s = 0; s < VESSEL_STRING_SLOTS; s += 1) {
      const ref = refs[i][s];
      const p = base + STRING_SLOT_BASE + s * STRING_SLOT_SIZE;
      dv.setUint32(p, ref.offset, true);
      dv.setUint8(p + 4, ref.length);
    }
    dv.setUint16(base + 46, 0, true);
  }

  for (let i = 0; i < fixCount; i += 1) {
    const base = fixTableOffset + i * FIX_STRIDE;
    dv.setFloat32(base, fixTime[i], true);
    dv.setFloat32(base + 4, fixLon[i], true);
    dv.setFloat32(base + 8, fixLat[i], true);
    dv.setUint16(base + 12, toScaled(fixSog[i], 10, 0xfffe), true);
    dv.setUint16(base + 14, toScaled(fixCog[i], 10, 0xfffe), true);
    dv.setUint16(base + 16, toScaled(fixHeading[i], 10, 0xfffe), true);
    dv.setUint8(base + 18, fixNav[i]);
    dv.setUint8(base + 19, 0);
  }

  let p = stringBlobOffset;
  for (const chunk of chunks) {
    u8.set(chunk, p);
    p += chunk.length;
  }

  return buffer;
}

/**
 * Decode an AISB buffer back into the dataset shape used by the app.
 * @param {ArrayBuffer} buffer
 * @returns {object}
 */
export function decodeDataset(buffer) {
  const dv = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  for (let i = 0; i < 4; i += 1) {
    if (u8[i] !== MAGIC.charCodeAt(i)) throw new Error('Not an AIS binary dataset');
  }
  const version = dv.getUint16(4, true);
  if (version !== VERSION) throw new Error(`Unsupported dataset version ${version}`);

  const vesselCount = dv.getUint32(8, true);
  const fixCount = dv.getUint32(12, true);
  const timeBase = dv.getFloat64(16, true);
  const timeMin = dv.getFloat64(24, true);
  const timeMax = dv.getFloat64(32, true);
  const blobLength = dv.getUint32(40, true);
  const vesselTableOffset = dv.getUint32(44, true);
  const fixTableOffset = dv.getUint32(48, true);
  const stringBlobOffset = dv.getUint32(52, true);

  if (stringBlobOffset + blobLength > buffer.byteLength) {
    throw new Error('Truncated dataset');
  }
  const blob = new Uint8Array(buffer, stringBlobOffset, blobLength);

  const readString = (p) => {
    const offset = dv.getUint32(p, true);
    const length = dv.getUint8(p + 4);
    if (!length) return '';
    return decoder.decode(blob.subarray(offset, offset + length));
  };

  const fixTime = new Float32Array(fixCount);
  const fixLon = new Float32Array(fixCount);
  const fixLat = new Float32Array(fixCount);
  const fixSog = new Float32Array(fixCount);
  const fixCog = new Float32Array(fixCount);
  const fixHeading = new Float32Array(fixCount);
  const fixNav = new Uint8Array(fixCount);

  for (let i = 0; i < fixCount; i += 1) {
    const base = fixTableOffset + i * FIX_STRIDE;
    fixTime[i] = dv.getFloat32(base, true);
    fixLon[i] = dv.getFloat32(base + 4, true);
    fixLat[i] = dv.getFloat32(base + 8, true);
    fixSog[i] = fromScaled(dv.getUint16(base + 12, true), 10);
    fixCog[i] = fromScaled(dv.getUint16(base + 14, true), 10);
    fixHeading[i] = fromScaled(dv.getUint16(base + 16, true), 10);
    fixNav[i] = dv.getUint8(base + 18);
  }

  const vessels = new Array(vesselCount);
  for (let i = 0; i < vesselCount; i += 1) {
    const base = vesselTableOffset + i * VESSEL_STRIDE;
    const slot = (s) => base + STRING_SLOT_BASE + s * STRING_SLOT_SIZE;
    const fixStart = dv.getUint32(base + 4, true);
    const count = dv.getUint16(base + 8, true);
    vessels[i] = {
      mmsi: String(dv.getUint32(base, true)),
      name: readString(slot(0)),
      imo: readString(slot(1)),
      callsign: readString(slot(2)),
      type: readString(slot(3)),
      flag: readString(slot(4)),
      dest: readString(slot(5)),
      length: dv.getUint16(base + 10, true),
      width: dv.getUint16(base + 12, true),
      categoryId: dv.getUint8(base + 14),
      fixStart,
      fixCount: count,
      firstTime: timeBase + fixTime[fixStart] * 1000,
      lastTime: timeBase + fixTime[fixStart + count - 1] * 1000,
    };
  }

  return {
    timeBase,
    timeMin,
    timeMax,
    vessels,
    fixTime,
    fixLon,
    fixLat,
    fixSog,
    fixCog,
    fixHeading,
    fixNav,
    stats: { vesselCount, reportCount: fixCount, skipped: 0, dropped: 0 },
  };
}
