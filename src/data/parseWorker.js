// CSV fallback parser.
//
// Runs in a dedicated worker and performs its own fetch so that the ~58 MB of
// source text never enters the main thread. The main thread only receives the
// finished dataset, whose typed arrays are transferred (not copied).

import Papa from 'papaparse';
import { DatasetBuilder } from './normalize.js';

const decoder = new TextDecoder('utf-8');

function postProgress(payload) {
  self.postMessage({ type: 'progress', ...payload });
}

async function download(url, index, total, name) {
  postProgress({ phase: 'download', index, total, name, loaded: 0, totalBytes: 0 });

  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.fileName = name;
    err.status = res.status;
    throw err;
  }

  const totalBytes = Number(res.headers.get('content-length')) || 0;
  if (!res.body) {
    const text = await res.text();
    postProgress({
      phase: 'download', index, total, name,
      loaded: text.length, totalBytes: text.length, done: true,
    });
    return text;
  }

  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  let lastReport = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    // Report every ~2 MB so the UI stays responsive without flooding the
    // main thread with per-chunk messages.
    if (loaded - lastReport >= 2 * 1024 * 1024) {
      lastReport = loaded;
      postProgress({ phase: 'download', index, total, name, loaded, totalBytes });
    }
  }
  postProgress({ phase: 'download', index, total, name, loaded, totalBytes, done: true });

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decoder.decode(merged);
}

function parseText(text, ctx) {
  const { index, total, name, builder, errorCounts } = ctx;

  return new Promise((resolve, reject) => {
    let parsed = 0;

    Papa.parse(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      step: (result) => {
        parsed += 1;

        // PapaParse reports per-row problems here. Field-count drift is common
        // in this feed (34-40 columns) and is harmless as long as the leading
        // columns stay aligned, so errors are counted and surfaced rather than
        // used to drop rows. Rows missing a usable position are rejected by
        // DatasetBuilder itself.
        if (result.errors && result.errors.length) {
          for (const e of result.errors) {
            const code = e.code || e.type || 'Unknown';
            errorCounts[code] = (errorCounts[code] || 0) + 1;
          }
        }

        builder.addCsvRow(result.data);

        if (parsed % 20000 === 0) {
          postProgress({ phase: 'parse', index, total, parsed, name });
        }
      },
      complete: () => {
        postProgress({ phase: 'parse', index, total, parsed, name, done: true });
        resolve();
      },
      error: (err) => reject(err instanceof Error ? err : new Error(String(err))),
    });
  });
}

self.onmessage = async (event) => {
  const files = event.data?.files;
  if (!Array.isArray(files) || files.length === 0) {
    self.postMessage({ type: 'error', message: 'No input files' });
    return;
  }

  const builder = new DatasetBuilder();
  const errorCounts = Object.create(null);
  const total = files.length;

  try {
    for (let i = 0; i < total; i += 1) {
      const { url, name } = files[i];
      const text = await download(url, i, total, name);
      await parseText(text, { index: i, total, name, builder, errorCounts });
    }

    const dataset = builder.finish();
    dataset.stats.errors = errorCounts;

    self.postMessage({ type: 'done', dataset }, [
      dataset.fixTime.buffer,
      dataset.fixLon.buffer,
      dataset.fixLat.buffer,
      dataset.fixSog.buffer,
      dataset.fixCog.buffer,
      dataset.fixHeading.buffer,
      dataset.fixNav.buffer,
    ]);
  } catch (err) {
    const message = err?.fileName
      ? `${err.fileName}: ${err.message}`
      : (err?.message ?? String(err));
    self.postMessage({ type: 'error', message });
  }
};
