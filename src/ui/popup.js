// Vessel info panel.
//
// Rows are created once and only their text content is refreshed afterwards.
// Rebuilding innerHTML on every animation frame used to reset scroll position
// and break text selection; it also exposed the panel to markup injection from
// untrusted CSV fields, which textContent makes impossible.

import { CATEGORIES, CATEGORY_ORDER } from '../config.js';
import { t, navStatusText, formatTime, getLang } from '../i18n.js';

const ROWS = [
  'type', 'imo', 'callsign', 'flag', 'dest', 'dims',
  'sog', 'cog', 'heading', 'nav', 'pos', 'lastFix', 'reports',
];

const LABEL_KEY = {
  type: 'infoType',
  imo: 'infoImo',
  callsign: 'infoCallSign',
  flag: 'infoFlag',
  dest: 'infoDestination',
  dims: 'infoLength',
  sog: 'infoSog',
  cog: 'infoCog',
  heading: 'infoHeading',
  nav: 'infoNav',
  pos: 'infoPosition',
  lastFix: 'infoLastFix',
  reports: 'infoReports',
};

export class VesselPopup {
  constructor(elements, { onClose }) {
    this.root = elements.root;
    this.nameEl = elements.nameEl;
    this.mmsiEl = elements.mmsiEl;
    this.bodyEl = elements.bodyEl;
    this.noteEl = elements.noteEl;
    this.cells = {};
    this.vessel = null;
    this._build();
    elements.closeBtn.addEventListener('click', onClose);
  }

  _build() {
    this.bodyEl.textContent = '';
    for (const key of ROWS) {
      const row = document.createElement('div');
      row.className = 'popup-row';
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = t(LABEL_KEY[key]);
      const v = document.createElement('span');
      v.className = 'v';
      row.append(k, v);
      this.bodyEl.appendChild(row);
      this.cells[key] = { row, value: v };
    }
  }

  /** Re-apply labels after a language change without touching values. */
  relabel() {
    for (const key of ROWS) {
      this.cells[key].row.firstChild.textContent = t(LABEL_KEY[key]);
    }
    if (this.vessel) {
      this.nameEl.textContent = this.vessel.name
        || `${t('infoMmsi')} ${this.vessel.mmsi}`;
      this.mmsiEl.textContent = `${t('infoMmsi')} ${this.vessel.mmsi}`;
    }
  }

  show(vessel, snapshot) {
    if (!vessel) {
      this.hide();
      return;
    }
    this.vessel = vessel;
    this.root.classList.remove('hidden');
    this.nameEl.textContent = vessel.name || `${t('infoMmsi')} ${vessel.mmsi}`;
    this.mmsiEl.textContent = `${t('infoMmsi')} ${vessel.mmsi}`;
    this.update(vessel, snapshot, true);
  }

  update(vessel, snapshot, force = false) {
    if (!vessel) return;
    const lang = getLang();
    const key = CATEGORY_ORDER[vessel.categoryId] || 'OTHER';
    const cat = CATEGORIES[key] || CATEGORIES.OTHER;

    const values = {
      type: lang === 'zh' ? cat.zh : cat.en,
      imo: vessel.imo,
      callsign: vessel.callsign,
      flag: vessel.flag,
      dest: vessel.dest,
      dims: vessel.length && vessel.width
        ? `${vessel.length} × ${vessel.width} ${t('unitMeters')}`
        : '',
      sog: snapshot && Number.isFinite(snapshot.sog)
        ? `${snapshot.sog.toFixed(1)} ${t('unitKnots')}` : '',
      cog: snapshot && Number.isFinite(snapshot.cog)
        ? `${snapshot.cog.toFixed(1)} ${t('unitDegrees')}` : '',
      heading: snapshot && Number.isFinite(snapshot.heading)
        ? `${snapshot.heading.toFixed(0)}${t('unitDegrees')}` : '',
      nav: snapshot ? navStatusText(snapshot.nav) : '',
      pos: snapshot
        ? `${snapshot.lat.toFixed(4)}°, ${snapshot.lon.toFixed(4)}°` : '',
      lastFix: snapshot ? `${formatTime(snapshot.time)} UTC` : '',
      reports: String(vessel.fixCount),
    };

    for (const rowKey of ROWS) {
      const cell = this.cells[rowKey];
      const text = values[rowKey] ?? '';
      if (force || cell.value.textContent !== text) {
        cell.value.textContent = text;
        cell.row.hidden = text === '';
      }
    }

    const note = snapshot?.stale
      ? t('staleNote')
      : (vessel.fixCount > 1 ? t('trackHint') : t('clickHint'));
    if (this.noteEl.textContent !== note) this.noteEl.textContent = note;
  }

  hide() {
    this.root.classList.add('hidden');
    this.vessel = null;
  }
}
