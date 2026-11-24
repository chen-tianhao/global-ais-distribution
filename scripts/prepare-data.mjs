#!/usr/bin/env node
// Offline dataset builder.
//
// Streams the configured CSV files through the same normalisation code the
// browser uses, then writes a compact binary (see src/data/format.js) plus a
// manifest. The client prefers the binary and falls back to CSV when absent,
// so this script is an optimisation, never a hard requirement.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';

import { CSV_FILES } from '../src/config.js';
import { DatasetBuilder } from '../src/data/normalize.js';
import { encodeDataset } from '../src/data/format.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT_DIR = path.join(ROOT, 'data');

function parseArgs(argv) {
  const options = { files: CSV_FILES };
  for (const arg of argv) {
    if (arg.startsWith('--files=')) {
      options.files = arg.slice('--files='.length).split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return options;
}

function stamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function ingest(file, builder, errorCounts) {
  const absolute = path.resolve(ROOT, file);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Source file not found: ${absolute}`);
  }

  let rows = 0;
  await new Promise((resolve, reject) => {
    Papa.parse(fs.createReadStream(absolute, { encoding: 'utf8' }), {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      step: (result) => {
        rows += 1;
        if (result.errors && result.errors.length) {
          for (const e of result.errors) {
            const code = e.code || e.type || 'Unknown';
            errorCounts[code] = (errorCounts[code] || 0) + 1;
          }
        }
        builder.addCsvRow(result.data);
        if (rows % 50000 === 0) {
          process.stdout.write(`\r  ${file}: ${rows.toLocaleString('en-US')} rows`);
        }
      },
      complete: resolve,
      error: (err) => reject(err instanceof Error ? err : new Error(String(err))),
    });
  });

  process.stdout.write(`\r  ${file}: ${rows.toLocaleString('en-US')} rows\n`);
}

async function main() {
  const { files } = parseArgs(process.argv.slice(2));
  const builder = new DatasetBuilder();
  const errorCounts = Object.create(null);

  console.log(`Building dataset from ${files.length} file(s)`);
  const started = Date.now();

  for (const file of files) {
    await ingest(file, builder, errorCounts);
  }

  const dataset = builder.finish();
  if (!dataset.vessels.length) throw new Error('No valid vessel records found');

  console.log('Encoding binary…');
  const buffer = encodeDataset(dataset);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const name = `ais-${stamp(dataset.timeMin).replace(/[^0-9TZ]/g, '')}.bin`;
  const outPath = path.join(OUT_DIR, name);
  fs.writeFileSync(outPath, Buffer.from(buffer));

  const manifest = {
    version: 1,
    binary: name,
    bytes: buffer.byteLength,
    source: files,
    generatedAt: new Date().toISOString(),
    timeMin: new Date(dataset.timeMin).toISOString(),
    timeMax: new Date(dataset.timeMax).toISOString(),
    vesselCount: dataset.stats.vesselCount,
    reportCount: dataset.stats.reportCount,
    skipped: dataset.stats.skipped,
    dropped: dataset.stats.dropped,
    invalidImo: dataset.stats.invalidImo,
    nonShipMmsi: dataset.stats.nonShipMmsi,
    parseErrors: errorCounts,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // Remove binaries from previous runs so the directory does not accumulate
  // stale datasets that the manifest no longer references.
  for (const entry of fs.readdirSync(OUT_DIR)) {
    if (entry.endsWith('.bin') && entry !== name) {
      fs.unlinkSync(path.join(OUT_DIR, entry));
    }
  }

  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  console.log('');
  console.log(`  vessels  ${dataset.stats.vesselCount.toLocaleString('en-US')}`);
  console.log(`  reports  ${dataset.stats.reportCount.toLocaleString('en-US')}`);
  console.log(`  skipped  ${dataset.stats.skipped.toLocaleString('en-US')}`);
  if (dataset.stats.invalidImo || dataset.stats.nonShipMmsi) {
    console.log(`  quality  invalid IMO ${dataset.stats.invalidImo.toLocaleString('en-US')}`
      + `, non-ship MMSI ${dataset.stats.nonShipMmsi.toLocaleString('en-US')}`);
  }
  console.log(`  output   data/${name} (${mb(buffer.byteLength)})`);
  console.log(`  elapsed  ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (Object.keys(errorCounts).length) {
    console.log(`  row warnings ${JSON.stringify(errorCounts)}`);
  }
}

main().catch((err) => {
  console.error(`\nFailed: ${err.message}`);
  process.exitCode = 1;
});
