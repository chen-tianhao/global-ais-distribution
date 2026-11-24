import * as Cesium from 'cesium';
import { CATEGORIES, categorize, POINT_SIZE, POINT_SIZE_SELECTED, MAX_GAP_MS } from './config.js';

// Cesium Viewer works without an ion token as long as we never request ion assets.
Cesium.Ion.defaultAccessToken = '';

const COLOR_CACHE = {};
for (const [key, cat] of Object.entries(CATEGORIES)) {
  COLOR_CACHE[key] = Cesium.Color.fromCssColorString(cat.color).withAlpha(0.85);
}
const SELECTED_COLOR = Cesium.Color.fromCssColorString('#FFFFFF');
const scratchCart = new Cesium.Cartesian3();

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

    this.viewer.scene.globe.enableLighting = false;
    this.viewer.scene.sun.show = false;
    this.viewer.scene.moon.show = false;
    this.viewer.scene.skyAtmosphere.show = true;
    this.viewer.scene.screenSpaceCameraController.minimumZoomDistance = 200000;

    this._addImagery();

    this.points = this.viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    this.vessels = [];
    this.byMmsi = new Map();
    this.enabled = new Set(Object.keys(CATEGORIES));
    this.selectedIndex = -1;
    this.trackEntity = null;
    this.currentTime = 0;
    this.timeMin = 0;
    this.timeMax = 1;
    this.lastUpdate = 0;

    this._bindPicking();
    this.viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(70, 18, 24000000),
    });
  }

  async _addImagery() {
    // Offline bundled Natural Earth II as a token-free fallback base.
    try {
      const neUrl = Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII');
      const ne = new Cesium.TileMapServiceImageryProvider({ url: neUrl });
      this.viewer.imageryLayers.add(new Cesium.ImageryLayer(ne));
    } catch (e) {
      console.warn('Natural Earth imagery unavailable', e);
    }
    // Online OSM tiles on top for readable coastlines. Failure is non-fatal.
    try {
      const osm = new Cesium.UrlTemplateImageryProvider({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        credit: new Cesium.Credit('© OpenStreetMap contributors'),
        maximumLevel: 18,
      });
      this.viewer.imageryLayers.add(new Cesium.ImageryLayer(osm));
    } catch (e) {
      console.warn('OSM imagery unavailable', e);
    }
  }

  _bindPicking() {
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    handler.setInputAction((movement) => {
      const picked = this.viewer.scene.pick(movement.position);
      if (!Cesium.defined(picked) || !Cesium.defined(picked.primitive)) {
        this.clearSelection();
        return;
      }
      const idx = picked.primitive.id;
      if (typeof idx !== 'number' || !this.vessels[idx]) {
        this.clearSelection();
        return;
      }
      this.select(idx);
      this.onSelect?.(this.vessels[idx], movement.position);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  load(vessels, timeMin, timeMax) {
    this.points.removeAll();
    this.vessels = vessels;
    this.byMmsi = new Map(vessels.map((v, i) => [v.mmsi, i]));
    this.timeMin = timeMin;
    this.timeMax = timeMax;
    this.currentTime = timeMin;
    this.selectedIndex = -1;

    vessels.forEach((v, i) => {
      v.category = categorize(v.type).key;
      const f = v.fixes[0];
      Cesium.Cartesian3.fromDegrees(f[1], f[2], 0, undefined, scratchCart);
      v.point = this.points.add({
        id: i,
        position: Cesium.Cartesian3.clone(scratchCart),
        color: COLOR_CACHE[v.category],
        pixelSize: POINT_SIZE,
        outlineColor: Cesium.Color.fromCssColorString('#0B1622'),
        outlineWidth: 1,
        show: false,
      });
    });
    this.update(0, true);
  }

  setCategoryEnabled(key, enabled) {
    if (enabled) this.enabled.add(key);
    else this.enabled.delete(key);
    this.update(0, true);
  }

  setTime(t) {
    this.currentTime = Math.max(this.timeMin, Math.min(this.timeMax, t));
    this.update(0, true);
  }

  update(deltaMs, force = false) {
    const now = performance.now();
    if (!force && now - this.lastUpdate < 90) return;
    this.lastUpdate = now;
    if (!force) this.currentTime = Math.min(this.timeMax, this.currentTime + deltaMs);

    const t = this.currentTime;
    for (let i = 0; i < this.vessels.length; i += 1) {
      const v = this.vessels[i];
      const showCat = this.enabled.has(v.category);
      const fixes = v.fixes;
      let lon;
      let lat;
      let visible = false;

      if (showCat && t >= fixes[0][0]) {
        // Find the segment containing t (fix arrays are tiny: usually 1-5 items).
        let k = 0;
        while (k < fixes.length - 1 && fixes[k + 1][0] <= t) k += 1;
        const a = fixes[k];
        if (k === fixes.length - 1) {
          // Hold the last known position, but expire very stale vessels.
          visible = t - a[0] <= MAX_GAP_MS;
          lon = a[1];
          lat = a[2];
        } else {
          const b = fixes[k + 1];
          if (b[0] - a[0] <= MAX_GAP_MS) {
            const alpha = (t - a[0]) / (b[0] - a[0]);
            lon = a[1] + (b[1] - a[1]) * alpha;
            lat = a[2] + (b[2] - a[2]) * alpha;
          } else {
            lon = a[1];
            lat = a[2];
          }
          visible = true;
        }
      }

      v.point.show = visible;
      if (visible) {
        Cesium.Cartesian3.fromDegrees(lon, lat, 0, undefined, scratchCart);
        Cesium.Cartesian3.clone(scratchCart, v.point.position);
      }
    }

    if (this.selectedIndex >= 0) {
      const v = this.vessels[this.selectedIndex];
      if (!v.point.show) this.clearSelection();
    }
  }

  select(index) {
    if (this.selectedIndex === index) return;
    if (this.selectedIndex >= 0) {
      const prev = this.vessels[this.selectedIndex];
      prev.point.pixelSize = POINT_SIZE;
      prev.point.color = COLOR_CACHE[prev.category];
    }
    this.selectedIndex = index;
    const v = this.vessels[index];
    v.point.pixelSize = POINT_SIZE_SELECTED;
    v.point.color = SELECTED_COLOR;

    if (this.trackEntity) {
      this.viewer.entities.remove(this.trackEntity);
      this.trackEntity = null;
    }
    if (v.fixes.length > 1) {
      const positions = v.fixes.map((f) => Cesium.Cartesian3.fromDegrees(f[1], f[2], 300));
      this.trackEntity = this.viewer.entities.add({
        polyline: {
          positions,
          width: 2.5,
          material: Cesium.Color.fromCssColorString(CATEGORIES[v.category].color).withAlpha(0.9),
          clampToGround: false,
        },
      });
    }
  }

  clearSelection() {
    if (this.selectedIndex >= 0) {
      const v = this.vessels[this.selectedIndex];
      v.point.pixelSize = POINT_SIZE;
      v.point.color = COLOR_CACHE[v.category];
    }
    this.selectedIndex = -1;
    if (this.trackEntity) {
      this.viewer.entities.remove(this.trackEntity);
      this.trackEntity = null;
    }
    this.onSelect?.(null);
  }

  getCurrentFix(v) {
    const t = this.currentTime;
    const fixes = v.fixes;
    let k = 0;
    while (k < fixes.length - 1 && fixes[k + 1][0] <= t) k += 1;
    return fixes[k];
  }
}
