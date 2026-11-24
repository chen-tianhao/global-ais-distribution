import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

// Lightweight middleware that serves the two root-level CSV files to the
// browser at /data/<filename>. This avoids duplicating ~60 MB into public/.
function serveRootCsv() {
  return {
    name: 'serve-root-csv',
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const name = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
        if (!name.endsWith('.csv')) return next();
        const safe = path.basename(name);
        const file = path.join(ROOT, safe);
        if (!fs.existsSync(file)) return next();
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(file).pipe(res);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const name = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
        if (!name.endsWith('.csv')) return next();
        const safe = path.basename(name);
        const file = path.join(ROOT, safe);
        if (!fs.existsSync(file)) return next();
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [cesium(), serveRootCsv()],
  server: { port: 5173 },
});
