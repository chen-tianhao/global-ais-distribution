import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CSV_FILES } from './src/config.js';

// Resolve from the config file rather than process.cwd(): the dev server must
// behave identically when started from another working directory.
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');

const CONTENT_TYPES = {
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bin': 'application/octet-stream',
};

function sendFile(file, res) {
  const type = CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';

  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    res.statusCode = 404;
    res.end('Dataset not found');
    return;
  }

  res.setHeader('Content-Type', type);
  // Without an explicit length the response falls back to chunked encoding and
  // the client cannot compute download progress.
  res.setHeader('Content-Length', size);
  res.setHeader('Cache-Control', 'no-cache');

  const stream = fs.createReadStream(file);
  stream.on('error', (err) => {
    // Headers may already be flushed once piping starts; destroy the response
    // so the client sees a failed transfer instead of a truncated file.
    if (res.headersSent) res.destroy(err);
    else {
      res.statusCode = 500;
      res.end('Failed to read dataset');
    }
  });
  stream.pipe(res);
}

// Serves /data/<file> from data/ first, then from the project root. The root
// fallback keeps the app runnable before `npm run prepare-data` has produced a
// binary, and preserves the original CSV-only workflow.
function datasetMiddleware() {
  return (req, res, next) => {
    const raw = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
    if (!raw) return next();

    // path.basename() rejects traversal attempts such as ../../secrets.
    const name = path.basename(raw);
    if (!CONTENT_TYPES[path.extname(name).toLowerCase()]) return next();

    const candidates = [path.join(DATA_DIR, name), path.join(ROOT, name)];
    const file = candidates.find((candidate) => fs.existsSync(candidate));
    if (!file) return next();

    sendFile(file, res);
  };
}

// A production build must be self-contained. Without this step the /data route
// that powers the dev server simply does not exist in dist/ and every dataset
// request returns 404.
function copyDatasetToDist(outDir) {
  const target = path.join(outDir, 'data');
  fs.mkdirSync(target, { recursive: true });

  const manifest = path.join(DATA_DIR, 'manifest.json');
  const hasBinary = fs.existsSync(manifest);

  if (hasBinary) {
    for (const entry of fs.readdirSync(DATA_DIR)) {
      fs.copyFileSync(path.join(DATA_DIR, entry), path.join(target, entry));
    }
    return;
  }

  // No prepared binary: ship the CSV fallback so the build still works.
  for (const name of CSV_FILES) {
    const src = path.join(ROOT, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(target, name));
  }
}

function datasetPlugin() {
  let outDir = path.join(ROOT, 'dist');

  return {
    name: 'ais-dataset',
    configResolved(config) {
      outDir = path.resolve(ROOT, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/data', datasetMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use('/data', datasetMiddleware());
    },
    closeBundle() {
      copyDatasetToDist(outDir);
    },
  };
}

export default defineConfig({
  plugins: [cesium(), datasetPlugin()],
  server: { port: 5173 },
  build: {
    // Cesium is a single large dependency; the default warning is noise here.
    chunkSizeWarningLimit: 4096,
  },
});
