// Application orchestration: data loading, clock, controls and info panel.

import { CATEGORIES, CATEGORY_ORDER } from './config.js';
import { t, setLang, getLang, formatTime, formatDate } from './i18n.js';
import { VoyageScene } from './scene.js';
import { loadDataset } from './data/loader.js';
import { VesselPopup } from './ui/popup.js';

const $ = (id) => document.getElementById(id);
const SPEEDS = [30, 60, 120, 300];
const STEP_MS = 30000;

const state = {
  scene: null,
  dataset: null,
  popup: null,
  playing: false,
  speed: 60,
  lastFrame: 0,
  selectedIndex: -1,
  selectedVessel: null,
  scrubbing: false,
  resumeAfterScrub: false,
  seekFraction: null,
  categoryTotals: {},
  mmsiIndex: new Map(),
  pendingTime: null,
  pendingMmsi: null,
  uiBound: false,
  urlTimer: 0,
};

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

function setLoading(title, detail) {
  $('loadingTitle').textContent = title ?? t('loadingTitle');
  $('loadingDetail').textContent = detail ?? '';
}

function showError(message) {
  $('loading').classList.add('hidden');
  $('errorText').textContent = message;
  $('errorBanner').classList.remove('hidden');
}

function hideError() {
  $('errorBanner').classList.add('hidden');
}

function updatePlayButton() {
  const scene = state.scene;
  const atEnd = scene ? scene.currentTime >= scene.timeMax : false;
  const icon = state.playing ? 'icon-pause' : (atEnd ? 'icon-replay' : 'icon-play');
  if ($('playIcon').className !== icon) $('playIcon').className = icon;

  const label = state.playing
    ? t('pause')
    : (atEnd ? t('replay') : t('play'));
  $('playBtn').title = label;
  $('playBtn').setAttribute('aria-label', label);
  $('resetBtn').title = t('restart');
}

function updateStats() {
  const dataset = state.dataset;
  if (!dataset) return;
  let visible = 0;
  for (const key of CATEGORY_ORDER) {
    if (state.scene?.isCategoryEnabled(key)) {
      visible += state.categoryTotals[key] || 0;
    }
  }
  $('statVessels').textContent = `${visible.toLocaleString()} / ${dataset.vessels.length.toLocaleString()}`;
  $('labelVessels').textContent = t('vessels');
  $('statReports').textContent = dataset.stats.reportCount.toLocaleString();
  $('labelReports').textContent = t('positionReports');
}

function buildLegend() {
  const body = $('legendBody');
  body.textContent = '';
  const lang = getLang();

  for (const key of CATEGORY_ORDER) {
    const cat = CATEGORIES[key];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'legend-row';
    row.dataset.key = key;

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = cat.color;

    const name = document.createElement('span');
    name.className = 'legend-name';
    name.textContent = lang === 'zh' ? cat.zh : cat.en;

    const count = document.createElement('span');
    count.className = 'legend-count';
    count.textContent = (state.categoryTotals[key] || 0).toLocaleString();

    row.append(swatch, name, count);
    row.addEventListener('click', () => {
      const enabled = !state.scene.isCategoryEnabled(key);
      state.scene.setCategoryEnabled(key, enabled);
      row.classList.toggle('off', !enabled);
      row.setAttribute('aria-pressed', String(enabled));
      updateStats();
    });
    row.setAttribute('aria-pressed', 'true');
    body.appendChild(row);
  }
}

function setLegendCollapsed(collapsed) {
  $('legendBody').classList.toggle('hidden', collapsed);
  $('legendHint').classList.toggle('hidden', collapsed);
  $('staleHint').classList.toggle('hidden', collapsed);
  $('lodHint').classList.toggle('hidden', collapsed);
  $('legendToggle').textContent = collapsed ? '+' : '−';
  $('legendToggle').title = collapsed ? t('expand') : t('collapse');
  $('legendToggle').setAttribute('aria-expanded', String(!collapsed));
}

function updateTicks() {
  const dataset = state.dataset;
  const ticks = $('ticks');
  if (!dataset || !ticks) return;
  const span = dataset.timeMax - dataset.timeMin;
  const cells = ticks.children;
  for (let i = 0; i < cells.length; i += 1) {
    const ms = dataset.timeMin + (span * i) / Math.max(1, cells.length - 1);
    cells[i].textContent = formatTime(ms);
  }
}

function applyLanguage() {
  const lang = getLang();
  document.documentElement.lang = lang;

  $('appTitle').textContent = t('appTitle');
  $('appSubtitle').textContent = state.dataset
    ? t('appSubtitle', formatDate(state.dataset.timeMin))
    : '';
  $('langBtn').textContent = lang === 'en' ? '中文' : 'EN';
  $('langBtn').title = t('switchLang');
  $('legendTitle').textContent = t('legendTitle');
  $('legendHint').textContent = t('legendHint');
  $('staleHint').textContent = t('staleHint');
  $('lodHint').textContent = t('lodHint');
  $('keyboardHint').textContent = t('keyboardHint');
  $('labelSpeed').textContent = t('speed');
  $('labelReset').textContent = t('restart');
  $('retryBtn').textContent = t('retry');
  $('loadingTitle').textContent = t('loadingTitle');

  for (const row of $('legendBody').children) {
    const cat = CATEGORIES[row.dataset.key];
    const name = row.querySelector('.legend-name');
    if (cat && name) name.textContent = lang === 'zh' ? cat.zh : cat.en;
  }

  state.popup?.relabel();
  updatePlayButton();
  updateStats();
  updateTicks();
}

// ---------------------------------------------------------------------------
// Clock and transport
// ---------------------------------------------------------------------------

function updateTimeUI() {
  const scene = state.scene;
  if (!scene) return;
  const span = scene.timeMax - scene.timeMin;
  const fraction = span > 0 ? (scene.currentTime - scene.timeMin) / span : 0;
  if (!state.scrubbing) {
    $('timeSlider').value = String(Math.round(Math.min(1, Math.max(0, fraction)) * 1000));
  }
  $('currentTime').textContent = formatTime(scene.currentTime);
  updatePlayButton();
}

function refreshPopup() {
  if (!state.selectedVessel || !state.scene) return;
  state.popup?.update(
    state.selectedVessel,
    state.scene.snapshot(state.selectedVessel),
  );
}

function setPlaying(on) {
  state.playing = Boolean(on) && Boolean(state.scene);
  state.lastFrame = performance.now();
  updatePlayButton();
}

function togglePlay() {
  const scene = state.scene;
  if (!scene) return;
  if (scene.currentTime >= scene.timeMax) {
    scene.setTime(scene.timeMin);
    updateTimeUI();
    scheduleUrlSync();
  }
  setPlaying(!state.playing);
}

function step(deltaMs) {
  const scene = state.scene;
  if (!scene) return;
  scene.setTime(scene.currentTime + deltaMs);
  updateTimeUI();
  refreshPopup();
  scheduleUrlSync();
}

function animate(now) {
  requestAnimationFrame(animate);
  const elapsed = now - state.lastFrame;
  state.lastFrame = now;

  const scene = state.scene;
  if (!scene) return;

  // Scrub seeks are coalesced to one scene update per frame: a range input
  // fires on every pixel, and each update walks all vessels.
  if (state.seekFraction !== null) {
    const fraction = state.seekFraction;
    state.seekFraction = null;
    scene.setTime(scene.timeMin + fraction * (scene.timeMax - scene.timeMin));
    $('currentTime').textContent = formatTime(scene.currentTime);
    refreshPopup();
  }

  if (!state.playing || state.scrubbing) return;

  scene.update(Math.min(elapsed, 250) * state.speed);
  updateTimeUI();
  if (state.selectedVessel) refreshPopup();

  if (scene.currentTime >= scene.timeMax) {
    setPlaying(false);
    updatePlayButton();
    scheduleUrlSync();
  }
}

// ---------------------------------------------------------------------------
// Selection and URL state
// ---------------------------------------------------------------------------

function selectIndex(index, { reveal = false } = {}) {
  const scene = state.scene;
  if (!scene || index < 0 || index >= scene.vessels.length) return;
  const vessel = scene.vessels[index];
  scene.select(index);
  state.selectedIndex = index;
  state.selectedVessel = vessel;
  state.popup?.show(vessel, scene.snapshot(vessel));
  if (reveal) scene.revealVessel(index);
  scheduleUrlSync();
}

function clearSelection() {
  state.scene?.clearSelection();
}

function syncUrl() {
  const scene = state.scene;
  if (!scene) return;
  const params = new URLSearchParams();
  params.set('t', new Date(Math.round(scene.currentTime / 1000) * 1000).toISOString());
  if (state.selectedVessel) params.set('mmsi', state.selectedVessel.mmsi);
  if (getLang() === 'zh') params.set('lang', 'zh');
  if (state.speed !== 60) params.set('speed', String(state.speed));
  const url = `${location.pathname}?${params.toString()}`;
  history.replaceState(null, '', url);
}

function scheduleUrlSync() {
  clearTimeout(state.urlTimer);
  state.urlTimer = setTimeout(syncUrl, 400);
}

function readUrlState() {
  const params = new URLSearchParams(location.search);

  const lang = params.get('lang');
  if (lang === 'zh' || lang === 'en') setLang(lang);

  const speed = Number(params.get('speed'));
  if (SPEEDS.includes(speed)) {
    state.speed = speed;
    $('speedSelect').value = String(speed);
  }

  const time = params.get('t');
  if (time) {
    const ms = Date.parse(time);
    if (Number.isFinite(ms)) state.pendingTime = ms;
  }

  const mmsi = params.get('mmsi');
  if (mmsi) state.pendingMmsi = mmsi;
}

function applyUrlState() {
  const scene = state.scene;
  if (!scene) return;

  if (state.pendingTime !== null) {
    scene.setTime(state.pendingTime);
    state.pendingTime = null;
  }

  if (state.pendingMmsi) {
    const index = state.mmsiIndex.get(state.pendingMmsi);
    state.pendingMmsi = null;
    if (index !== undefined) selectIndex(index, { reveal: true });
  }

  updateTimeUI();
  refreshPopup();
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function describeProgress(p) {
  if (p.phase === 'manifest') return t('phaseManifest');
  if (p.phase === 'decode') return t('phaseDecode');

  const name = p.name ? `${p.name} · ` : '';
  if (p.phase === 'parse') {
    return `${t('phaseParse')} ${name}${t('phaseRows', (p.parsed ?? 0).toLocaleString())}`;
  }
  if (p.phase === 'download') {
    const loadedMb = ((p.loaded ?? 0) / 1048576).toFixed(1);
    // Only show a total when the server reported one that is still consistent
    // with the bytes received; a stale or missing length would otherwise render
    // impossible values such as "8.0 / 7.1 MB".
    if (p.totalBytes && p.totalBytes >= (p.loaded ?? 0)) {
      return `${t('phaseDownload')} ${name}${t('phaseBytes', loadedMb, (p.totalBytes / 1048576).toFixed(1))}`;
    }
    return `${t('phaseDownload')} ${name}${loadedMb} MB`;
  }
  return '';
}

function onLoadProgress(p) {
  setLoading(t('loadingTitle'), describeProgress(p));
}

function teardownScene() {
  if (state.scene) {
    state.scene.destroy();
    state.scene = null;
  }
  state.selectedIndex = -1;
  state.selectedVessel = null;
  state.popup?.hide();
}

function initScene(dataset) {
  teardownScene();

  const scene = new VoyageScene('cesiumContainer');
  state.scene = scene;
  scene.load(dataset);

  scene.onSelect = (vessel, index) => {
    if (!vessel) {
      state.selectedIndex = -1;
      state.selectedVessel = null;
      state.popup?.hide();
      return;
    }
    state.selectedIndex = index;
    state.selectedVessel = vessel;
    state.popup?.show(vessel, scene.snapshot(vessel));
    scene.revealVessel(index);
    scheduleUrlSync();
  };
}

async function boot() {
  hideError();
  $('loading').classList.remove('hidden');
  setLoading(t('loadingTitle'), t('phaseManifest'));

  try {
    const dataset = await loadDataset({ onProgress: onLoadProgress });
    state.dataset = dataset;

    state.categoryTotals = {};
    for (const v of dataset.vessels) {
      const key = CATEGORY_ORDER[v.categoryId] || 'OTHER';
      state.categoryTotals[key] = (state.categoryTotals[key] || 0) + 1;
    }
    state.mmsiIndex = new Map(dataset.vessels.map((v, i) => [v.mmsi, i]));

    initScene(dataset);
    buildLegend();
    applyLanguage();

    $('startTime').textContent = formatTime(dataset.timeMin);
    $('endTime').textContent = formatTime(dataset.timeMax);
    $('currentTime').textContent = formatTime(dataset.timeMin);

    applyUrlState();
    updateTimeUI();
    updateStats();
    updateTicks();

    $('loading').classList.add('hidden');
    state.lastFrame = performance.now();

    const source = dataset.source === 'binary' ? t('sourceBinary') : t('sourceCsv');
    if (import.meta.env.DEV) {
      console.info(
        `[data] ${t('loadSummary', dataset.vessels.length, dataset.stats.reportCount)}`
        + ` · ${source}`
        + (dataset.stats.skipped ? ` · skipped ${dataset.stats.skipped}` : '')
        + (dataset.stats.invalidImo ? ` · invalid IMO ${dataset.stats.invalidImo}` : ''),
      );
    }
  } catch (err) {
    console.error(err);
    showError(`${t('errorTitle')}: ${err?.message ?? err}`);
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function bindUI() {
  if (state.uiBound) return;
  state.uiBound = true;

  $('playBtn').addEventListener('click', togglePlay);

  $('resetBtn').addEventListener('click', () => {
    const scene = state.scene;
    if (!scene) return;
    scene.setTime(scene.timeMin);
    updateTimeUI();
    refreshPopup();
    setPlaying(false);
    scheduleUrlSync();
  });

  const slider = $('timeSlider');

  slider.addEventListener('pointerdown', (event) => {
    if (!state.scene) return;
    state.resumeAfterScrub = state.playing;
    state.scrubbing = true;
    setPlaying(false);
    // Capture the pointer so releasing outside the track still ends the scrub.
    try { slider.setPointerCapture(event.pointerId); } catch { /* unsupported */ }
  });

  const endScrub = () => {
    if (!state.scrubbing) return;
    state.scrubbing = false;
    // Re-seed the clock so the frame elapsed during the drag is not replayed.
    state.lastFrame = performance.now();
    if (state.resumeAfterScrub) setPlaying(true);
    state.resumeAfterScrub = false;
    scheduleUrlSync();
  };
  slider.addEventListener('pointerup', endScrub);
  slider.addEventListener('pointercancel', endScrub);
  slider.addEventListener('blur', endScrub);

  slider.addEventListener('input', (event) => {
    const scene = state.scene;
    if (!scene) return;
    state.seekFraction = Number(event.target.value) / 1000;
    $('currentTime').textContent = formatTime(
      scene.timeMin + state.seekFraction * (scene.timeMax - scene.timeMin),
    );
  });

  $('speedSelect').addEventListener('change', (event) => {
    state.speed = Number(event.target.value) || 60;
    scheduleUrlSync();
  });

  $('langBtn').addEventListener('click', () => {
    setLang(getLang() === 'en' ? 'zh' : 'en');
    applyLanguage();
    scheduleUrlSync();
  });

  $('popupClose').addEventListener('click', clearSelection);

  $('legendToggle').addEventListener('click', () => {
    const expanded = $('legendBody').classList.contains('hidden');
    setLegendCollapsed(!expanded);
  });

  $('retryBtn').addEventListener('click', () => {
    boot();
  });

  window.addEventListener('keydown', (event) => {
    const tag = event.target?.tagName;
    // Buttons keep their native Space activation; inputs keep their own keys.
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;

    if (event.code === 'Space') {
      event.preventDefault();
      togglePlay();
    } else if (event.code === 'ArrowLeft') {
      event.preventDefault();
      step(-STEP_MS);
    } else if (event.code === 'ArrowRight') {
      event.preventDefault();
      step(STEP_MS);
    } else if (event.code === 'Escape') {
      clearSelection();
    }
  });

  requestAnimationFrame(animate);
}

function init() {
  state.popup = new VesselPopup({
    root: $('popup'),
    nameEl: $('popupName'),
    mmsiEl: $('popupMmsi'),
    bodyEl: $('popupBody'),
    noteEl: $('popupTrackNote'),
    closeBtn: $('popupClose'),
  }, { onClose: clearSelection });

  readUrlState();
  bindUI();
  applyLanguage();
  // On narrow screens the expanded legend covers most of the globe.
  if (window.innerWidth <= 900) setLegendCollapsed(true);
  window.addEventListener('resize', () => updateTimeUI());

  boot();
}

// Vite HMR: a Viewer cannot be constructed twice into the same container, so
// the previous instance must be destroyed before the module is replaced.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    state.scene?.destroy();
    state.scene = null;
  });
}

init();
