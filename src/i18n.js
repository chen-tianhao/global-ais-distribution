const DICT = {
  en: {
    appTitle: 'AIS Voyage Replay',
    appSubtitle: 'Global vessel positions · 11 Nov 2023',
    vessels: 'vessels',
    positionReports: 'position reports',
    switchLang: 'Switch to Chinese',
    legendTitle: 'Vessel types',
    legendHint: 'Click a category to show / hide',
    collapse: 'Collapse',
    expand: 'Expand',
    play: 'Play',
    pause: 'Pause',
    restart: 'Restart',
    speed: 'Speed',
    loadingTitle: 'Loading AIS data…',
    fetchDetail: 'Fetching CSV files',
    parseDetail: (i, n) => `Parsing file ${i} of ${n}`,
    buildDetail: 'Building vessel tracks',
    renderDetail: 'Rendering scene',
    errorTitle: 'Data loading failed',
    missingFile: (name) => `Could not load ${name}. Check that the file is in the project root.`,
    infoMmsi: 'MMSI',
    infoImo: 'IMO',
    infoCallSign: 'Call sign',
    infoName: 'Vessel name',
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
    trackHint: 'Track line shows all recorded positions in this window.',
    clickHint: 'Click any vessel to inspect details.',
    unitKnots: 'kn',
    unitDegrees: '°',
    unitMeters: 'm',
  },
  zh: {
    appTitle: 'AIS 航迹回放',
    appSubtitle: '全球船舶位置 · 2023年11月11日',
    vessels: '艘船舶',
    positionReports: '条位置记录',
    switchLang: 'Switch to English',
    legendTitle: '船舶类型',
    legendHint: '点击类别可显示 / 隐藏',
    collapse: '收起',
    expand: '展开',
    play: '播放',
    pause: '暂停',
    restart: '重播',
    speed: '速度',
    loadingTitle: '正在加载 AIS 数据…',
    fetchDetail: '正在获取 CSV 文件',
    parseDetail: (i, n) => `正在解析第 ${i} / ${n} 个文件`,
    buildDetail: '正在构建船舶航迹',
    renderDetail: '正在渲染场景',
    errorTitle: '数据加载失败',
    missingFile: (name) => `无法加载 ${name}，请确认文件位于项目根目录。`,
    infoMmsi: 'MMSI',
    infoImo: 'IMO',
    infoCallSign: '呼号',
    infoName: '船名',
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
    trackHint: '航迹线显示本时间窗口内所有已记录位置。',
    clickHint: '点击任意船舶查看详情。',
    unitKnots: '节',
    unitDegrees: '°',
    unitMeters: '米',
  },
};

let current = 'en';

export function t(key, ...args) {
  const val = DICT[current][key] ?? DICT.en[key] ?? key;
  return typeof val === 'function' ? val(...args) : val;
}

export function setLang(lang) {
  current = lang === 'zh' ? 'zh' : 'en';
  return current;
}

export function getLang() {
  return current;
}
