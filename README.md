# AIS Voyage Replay

Global AIS vessel positions rendered as an interactive replay. Pure client-side:
CesiumJS for the globe, Vite for the build, no Cesium ion token required.

## Quick start

```bash
npm install
npm run prepare-data   # optional: build the compact binary dataset
npm run dev            # http://localhost:5173
```

`prepare-data` is an optimisation. Without it the app streams the root CSV files
through a Web Worker and still works.

## Dataset

| Item | Value |
| --- | --- |
| Source files | `exactEarth-20231111-111000.csv`, `exactEarth-20231111-111500.csv` |
| Raw rows | 188,024 |
| Position reports after dedupe | 187,638 |
| Invalid IMO check digit | 1,562 |
| Non-ship MMSI | 1,972 |
| Unique vessels | 82,595 |
| Time window | 2023-11-11 11:05:00 → 11:15:00 UTC |

Field conventions applied during normalisation:

- `sog` is in knots (0–102.2). Values outside that range are AIS sentinels and
  are dropped, not displayed.
- `cog` and `heading` are in degrees. Values ≥ 360 are invalid; the source data
  contains out-of-range readings (max 405.6 and 508) which are discarded rather
  than plotted.
- `nav_status_code` is defined for 0–15. This feed also contains 16, which is
  reported as unknown.
- `vessel_type` follows the AIS enumeration. `Spare`, `Reserved`,
  `Not Available`, `Unavailable` and `Other` map to the Other category, not to
  Special purpose.
- `dt_pos_utc` and `ts_pos_utc` are both parsed as UTC. A third, unrecognised
  format is rejected instead of falling back to `Date.parse`, which would apply
  the local timezone.

## Data pipeline

```
CSV (58 MB)
  └─ DatasetBuilder        normalise, validate, sort, dedupe, flatten
      └─ AISB v1 binary    9.1 MB, decoded in tens of ms
          └─ viewer        typed arrays, zero parse on the main thread
```

`npm run prepare-data` writes `data/ais-<timestamp>.bin` and
`data/manifest.json`. The loader reads the manifest first and falls back to CSV
when it is absent or the binary is unusable.

Binary layout is documented in `src/data/format.js`: a 64-byte header, a 48-byte
vessel record, a 20-byte fix record, and an interned UTF-8 string blob.

## Build and deploy

```bash
npm run build     # self-contained dist/, including dist/data/
npm run preview
```

The Vite plugin copies the dataset into `dist/data/`, because the dev-only
`/data/*` middleware does not exist in a static deployment.

Basemap tiles default to Esri World Imagery: no key, CDN-hosted, and detailed
enough at harbour zoom to resolve quays and terminal outlines. All providers
used here publish Web Mercator tiles in WGS84, so AIS positions need no datum
shift. Point `VITE_TILE_URL` at another provider when self-hosting:

```bash
VITE_TILE_URL="https://your-tile-host/{z}/{x}/{y}.png" npm run build
```

Two provider-specific details are worth knowing:

- Esri templates use `{z}/{y}/{x}` order, which is what the default value uses.
- The bundled Natural Earth II asset only contains zoom levels 0-2. Its
  provider is created with `maximumLevel: 2`; without that cap Cesium requests
  non-existent levels at harbour zoom and the tile scheduler stalls, leaving
  the globe at its coarsest level.

Attribution is intentionally left visible: `.cesium-viewer-bottom` is lifted
above the play bar rather than hidden, since the credits satisfy both the
imagery provider terms and the Cesium licence.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on 0.0.0.0:5173 |
| `npm run build` | Production build with dataset copied to `dist/data/` |
| `npm run preview` | Serve the production build |
| `npm run prepare-data` | Rebuild the binary dataset from CSV |
| `npm test` | Unit tests (normalisation, binary round-trip) |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

## Interaction

- Space: play / pause. Left/Right: step 30 s. Esc: close the info panel.
- Vessels are drawn as hull silhouettes rotated to their heading (course over
  ground when heading is unavailable), so direction is readable at a glance.
-Vessel density adapts to zoom: the full set is drawn below 400 km altitude,
  and progressively fewer (about 2,000 globally, commercial traffic first) at
  wider views. Selection is stable, so markers do not flicker while panning.
- Dragging the timeline pauses playback and resumes it on release.
- Clicking a vessel opens its details and flies to it when the view is too far.
- Clicking a legend row toggles that category; the header count follows.
- The URL carries `t`, `mmsi`, `lang` and `speed`, so a view can be shared.

## Known limits

- All data is held in the browser. Beyond a few hundred thousand reports this
  approach needs server-side slicing instead.
- Reports are roughly 10 minutes apart, so positions between them are linear
  interpolation. Markers dim once a report is older than 12 minutes, and gaps
  longer than 30 minutes are treated as track breaks rather than interpolated.
- No terrain elevation: positions sit on the ellipsoid at a constant altitude.
- The horizontal accuracy of AIS positions is not modelled.

## Licence

MIT. See `LICENSE`.
