// Cesium rendering layer.
//
// The scene owns all GPU-facing state. Data objects coming from the loader are
// never mutated here: per-vessel render state lives in parallel arrays indexed
// by the same order as dataset.vessels.
//
// Vessels are drawn as heading-oriented hull silhouettes (billboards) rather
// than dots, and are thinned out by zoom level so that a global view does not
// try to submit tens of thousands of textured quads.

import * as Cesium from 'cesium';
import {
  CATEGORIES, CATEGORY_ORDER,
  ICON_SIZE, ICON_ALTITUDE_M, ICON_SELECTED_SCALE,
  ICON_SCALE_NEAR, ICON_SCALE_FAR, ICON_NEAR_DISTANCE, ICON_FAR_DISTANCE,
  LOD_BUCKETS, LOD_LEVELS, LOD_CLASS_PRIORITY,
  MAX_SEGMENT_GAP_MS, MAX_HOLD_MS, STALE_AFTER_MS,
  CAMERA_MIN_ZOOM_M,
  UPDATE_INTERVAL_FAR_MS, UPDATE_INTERVAL_MID_MS, UPDATE_INTERVAL_NEAR_MS,
  CAMERA_FAR_M, CAMERA_MID_M,
  TILE_URL, TILE_CREDIT, TILE_MAX_LEVEL,
} from './config.js';

// No ion assets are requested anywhere in this app; clearing the default token
// prevents accidental use of Cesium's shared demo token.
Cesium.Ion.defaultAccessToken = '';

const NORMAL_COLORS = {};
const STALE_COLORS = {};
for (const [key, cat] of Object.entries(CATEGORIES)) {
  const base = Cesium.Color.fromCssColorString(cat.color);
  NORMAL_COLORS[key] = base.withAlpha(0.92);
  STALE_COLORS[key] = base.withAlpha(0.25);
}
const SELECTED_COLOR = Cesium.Color.WHITE;
const TRACK_MAX_POINTS = 600;

// Shared by every billboard; each instance clones the value on assignment.
const SCALE_BY_DISTANCE = new Cesium.NearFarScalar(
  ICON_NEAR_DISTANCE, ICON_SCALE_NEAR,
  ICON_FAR_DISTANCE, ICON_SCALE_FAR,
);

/**
 * Hull silhouette, bow up. White so that Billboard.color tints it per class;
 * the dark stroke stays dark after tinting because its RGB is near zero.
 */
function createVesselIcon() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  ctx.beginPath();
  ctx.moveTo(32, 2);   // bow
  ctx.lineTo(47, 18);  // starboard shoulder
  ctx.lineTo(47, 47);
  ctx.lineTo(38, 62);  // starboard quarter
  ctx.lineTo(26, 62);  // port quarter
  ctx.lineTo(17, 47);
  ctx.lineTo(17, 18);  // port shoulder
  ctx.closePath();

  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(6, 14, 24, 0.92)';
  ctx.stroke();

  return canvas.toDataURL('image/png');
}

const VESSEL_ICON = createVesselIcon();

/** FNV-1a, used to spread vessels of the same class across LOD buckets. */
function hashMmsi(mmsi) {
  let h = 2166136261;
  for (let i = 0; i < mmsi.length; i += 1) {
    h ^= mmsi.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class VoyageScene {
  constructor(container) {
    this.viewer = new Cesium.Viewer(container, {
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: false,
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    });

    const scene = this.viewer.scene;
    scene.globe.enableLighting = false;
    scene.sun.show = false;
    scene.moon.show = false;
    scene.skyAtmosphere.show = true;
    scene.screenSpaceCameraController.minimumZoomDistance = CAMERA_MIN_ZOOM_M;

    this._addImagery();

    this.billboards = scene.primitives.add(new Cesium.BillboardCollection());

    this.dataset = null;
    this.vessels = [];
    this.billboardOf = [];
    this.positionOf = [];
    this.cart = null;
    this.staleState = null;
    this.lodBuckets = [];
    this.lodThreshold = -1;

    this.enabled = new Set(CATEGORY_ORDER);
    this.selectedIndex = -1;
    this.trackEntity = null;

    this.timeBase = 0;
    this.currentTime = 0;
    this.timeMin = 0;
    this.timeMax = 1;

    this.pendingMs = 0;
    this.lastUpdate = -Infinity;

    this._scratchCartesian = new Cesium.Cartesian3();
    this._handler = this._bindPicking();

    // LOD depends on camera altitude, so a paused view must still re-evaluate
    // when the user zooms. Debounced to avoid recomputing on every frame of a
    // wheel gesture.
    this._cameraTimer = 0;
    this._onCameraChanged = () => {
      clearTimeout(this._cameraTimer);
      this._cameraTimer = setTimeout(() => {
        if (this.viewer && !this.viewer.isDestroyed()) this.update(0, true);
      }, 120);
    };
    this.viewer.camera.percentageChanged = 0.2;
    this.viewer.camera.changed.addEventListener(this._onCameraChanged);

    this.viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(70, 18, 24000000),
    });

    // Dev-only handle for automated inspection; stripped from production builds
    // by Vite's import.meta.env replacement.
    if (import.meta.env.DEV) window.__scene = this;
  }

  _addImagery() {
    // Bundled Natural Earth II. The shipped asset only contains levels 0-2, so
    // maximumLevel must be declared explicitly: without it Cesium requests
    // levels that do not exist at harbour zoom, the requests never settle, and
    // the whole globe stalls at the lowest level (which also blocks the online
    // layer from refining).
    Cesium.TileMapServiceImageryProvider.fromUrl(
      Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'),
      { maximumLevel: 2 },
    ).then((provider) => {
      if (!this.viewer.isDestroyed()) {
        // Index 0 so the coarse offline base never covers the online layer.
        this.viewer.imageryLayers.add(new Cesium.ImageryLayer(provider), 0);
      }
    }).catch((err) => {
      console.warn('[scene] Natural Earth imagery unavailable', err);
    });

    // Online tiles carry the coastline detail; without them the offline base
    // is far too coarse for harbour-level views. Failure is non-fatal.
    try {
      const tiles = new Cesium.UrlTemplateImageryProvider({
        url: TILE_URL,
        credit: new Cesium.Credit(TILE_CREDIT),
        maximumLevel: TILE_MAX_LEVEL,
      });
      this.viewer.imageryLayers.add(new Cesium.ImageryLayer(tiles));
    } catch (err) {
      console.warn('[scene] tile imagery unavailable', err);
    }
  }

  _bindPicking() {
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    handler.setInputAction((movement) => {
      const picked = this.viewer.scene.pick(movement.position);
      const index = picked?.primitive?.id;
      if (typeof index !== 'number' || !this.vessels[index]) {
        this.clearSelection();
        return;
      }
      this.select(index);
      this.onSelect?.(this.vessels[index], index);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    return handler;
  }

  /** Update cadence follows camera altitude: far views tolerate coarser updates. */
  _intervalMs() {
    const height = this.viewer.camera.positionCartographic.height;
    if (height > CAMERA_FAR_M) return UPDATE_INTERVAL_FAR_MS;
    if (height > CAMERA_MID_M) return UPDATE_INTERVAL_MID_MS;
    return UPDATE_INTERVAL_NEAR_MS;
  }

  /** Number of leading LOD buckets to draw at the current altitude. */
  _lodBucketCount() {
    const height = this.viewer.camera.positionCartographic.height;
    for (const level of LOD_LEVELS) {
      if (height < level.maxHeight) return level.buckets;
    }
    return 1;
  }

  _applyLodThreshold(next) {
    const prev = this.lodThreshold;
    if (next === prev) return;
    // Zooming out drops buckets; hide them explicitly, because the render loop
    // only visits the buckets that remain active.
    if (next < prev) {
      for (let b = next; b < prev; b += 1) {
        const bucket = this.lodBuckets[b];
        for (let j = 0; j < bucket.length; j += 1) {
          const billboard = this.billboardOf[bucket[j]];
          if (billboard.show) billboard.show = false;
        }
      }
    }
    this.lodThreshold = next;
  }

  load(dataset) {
    this.clearSelection({ silent: true });
    this.billboards.removeAll();
    this.billboardOf = [];
    this.positionOf = [];

    this.dataset = dataset;
    this.vessels = dataset.vessels;
    this.timeBase = dataset.timeBase;
    this.timeMin = dataset.timeMin;
    this.timeMax = dataset.timeMax;
    this.currentTime = dataset.timeMin;
    this.pendingMs = 0;
    this.lastUpdate = -Infinity;
    this.selectedIndex = -1;
    this.lodThreshold = -1;

    const fixCount = dataset.fixTime.length;

    // Pre-compute every fix in ECEF once. Per-frame work then reduces to a
    // three-component lerp instead of repeated trigonometric evaluation.
    const cart = new Float64Array(fixCount * 3);
    const scratch = this._scratchCartesian;
    for (let i = 0; i < fixCount; i += 1) {
      Cesium.Cartesian3.fromDegrees(
        dataset.fixLon[i], dataset.fixLat[i], ICON_ALTITUDE_M, undefined, scratch,
      );
      const p = i * 3;
      cart[p] = scratch.x;
      cart[p + 1] = scratch.y;
      cart[p + 2] = scratch.z;
    }
    this.cart = cart;
    this.staleState = new Uint8Array(this.vessels.length);

    this.lodBuckets = Array.from({ length: LOD_BUCKETS }, () => []);

    for (let i = 0; i < this.vessels.length; i += 1) {
      const v = this.vessels[i];
      const key = CATEGORY_ORDER[v.categoryId] || 'OTHER';
      const f = v.fixStart * 3;
      const position = new Cesium.Cartesian3(cart[f], cart[f + 1], cart[f + 2]);
      this.positionOf.push(position);

      this.billboardOf.push(this.billboards.add({
        id: i,
        position,
        image: VESSEL_ICON,
        width: ICON_SIZE,
        height: ICON_SIZE,
        color: NORMAL_COLORS[key],
        scaleByDistance: SCALE_BY_DISTANCE,
        show: false,
      }));

      const priority = LOD_CLASS_PRIORITY[key] ?? 3;
      const rank = priority * 16 + (hashMmsi(v.mmsi) & 15);
      this.lodBuckets[rank].push(i);
    }

    this.update(0, true);
  }

  setCategoryEnabled(key, enabled) {
    if (enabled) this.enabled.add(key);
    else this.enabled.delete(key);
    this.update(0, true);
  }

  isCategoryEnabled(key) {
    return this.enabled.has(key);
  }

  setTime(timeMs) {
    this.currentTime = Math.max(this.timeMin, Math.min(this.timeMax, timeMs));
    this.pendingMs = 0;
    this.update(0, true);
  }

  /**
   * Advance the clock and refresh marker state.
   *
   * deltaMs accumulates across frames so the update interval can be widened
   * (far camera, throttled tab) without slowing the replay: no time is lost
   * while calls are skipped.
   */
  update(deltaMs, force = false) {
    if (!this.dataset) return;

    if (!force) this.pendingMs += deltaMs;
    const now = performance.now();
    if (!force && now - this.lastUpdate < this._intervalMs()) return;
    this.lastUpdate = now;

    if (!force && this.pendingMs > 0) {
      this.currentTime = Math.min(this.timeMax, this.currentTime + this.pendingMs);
      this.pendingMs = 0;
    }

    const relT = (this.currentTime - this.timeBase) / 1000;
    const { fixTime, fixHeading, fixCog } = this.dataset;
    const { vessels, cart } = this;

    const threshold = this._lodBucketCount();
    this._applyLodThreshold(threshold);

    // Screen-up compensation: billboards face the camera, so a vessel's true
    // bearing must be offset by the camera's own heading.
    const camHeading = Number.isFinite(this.viewer.camera.heading)
      ? this.viewer.camera.heading
      : 0;

    for (let b = 0; b < threshold; b += 1) {
      const bucket = this.lodBuckets[b];
      for (let j = 0; j < bucket.length; j += 1) {
        const i = bucket[j];
        const v = vessels[i];
        const billboard = this.billboardOf[i];
        const key = CATEGORY_ORDER[v.categoryId] || 'OTHER';

        if (!this.enabled.has(key)) {
          if (billboard.show) billboard.show = false;
          continue;
        }

        const start = v.fixStart;
        const count = v.fixCount;
        const last = start + count - 1;

        if (relT < fixTime[start]) {
          if (billboard.show) billboard.show = false;
          continue;
        }

        // Counts are small (typically 1-5), so a linear scan beats binary search.
        let k = start;
        while (k < last && fixTime[k + 1] <= relT) k += 1;

        const sinceReportMs = (relT - fixTime[k]) * 1000;
        let stale = false;
        let x;
        let y;
        let z;

        if (k === last) {
          if (sinceReportMs > MAX_HOLD_MS) {
            if (billboard.show) billboard.show = false;
            continue;
          }
          stale = sinceReportMs > STALE_AFTER_MS;
          const p = last * 3;
          x = cart[p]; y = cart[p + 1]; z = cart[p + 2];
        } else {
          const gapMs = (fixTime[k + 1] - fixTime[k]) * 1000;
          if (gapMs > MAX_SEGMENT_GAP_MS) {
            // Track break: hold the last confirmed position and mark it stale
            // rather than drawing an interpolated line across the gap.
            stale = true;
            const p = k * 3;
            x = cart[p]; y = cart[p + 1]; z = cart[p + 2];
          } else {
            const alpha = (relT - fixTime[k]) / (fixTime[k + 1] - fixTime[k]);
            const a = k * 3;
            const c = a + 3;
            x = cart[a] + (cart[c] - cart[a]) * alpha;
            y = cart[a + 1] + (cart[c + 1] - cart[a + 1]) * alpha;
            z = cart[a + 2] + (cart[c + 2] - cart[a + 2]) * alpha;
            stale = sinceReportMs > STALE_AFTER_MS;
          }
        }

        const pos = this.positionOf[i];
        pos.x = x; pos.y = y; pos.z = z;
        // Assigning through the setter is required: it clones the value into
        // the primitive and flags it dirty. Mutating position in place would
        // silently skip the vertex buffer update.
        billboard.position = pos;

        // Heading is preferred; course over ground is the fallback for vessels
        // that do not transmit a gyro heading.
        const headingDeg = Number.isFinite(fixHeading[k])
          ? fixHeading[k]
          : (Number.isFinite(fixCog[k]) ? fixCog[k] : 0);
        const rotation = camHeading - Cesium.Math.toRadians(headingDeg);
        if (billboard.rotation !== rotation) billboard.rotation = rotation;

        if (!billboard.show) billboard.show = true;

        const staleFlag = stale ? 1 : 0;
        if (this.staleState[i] !== staleFlag) {
          this.staleState[i] = staleFlag;
          billboard.color = stale ? STALE_COLORS[key] : NORMAL_COLORS[key];
        }
      }
    }

    if (this.selectedIndex >= 0) {
      const billboard = this.billboardOf[this.selectedIndex];
      if (!billboard.show) this.clearSelection();
    }
  }

  select(index) {
    if (this.selectedIndex === index) return;
    this.clearSelection({ silent: true });

    const v = this.vessels[index];
    if (!v) return;

    this.selectedIndex = index;
    const billboard = this.billboardOf[index];
    const key = CATEGORY_ORDER[v.categoryId] || 'OTHER';
    billboard.scale = ICON_SELECTED_SCALE;
    billboard.color = SELECTED_COLOR;

    if (v.fixCount > 1) {
      this.trackEntity = this.viewer.entities.add({
        polyline: {
          positions: this._trackPositions(v),
          width: 2.5,
          material: Cesium.Color.fromCssColorString(CATEGORIES[key].color).withAlpha(0.9),
          clampToGround: false,
        },
      });
    }
  }

  _trackPositions(v) {
    const step = Math.max(1, Math.ceil(v.fixCount / TRACK_MAX_POINTS));
    const positions = [];
    for (let k = 0; k < v.fixCount; k += step) {
      const i = v.fixStart + k;
      positions.push(Cesium.Cartesian3.fromDegrees(
        this.dataset.fixLon[i], this.dataset.fixLat[i], ICON_ALTITUDE_M,
      ));
    }
    const lastIndex = v.fixStart + v.fixCount - 1;
    if ((v.fixCount - 1) % step !== 0) {
      positions.push(Cesium.Cartesian3.fromDegrees(
        this.dataset.fixLon[lastIndex], this.dataset.fixLat[lastIndex], ICON_ALTITUDE_M,
      ));
    }
    return positions;
  }

  clearSelection({ silent = false } = {}) {
    if (this.selectedIndex >= 0) {
      const v = this.vessels[this.selectedIndex];
      const billboard = this.billboardOf[this.selectedIndex];
      if (billboard && v) {
        const key = CATEGORY_ORDER[v.categoryId] || 'OTHER';
        billboard.scale = 1;
        billboard.color = this.staleState?.[this.selectedIndex]
          ? STALE_COLORS[key]
          : NORMAL_COLORS[key];
      }
    }
    this.selectedIndex = -1;
    if (this.trackEntity) {
      this.viewer.entities.remove(this.trackEntity);
      this.trackEntity = null;
    }
    if (!silent) this.onSelect?.(null, -1);
  }

  /**
   * Interpolated state of a vessel at the current clock, for the info panel.
   * Returns null when the vessel is not currently visible.
   */
  snapshot(vessel) {
    if (!vessel || !this.dataset) return null;
    const relT = (this.currentTime - this.timeBase) / 1000;
    const start = vessel.fixStart;
    const last = start + vessel.fixCount - 1;
    if (relT < this.dataset.fixTime[start]) return null;

    let k = start;
    while (k < last && this.dataset.fixTime[k + 1] <= relT) k += 1;

    const { fixTime, fixLon, fixLat, fixSog, fixCog, fixHeading, fixNav } = this.dataset;
    const sinceReportMs = (relT - fixTime[k]) * 1000;

    if (k === last && sinceReportMs > MAX_HOLD_MS) return null;

    let lon = fixLon[k];
    let lat = fixLat[k];
    let stale = sinceReportMs > STALE_AFTER_MS;

    if (k < last) {
      const gapMs = (fixTime[k + 1] - fixTime[k]) * 1000;
      if (gapMs <= MAX_SEGMENT_GAP_MS) {
        const alpha = (relT - fixTime[k]) / (fixTime[k + 1] - fixTime[k]);
        lon += (fixLon[k + 1] - lon) * alpha;
        lat += (fixLat[k + 1] - lat) * alpha;
      } else {
        stale = true;
      }
    }

    return {
      time: this.timeBase + fixTime[k] * 1000,
      lon,
      lat,
      sog: fixSog[k],
      cog: fixCog[k],
      heading: fixHeading[k],
      nav: fixNav[k],
      stale,
      reports: vessel.fixCount,
    };
  }

  /** Fly to a vessel only when the current view is too far to resolve it. */
  revealVessel(index) {
    const billboard = this.billboardOf[index];
    if (!billboard) return;
    const height = this.viewer.camera.positionCartographic.height;
    if (height < 2_000_000) return;

    const carto = Cesium.Cartographic.fromCartesian(billboard.position);
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 180_000),
      duration: 1.2,
    });
  }

  /** Diagnostics used by the runtime checks; cheap enough to keep around. */
  stats() {
    let visible = 0;
    for (let i = 0; i < this.billboardOf.length; i += 1) {
      if (this.billboardOf[i].show) visible += 1;
    }
    return {
      total: this.billboardOf.length,
      visible,
      threshold: this.lodThreshold,
      imageryLayers: this.viewer.imageryLayers.length,
      cameraHeight: Math.round(this.viewer.camera.positionCartographic.height),
    };
  }

  destroy() {
    clearTimeout(this._cameraTimer);
    this.viewer?.camera.changed.removeEventListener(this._onCameraChanged);
    this._handler?.destroy();
    this._handler = null;
    if (this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.destroy();
    }
    this.viewer = null;
    this.dataset = null;
    this.vessels = [];
    this.billboardOf = [];
  }
}
