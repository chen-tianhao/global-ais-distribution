import Papa from 'papaparse';

function parseUtc(value) {
  if (!value || value === '0') return NaN;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    return Date.parse(s.replace(' ', 'T') + 'Z');
  }
  if (/^\d{14}$/.test(s)) {
    return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
      +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
  }
  return Date.parse(s);
}

function num(v) {
  if (v === '' || v === null || v === undefined) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

self.onmessage = (e) => {
  const { text, label } = e.data;
  const vessels = new Map();
  let skipped = 0;
  let parsed = 0;

  Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    step: (result) => {
      const r = result.data;
      parsed += 1;
      const mmsi = String(r.mmsi || '').trim();
      const lon = num(r.longitude);
      const lat = num(r.latitude);
      const t = parseUtc(r.dt_pos_utc || r.ts_pos_utc);
      if (!mmsi || !Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(t)) {
        skipped += 1;
        return;
      }
      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        skipped += 1;
        return;
      }

      let v = vessels.get(mmsi);
      if (!v) {
        v = {
          mmsi,
          name: String(r.vessel_name || '').trim(),
          imo: String(r.imo || '').trim(),
          callsign: String(r.callsign || '').trim(),
          type: String(r.vessel_type || '').trim(),
          flag: String(r.flag_country || '').trim(),
          dest: String(r.destination || '').trim(),
          length: num(r.length),
          width: num(r.width),
          fixes: [],
        };
        vessels.set(mmsi, v);
      } else {
        if (!v.name && r.vessel_name) v.name = String(r.vessel_name).trim();
        if (!v.type && r.vessel_type) v.type = String(r.vessel_type).trim();
        if (!v.flag && r.flag_country) v.flag = String(r.flag_country).trim();
        if (!v.dest && r.destination) v.dest = String(r.destination).trim();
        if (!Number.isFinite(v.length)) v.length = num(r.length);
        if (!Number.isFinite(v.width)) v.width = num(r.width);
      }

      v.fixes.push([
        t, lon, lat,
        num(r.sog), num(r.cog), num(r.heading),
        String(r.nav_status || '').trim(),
      ]);

      if (parsed % 20000 === 0) {
        self.postMessage({ type: 'progress', label, parsed, skipped });
      }
    },
    complete: () => {
      const out = [];
      for (const v of vessels.values()) {
        v.fixes.sort((a, b) => a[0] - b[0]);
        out.push(v);
      }
      self.postMessage({ type: 'done', label, vessels: out, parsed, skipped });
    },
    error: (err) => {
      self.postMessage({ type: 'error', label, message: String(err && err.message || err) });
    },
  });
};
