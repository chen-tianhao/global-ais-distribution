import { CSV_FILES, CATEGORIES, CATEGORY_ORDER, categorize } from './config.js';
import { t, setLang, getLang } from './i18n.js';
import { VoyageScene } from './scene.js';

const $ = (id) => document.getElementById(id);

const state = {
  scene: null,
  playing: false,
  speed: 60,
  lastFrame: 0,
  selected: null,
};
const categoryCounts = {};

function setLoading(detail) {
  $('loadingDetail').textContent = detail;
}

function showError(msg) {
  $('loading').classList.add('hidden');
  $('errorBanner').textContent = msg;
  $('errorBanner').classList.remove('hidden');
}

async function fetchText(name) {
  const res = await fetch(`/data/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseInWorker(text, label) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parseWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') {
        setLoading(`${t('parseDetail', label === 'A' ? 1 : 2, CSV_FILES.length)} · ${m.parsed.toLocaleString()}`);
      } else if (m.type === 'done') {
        worker.terminate();
        resolve(m.vessels);
      } else if (m.type === 'error') {
        worker.terminate();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (err) => { worker.terminate(); reject(err); };
    worker.postMessage({ text, label });
  });
}

function mergeVessels(groups) {
  const map = new Map();
  for (const list of groups) {
    for (const v of list) {
      if (!map.has(v.mmsi)) {
        map.set(v.mmsi, v);
        continue;
      }
      const existing = map.get(v.mmsi);
      for (const f of v.fixes) existing.fixes.push(f);
      if (!existing.name && v.name) existing.name = v.name;
      if (!existing.type && v.type) existing.type = v.type;
      if (!existing.flag && v.flag) existing.flag = v.flag;
      if (!existing.dest && v.dest) existing.dest = v.dest;
      if (!Number.isFinite(existing.length)) existing.length = v.length;
      if (!Number.isFinite(existing.width)) existing.width = v.width;
    }
  }
  const all = [...map.values()];
  for (const v of all) {
    v.fixes.sort((a, b) => a[0] - b[0]);
    const deduped = [];
    for (const f of v.fixes) {
      if (!deduped.length || f[0] !== deduped[deduped.length - 1][0]) deduped.push(f);
    }
    v.fixes = deduped;
    const key = categorize(v.type).key;
    categoryCounts[key] = (categoryCounts[key] || 0) + 1;
  }
  all.sort((a, b) => a.fixes[0][0] - b.fixes[0][0]);
  return all;
}

function fmtTime(ms) {
  const d = new Date(ms);
  return d.toISOString().slice(11, 19);
}

function fmtDate(ms) {
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}

function buildLegend() {
  const body = $('legendBody');
  body.innerHTML = '';
  for (const key of CATEGORY_ORDER) {
    const cat = CATEGORIES[key];
    const count = categoryCounts[key] || 0;
    const row = document.createElement('button');
    row.className = 'legend-row';
    row.dataset.key = key;
    row.innerHTML = `<span class="swatch" style="background:${cat.color}"></span>
      <span class="legend-name">${cat.en}</span>
      <span class="legend-count">${count.toLocaleString()}</span>`;
    row.addEventListener('click', () => {
      const enabled = !state.scene.enabled.has(key);
      state.scene.setCategoryEnabled(key, enabled);
      row.classList.toggle('off', !enabled);
    });
    body.appendChild(row);
  }
}

function popupRow(label, value, unit = '') {
  if (value === '' || value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return '';
  return `<div class="popup-row"><span class="k">${label}</span><span class="v">${value}${unit}</span></div>`;
}

function showPopup(vessel) {
  const popup = $('popup');
  if (!vessel) { popup.classList.add('hidden'); state.selected = null; return; }
  state.selected = vessel;
  const fix = state.scene.getCurrentFix(vessel);
  const cat = CATEGORIES[vessel.category];
  const lang = getLang();

  $('popupName').textContent = vessel.name || t('infoMmsi') + ' ' + vessel.mmsi;
  $('popupMmsi').textContent = `${t('infoMmsi')} ${vessel.mmsi}`;
  const dims = [vessel.length, vessel.width]
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Number(n.toFixed(1))).join(' × ');

  $('popupBody').innerHTML = [
    popupRow(t('infoType'), lang === 'zh' ? cat.zh : cat.en),
    popupRow(t('infoImo'), vessel.imo),
    popupRow(t('infoCallSign'), vessel.callsign),
    popupRow(t('infoFlag'), vessel.flag),
    popupRow(t('infoDestination'), vessel.dest),
    dims ? popupRow(t('infoLength'), dims, ` ${t('unitMeters')}`) : '',
    popupRow(t('infoSog'), Number.isFinite(fix[3]) ? fix[3].toFixed(1) : '', ` ${t('unitKnots')}`),
    popupRow(t('infoCog'), Number.isFinite(fix[4]) ? fix[4].toFixed(1) : '', t('unitDegrees')),
    popupRow(t('infoHeading'), Number.isFinite(fix[5]) ? fix[5].toFixed(0) : '', t('unitDegrees')),
    popupRow(t('infoNav'), fix[6]),
    popupRow(t('infoPosition'), `${fix[2].toFixed(4)}°, ${fix[1].toFixed(4)}°`),
    popupRow(t('infoLastFix'), fmtTime(fix[0])),
    popupRow(t('infoReports'), vessel.fixes.length),
  ].join('');
  $('popupTrackNote').textContent = vessel.fixes.length > 1
    ? t('trackHint') : t('clickHint');
  popup.classList.remove('hidden');
}

function applyLanguage() {
  const lang = getLang();
  document.documentElement.lang = lang;
  $('appTitle').textContent = t('appTitle');
  $('appSubtitle').textContent = t('appSubtitle');
  $('labelVessels').textContent = t('vessels');
  $('labelReports').textContent = t('positionReports');
  $('langBtn').textContent = lang === 'en' ? '中文' : 'EN';
  $('langBtn').title = t('switchLang');
  $('legendTitle').textContent = t('legendTitle');
  $('legendHint').textContent = t('legendHint');
  $('labelSpeed').textContent = t('speed');
  $('labelReset').textContent = t('restart');
  $('playBtn').title = state.playing ? t('pause') : t('play');
  $('resetBtn').title = t('restart');
  $('legendToggle').title = $('legendBody').classList.contains('hidden') ? t('expand') : t('collapse');

  for (const row of $('legendBody').children) {
    const cat = CATEGORIES[row.dataset.key];
    row.querySelector('.legend-name').textContent = lang === 'zh' ? cat.zh : cat.en;
  }
  if (state.selected) showPopup(state.selected);
}

function setPlaying(on) {
  state.playing = on;
  $('playIcon').className = on ? 'icon-pause' : 'icon-play';
  $('playBtn').title = on ? t('pause') : t('play');
  state.lastFrame = performance.now();
}

function animate(now) {
  requestAnimationFrame(animate);
  if (!state.playing || !state.scene) return;
  const dt = Math.min(now - state.lastFrame, 250);
  state.lastFrame = now;
  const s = state.scene;
  s.update(dt * state.speed);
  $('timeSlider').value = Math.round(((s.currentTime - s.timeMin) / (s.timeMax - s.timeMin)) * 1000);
  $('currentTime').textContent = fmtTime(s.currentTime);
  if (state.selected) showPopup(state.selected);
  if (s.currentTime >= s.timeMax) setPlaying(false);
}

function bindUI() {
  $('playBtn').addEventListener('click', () => {
    if (!state.scene) return;
    if (state.scene.currentTime >= state.scene.timeMax) state.scene.setTime(state.scene.timeMin);
    setPlaying(!state.playing);
  });
  $('resetBtn').addEventListener('click', () => {
    if (!state.scene) return;
    state.scene.setTime(state.scene.timeMin);
    $('timeSlider').value = 0;
    $('currentTime').textContent = fmtTime(state.scene.timeMin);
    setPlaying(false);
  });
  $('timeSlider').addEventListener('input', (e) => {
    if (!state.scene) return;
    const f = Number(e.target.value) / 1000;
    state.scene.setTime(state.scene.timeMin + f * (state.scene.timeMax - state.scene.timeMin));
    $('currentTime').textContent = fmtTime(state.scene.currentTime);
  });
  $('speedSelect').addEventListener('change', (e) => { state.speed = Number(e.target.value); });
  $('langBtn').addEventListener('click', () => {
    setLang(getLang() === 'en' ? 'zh' : 'en');
    applyLanguage();
  });
  $('popupClose').addEventListener('click', () => {
    state.scene?.clearSelection();
    $('popup').classList.add('hidden');
  });
  $('legendToggle').addEventListener('click', () => {
    const hidden = $('legendBody').classList.toggle('hidden');
    $('legendHint').classList.toggle('hidden', hidden);
    $('legendToggle').textContent = hidden ? '+' : '−';
    $('legendToggle').title = hidden ? t('expand') : t('collapse');
  });
  requestAnimationFrame(animate);
}

async function bootstrap() {
  setLoading(t('fetchDetail'));
  bindUI();
  applyLanguage();

  const texts = [];
  for (const name of CSV_FILES) {
    try {
      texts.push(await fetchText(name));
    } catch (e) {
      showError(t('missingFile', name));
      return;
    }
  }
  setLoading(t('buildDetail'));
  const groups = [];
  for (let i = 0; i < texts.length; i += 1) {
    groups.push(await parseInWorker(texts[i], String.fromCharCode(65 + i)));
  }
  const vessels = mergeVessels(groups);
  if (!vessels.length) { showError(t('errorTitle')); return; }

  let timeMin = Infinity;
  let timeMax = -Infinity;
  let reportCount = 0;
  for (const v of vessels) {
    timeMin = Math.min(timeMin, v.fixes[0][0]);
    timeMax = Math.max(timeMax, v.fixes[v.fixes.length - 1][0]);
    reportCount += v.fixes.length;
  }

  setLoading(t('renderDetail'));
  const scene = new VoyageScene('cesiumContainer');
  state.scene = scene;
  scene.load(vessels, timeMin, timeMax);
  scene.onSelect = (v) => showPopup(v);

  buildLegend();
  applyLanguage();
  $('statVessels').textContent = vessels.length.toLocaleString();
  $('statReports').textContent = reportCount.toLocaleString();
  $('startTime').textContent = fmtTime(timeMin);
  $('endTime').textContent = fmtTime(timeMax);
  $('currentTime').textContent = fmtTime(timeMin);

  $('loading').classList.add('hidden');
  console.info(`Loaded ${vessels.length} vessels / ${reportCount} reports / ${fmtDate(timeMin)}`);
}

bootstrap().catch((e) => {
  console.error(e, e?.stack || '');
  showError(`${t('errorTitle')}: ${e.message}`);
});
