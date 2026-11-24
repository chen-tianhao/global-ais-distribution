// Dataset loading strategy.
//
// 1. Prefer the prebuilt binary described by data/manifest.json: one request,
//    ~11 MB, no CSV parsing on either thread.
// 2. Fall back to streaming the root CSV files through a worker. This keeps
//    the app runnable straight after clone, before `npm run prepare-data`.

import { CSV_FILES, DATA_BASE, MANIFEST_URL } from '../config.js';
import { decodeDataset } from './format.js';

async function fetchManifest() {
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    return json && typeof json.binary === 'string' ? json : null;
  } catch {
    // A missing manifest is the normal case before prepare-data has run.
    return null;
  }
}

function mergeChunks(chunks, total) {
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export async function fetchWithProgress(url, onProgress, meta = {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const totalBytes = Number(res.headers.get('content-length')) || 0;
  if (!res.body) {
    const buffer = await res.arrayBuffer();
    onProgress({
      phase: 'download', ...meta,
      loaded: buffer.byteLength, totalBytes: buffer.byteLength, done: true,
    });
    return buffer;
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
    if (loaded - lastReport >= 2 * 1024 * 1024) {
      lastReport = loaded;
      onProgress({ phase: 'download', ...meta, loaded, totalBytes });
    }
  }
  onProgress({ phase: 'download', ...meta, loaded, totalBytes, done: true });
  return mergeChunks(chunks, loaded).buffer;
}

function loadCsv(onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parseWorker.js', import.meta.url), { type: 'module' });
    const files = CSV_FILES.map((name) => ({
      name,
      url: `${DATA_BASE}${encodeURIComponent(name)}`,
    }));

    worker.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'progress') {
        onProgress(msg);
      } else if (msg.type === 'done') {
        worker.terminate();
        resolve({ ...msg.dataset, source: 'csv' });
      } else if (msg.type === 'error') {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'CSV worker failed'));
    };

    worker.postMessage({ files });
  });
}

/**
 * @param {{ onProgress?: Function, preferBinary?: boolean }} options
 * @returns {Promise<object>} dataset
 */
export async function loadDataset({ onProgress = () => {}, preferBinary = true } = {}) {
  if (preferBinary) {
    const manifest = await fetchManifest();
    if (manifest) {
      try {
        const buffer = await fetchWithProgress(
          `${DATA_BASE}${manifest.binary}`,
          onProgress,
          { name: manifest.binary, index: 0, total: 1 },
        );
        onProgress({ phase: 'decode', name: manifest.binary, index: 0, total: 1 });
        const dataset = decodeDataset(buffer);
        dataset.manifest = manifest;
        dataset.source = 'binary';
        // Quality metrics are not part of the binary payload; carry them over
        // from the manifest so both load paths report the same statistics.
        dataset.stats.invalidImo = manifest.invalidImo ?? 0;
        dataset.stats.nonShipMmsi = manifest.nonShipMmsi ?? 0;
        return dataset;
      } catch (err) {
        // Corrupt or partially uploaded binary: degrade to CSV instead of
        // failing the whole application.
        console.warn('[data] binary dataset unusable, falling back to CSV', err);
      }
    }
  }

  const dataset = await loadCsv(onProgress);
  dataset.manifest = null;
  return dataset;
}

export { CSV_FILES };
