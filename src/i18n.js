// UI strings and localised formatting helpers.
//
// All user-visible text lives here; components never hardcode a label. Dates
// and times are formatted from the loaded dataset rather than literals, so the
// header stays correct when the CSV files change.

const DICT = {
  en: {
    appTitle: 'AIS Voyage Replay',
    appSubtitle: (date) => `Global vessel positions · ${date}`,
    vessels: 'vessels visible',
    positionReports: 'position reports',
    switchLang: 'Switch to Chinese',
    legendTitle: 'Vessel types',
    legendHint: 'Click a category to show / hide',
    staleHint: 'Dimmed markers: position inferred from an older report',
    lodHint: 'Fewer vessels are drawn when zoomed out, to keep the view smooth',
    collapse: 'Collapse',
    expand: 'Expand',
    play: 'Play',
    pause: 'Pause',
    restart: 'Restart',
    replay: 'Replay',
    speed: 'Speed',
    loadingTitle: 'Loading AIS data…',
    phaseManifest: 'Looking for a prepared dataset',
    phaseDownload: 'Downloading',
    phaseParse: 'Parsing',
    phaseDecode: 'Decoding',
    phaseBytes: (loaded, total) => `${loaded} / ${total} MB`,
    phaseRows: (rows) => `${rows} rows`,
    errorTitle: 'Data loading failed',
    missingFile: (name) => `Could not load ${name}. Check that the file is in the project root.`,
    retry: 'Retry',
    close: 'Close',
    infoMmsi: 'MMSI',
    infoImo: 'IMO',
    infoCallSign: 'Call sign',
    infoType: 'Vessel type',
    infoFlag: 'Flag',
    infoDestination: 'Destination',
    infoLength: 'Length × beam',
    infoSog: 'Speed over ground',
    infoCog: 'Course over ground',
    infoHeading: 'Heading',
    infoNav: 'Navigation status',
    infoPosition: 'Position',
    infoLastFix: 'Last report (UTC)',
    infoReports: 'Reports in window',
    navUnknown: 'Unknown',
    trackHint: 'Track line shows all recorded positions in this window.',
    clickHint: 'Click any vessel to inspect details.',
    staleNote: 'No report for a while; position is inferred.',
    keyboardHint: 'Space play · ←/→ step 30s · Esc close',
    loadSummary: (vessels, reports) => `${vessels} vessels / ${reports} reports`,
    sourceCsv: 'CSV fallback',
    sourceBinary: 'Prepared binary',
    unitKnots: 'kn',
    unitDegrees: '°',
    unitMeters: 'm',
  },
  zh: {
    appTitle: 'AIS 航迹回放',
    appSubtitle: (date) => `全球船舶位置 · ${date}`,
    vessels: '艘可见船舶',
    positionReports: '条位置记录',
    switchLang: 'Switch to English',
    legendTitle: '船舶类型',
    legendHint: '点击类别可显示 / 隐藏',
    staleHint: '半透明标记：位置由较早的报告推断',
    lodHint: '缩小时自动抽稀显示，以保证流畅',
    collapse: '收起',
    expand: '展开',
    play: '播放',
    pause: '暂停',
    restart: '重播',
    replay: '重新播放',
    speed: '速度',
    loadingTitle: '正在加载 AIS 数据…',
    phaseManifest: '正在检查预处理数据集',
    phaseDownload: '正在下载',
    phaseParse: '正在解析',
    phaseDecode: '正在解码',
    phaseBytes: (loaded, total) => `${loaded} / ${total} MB`,
    phaseRows: (rows) => `${rows} 行`,
    errorTitle: '数据加载失败',
    missingFile: (name) => `无法加载 ${name}，请确认文件位于项目根目录。`,
    retry: '重试',
    close: '关闭',
    infoMmsi: 'MMSI',
    infoImo: 'IMO',
    infoCallSign: '呼号',
    infoType: '船舶类型',
    infoFlag: '船旗国',
    infoDestination: '目的港',
    infoLength: '船长 × 船宽',
    infoSog: '对地航速',
    infoCog: '对地航向',
    infoHeading: '船首向',
    infoNav: '航行状态',
    infoPosition: '位置',
    infoLastFix: '最后报告时间（UTC）',
    infoReports: '窗口内报告数',
    navUnknown: '未知',
    trackHint: '航迹线显示本时间窗口内所有已记录位置。',
    clickHint: '点击任意船舶查看详情。',
    staleNote: '近期无新报告，位置由历史记录推断。',
    keyboardHint: '空格播放 · ←/→ 前后 30 秒 · Esc 关闭',
    loadSummary: (vessels, reports) => `${vessels} 艘船舶 / ${reports} 条记录`,
    sourceCsv: 'CSV 回退',
    sourceBinary: '预处理二进制',
    unitKnots: '节',
    unitDegrees: '°',
    unitMeters: '米',
  },
};

// AIS navigation status codes 0-15 (ITU-R M.1371). Codes outside this range
// appear in real feeds and resolve to "unknown".
const NAV_STATUS = {
  en: [
    'Under way using engine',
    'At anchor',
    'Not under command',
    'Restricted manoeuvrability',
    'Constrained by draught',
    'Moored',
    'Aground',
    'Engaged in fishing',
    'Under way sailing',
    'Reserved (HSC)',
    'Reserved (WIG)',
    'Towing astern',
    'Pushing ahead / towing alongside',
    'Reserved',
    'AIS-SART / MOB / EPIRB',
    'Undefined',
  ],
  zh: [
    '在航（机动）',
    '锚泊',
    '失去控制',
    '操纵能力受限',
    '吃水受限',
    '系泊',
    '搁浅',
    '从事捕鱼',
    '在航（帆船）',
    '保留（高速船）',
    '保留（地效翼船）',
    '尾拖',
    '顶推 / 旁拖',
    '保留',
    'AIS-SART / 人员落水 / EPIRB',
    '未定义',
  ],
};

let current = 'en';

export function t(key, ...args) {
  const val = DICT[current][key] ?? DICT.en[key] ?? key;
  return typeof val === 'function' ? val(...args) : val;
}

export function navStatusText(code) {
  const table = NAV_STATUS[current] || NAV_STATUS.en;
  return Number.isInteger(code) && code >= 0 && code < table.length
    ? table[code]
    : t('navUnknown');
}

export function setLang(lang) {
  current = lang === 'zh' ? 'zh' : 'en';
  return current;
}

export function getLang() {
  return current;
}

/** UTC clock, HH:MM:SS. */
export function formatTime(ms) {
  if (!Number.isFinite(ms)) return '--:--:--';
  return new Date(ms).toISOString().slice(11, 19);
}

/** UTC calendar date, localised. */
export function formatDate(ms) {
  if (!Number.isFinite(ms)) return '--';
  const d = new Date(ms);
  if (current === 'zh') {
    return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  }
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** 12/24-hour clock label for axis ticks, UTC. */
export function formatClock(ms) {
  return formatTime(ms);
}
