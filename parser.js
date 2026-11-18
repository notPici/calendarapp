// Bilingual (English + Romanian) natural-language parser for calendar commands.
// Runs fully offline. Pure module: no DOM access.
//
//   parse(text, { now, events, settings }) -> result
//
// result.intent: 'create' | 'cancel' | 'reschedule' | 'edit' | 'empty'

import {
  addDays, addMinutes, addMonths, startOfDay, startOfWeek, isoDow, atTime, parseDate,
  ymd, toLocal, dayDiff, occurrences, occEnd, daysInMonth, eventSpan, minutesOfDay,
} from './dates.js';

// ---------------------------------------------------------------- text utils

const DIAC = {
  'ă': 'a', 'â': 'a', 'î': 'i', 'ș': 's', 'ş': 's', 'ț': 't', 'ţ': 't',
  'Ă': 'a', 'Â': 'a', 'Î': 'i', 'Ș': 's', 'Ş': 's', 'Ț': 't', 'Ţ': 't',
  '’': "'", '‘': "'", '`': "'", '´': "'", '–': '-', '—': '-', '„': '"', '”': '"', '“': '"',
};

/** Lower-case + strip Romanian diacritics. Same length as input (index-preserving). */
export function norm(s) {
  let o = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (DIAC[c] !== undefined) { o += DIAC[c]; continue; }
    const l = c.toLowerCase();
    o += l.length === 1 ? l : c;
  }
  return o;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
const alt = (arr) => [...arr].sort((a, b) => b.length - a.length).map(esc).join('|');
const L = '(?<![\\p{L}\\p{N}])';
const R = '(?![\\p{L}\\p{N}])';

// ---------------------------------------------------------------- vocab

const NUMW = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty five': 45, 'forty-five': 45,
  fifty: 50, sixty: 60, ninety: 90, couple: 2, 'a couple of': 2, 'a couple': 2, few: 3, 'a few': 3,
  un: 1, o: 1, una: 1, unu: 1, doi: 2, doua: 2, trei: 3, patru: 4, cinci: 5, sase: 6, sapte: 7, opt: 8,
  noua: 9, zece: 10, unsprezece: 11, unspe: 11, doisprezece: 12, douasprezece: 12, doispe: 12,
  cincisprezece: 15, cincispe: 15, douazeci: 20, treizeci: 30, patruzeci: 40, 'patruzeci si cinci': 45,
  cincizeci: 50, saizeci: 60, nouazeci: 90, 'cateva': 3,
};
const NUM_WORDS = alt(Object.keys(NUMW));
const NUM = `(?:\\d+(?:[.,]\\d+)?\\s*|(?:${NUM_WORDS})\\s+)`;

const UNIT_MAP = {
  minutes: 'min', minute: 'min', minutul: 'min', minut: 'min', mins: 'min', min: 'min', m: 'min',
  hours: 'hour', hour: 'hour', hrs: 'hour', hr: 'hour', h: 'hour', ore: 'hour', ora: 'hour', orei: 'hour',
  days: 'day', day: 'day', zile: 'day', zilei: 'day', zi: 'day',
  weeks: 'week', week: 'week', wks: 'week', wk: 'week', saptamani: 'week', saptamana: 'week', saptamanii: 'week',
  months: 'month', month: 'month', luni: 'month', luna: 'month', lunii: 'month',
  years: 'year', year: 'year', yrs: 'year', ani: 'year', an: 'year', anul: 'year',
};
const UNIT_WORDS = alt(Object.keys(UNIT_MAP));
const UNIT = `(?:${UNIT_WORDS})${R}`;
const HALF = `(?:\\s+(?:and|si)\\s+(?:a\\s+)?(?:half|jumatate))`;
const EXTRA_MIN = `(?:\\s+(?:and|si)\\s+\\d{1,2}\\s*(?:de\\s+)?(?:minutes|minute|mins|min)${R})`;
const QTY =
  `(?:(?:half\\s+an?|a\\s+half|o\\s+jumatate\\s+de|jumatate\\s+de|un\\s+sfert\\s+de|a\\s+quarter\\s+of\\s+an?|quarter\\s+of\\s+an?|an?\\s+quarter\\s+hour|quarter\\s+hour)\\s+(?:hour|ora)${R}` +
  `|\\d{1,2}h\\s?\\d{1,2}(?:m|min)?${R}` +
  `|${NUM}(?:de\\s+)?${UNIT}${HALF}?${EXTRA_MIN}?)`;

function parseQty(s) {
  s = s.trim().replace(/\s+/g, ' ');
  if (/^(half|a half|o jumatate|jumatate)/.test(s)) return { unit: 'min', value: 30 };
  if (/^(un sfert|a quarter|quarter|an? quarter)/.test(s)) return { unit: 'min', value: 15 };
  let m = /^(\d{1,2})h ?(\d{1,2})/.exec(s);
  if (m) return { unit: 'min', value: +m[1] * 60 + +m[2] };
  m = new RegExp(`^(\\d+(?:[.,]\\d+)?|${NUM_WORDS})\\s*(?:de\\s+)?(${UNIT_WORDS})(?![\\p{L}])`, 'u').exec(s);
  if (!m) return null;
  let n = /\d/.test(m[1]) ? parseFloat(m[1].replace(',', '.')) : NUMW[m[1].replace(/\s+/g, ' ')];
  if (n == null || isNaN(n)) return null;
  if (/(and|si) (a )?(half|jumatate)/.test(s)) n += 0.5;
  let extra = 0;
  const em = /(?:and|si) (\d{1,2}) ?(?:de )?(?:minutes|minute|mins|min)/.exec(s);
  if (em) extra = +em[1];
  switch (UNIT_MAP[m[2]]) {
    case 'min': return { unit: 'min', value: Math.round(n) + extra };
    case 'hour': return { unit: 'min', value: Math.round(n * 60) + extra };
    case 'day': return { unit: 'day', value: Math.round(n) };
    case 'week': return { unit: 'day', value: Math.round(n * 7) };
    case 'month': return { unit: 'month', value: Math.round(n) };
    case 'year': return { unit: 'month', value: Math.round(n * 12) };
  }
  return null;
}

const MONTHS = {
  january: 1, jan: 1, ianuarie: 1, ian: 1,
  february: 2, feb: 2, februarie: 2, febr: 2,
  march: 3, mar: 3, martie: 3,
  april: 4, apr: 4, aprilie: 4,
  may: 5, mai: 5,
  june: 6, jun: 6, iunie: 6, iun: 6,
  july: 7, jul: 7, iulie: 7, iul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9, septembrie: 9,
  october: 10, oct: 10, octombrie: 10,
  november: 11, nov: 11, noiembrie: 11, noi: 11,
  december: 12, dec: 12, decembrie: 12,
};
const MONTH_ALT = alt(Object.keys(MONTHS));
const MONTH_ALT_PRE = alt(Object.keys(MONTHS).filter((k) => k !== 'mai' && k !== 'noi' && k !== 'mar'));

const WD = {
  monday: 1, mon: 1, tuesday: 2, tues: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thurs: 4, thur: 4, thu: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 7, sun: 7,
  luni: 1, lunea: 1, marti: 2, martea: 2, miercuri: 3, miercurea: 3, joi: 4, joia: 4,
  vineri: 5, vinerea: 5, sambata: 6, duminica: 7,
};
const WD_ALT = alt(Object.keys(WD));
const WD_PL = { mondays: 1, tuesdays: 2, wednesdays: 3, thursdays: 4, fridays: 5, saturdays: 6, sundays: 7 };
const WD_PL_ALT = alt(Object.keys(WD_PL));

const AMPM = `(?:a\\.?m\\.?|p\\.?m\\.?)`;
const ATOMN = `(?:\\d{1,2}(?:[:.]\\d{2}|h(?:\\d{2})?)?(?:\\s*${AMPM}(?![\\p{L}]))?|noon|midday|midnight|miezul\\s+noptii)`;
const TPREFIX =
  `(?:at|@|la\\s+ora|la|ora|pe\\s+la|around|about|by|from|de\\s+la|until|till|pana\\s+la|pana\\s+in|starting\\s+at|starting|incepand\\s+cu|incepand\\s+de\\s+la|in\\s+jur\\s+de|in\\s+jurul\\s+orei|catre|spre|before|after|dupa|inainte\\s+de)`;

const DAYPART_DEFAULT = { morning: [9, 0], noon: [12, 0], afternoon: [15, 0], evening: [19, 0], night: [21, 0] };

const EVENING_CTX = /\b(dinner|supper|party|drinks|bar|club|concert|movie|cinema|theat(?:re|er)|show|gig|date night|cina|petrecere|bere|film|teatru|spectacol|chef|club|meci)\b/;
const MORNING_CTX = /\b(breakfast|wake|alarm|mic dejun|trezire|trezit|alarma|desteptator)\b/;

// ---------------------------------------------------------------- intent lexicon

const CANCEL_STRONG = [
  `(?:i'?m|i\\s+am|im|we'?re|we\\s+are)?\\s*not\\s+(?:going|attending|coming|joining|doing|having|making\\s+it|able\\s+to\\s+(?:go|make\\s+it|come|attend))(?:\\s+to)?`,
  `(?:i|we)?\\s*(?:won'?t|wont|will\\s+not|can'?t|cant|cannot|can\\s+not|couldn'?t|couldnt|could\\s+not|don'?t|dont|do\\s+not)\\s+(?:be\\s+able\\s+to\\s+)?(?:go|attend|make\\s+it|make|come|join|be\\s+there|be\\s+going)(?:\\s+to)?`,
  `cancel(?:l?ed|l?ing|lation|s)?`, `call(?:ed|ing)?\\s+off`, `delete[ds]?`, `remove[ds]?`, `scrap(?:ped)?`,
  `skip(?:ping|ped)?`, `no\\s+longer`, `not\\s+happening`, `isn'?t\\s+happening`, `(?:it'?s|its|it\\s+is|is)\\s+off`,
  `bail(?:ing|ed)?\\s+on`, `pull(?:ing|ed)?\\s+out\\s+of`, `get\\s+rid\\s+of`,
  // RO
  `nu\\s+(?:mai\\s+)?(?:merg|mergem|ma\\s+(?:mai\\s+)?duc|ne\\s+(?:mai\\s+)?ducem|ajung|ajungem|particip|participam|vin|venim|pot\\s+(?:sa\\s+)?(?:merg|ajung|vin|particip|ma\\s+duc)|pot|facem|fac)(?:\\s+(?:la|sa|in|pe))?`,
  `nu\\s+ma\\s+mai\\s+duc(?:\\s+la)?`, `nu\\s+mai\\s+(?:e|este|are\\s+loc)`, `nu\\s+se\\s+mai\\s+(?:tine|face)`,
  `anul(?:eaza|ez|at[a]?|am|ati|are|eze|ezi)`, `s-a\\s+anulat`, `sterge(?:m|ti)?`, `sterg`, `elimin(?:a|am)?`,
  `renunt(?:a|am)?(?:\\s+la)?`, `contramandat[a]?`, `a\\s+picat`,
];
const RESCHED_STRONG = [
  `re-?schedul(?:e|ed|ing|es)`, `postpon(?:e|ed|ing|es)`, `put\\s+off`, `rebook(?:ed|ing)?`,
  `bring\\s+(?:it\\s+)?forward`, `brought\\s+forward`, `push(?:ed|ing)?(?:\\s+(?:back|out))?`, `delay(?:ed|ing)?`,
  `reprogram(?:eaza|ez|at[a]?|am|ati|are|a)`, `aman(?:a|at[a]?|am|ati|are)`, `decal(?:eaza|ez|at[a]?|am)`,
  `s-a\\s+mutat`, `devans(?:eaza|at[a]?|am)`,
];
const RESCHED_WEAK = [
  `mov(?:e|ed|ing)(?:\\s+(?:it|up))?`, `shift(?:ed|ing)?`, `bump(?:ed|ing)?`, `switch(?:ed|ing)?`,
  `chang(?:e|ed|ing)(?:\\s+(?:the\\s+)?(?:time|date|day|hour))?(?:\\s+(?:of|for))?`, `instead`,
  `(?:is|it'?s)\\s+now`, `now\\s+(?:at|on)`, `make\\s+it`,
  `mut(?:a|at[a]?|am|ati|-l|-o)(?:-l|-o)?`, `schimb(?:a|at[a]?|am)(?:\\s+(?:ora|data|ziua))?`, `in\\s+loc\\s+de`,
  `acum\\s+(?:e|este)`,
];
const EDIT_STRONG = [
  `add\\s+(?:a\\s+)?notes?\\s+(?:to|for|on)`, `notes?\\s+(?:to|for|on)`, `add\\s+to(?:\\s+the)?`, `update(?:\\s+the)?`,
  `(?:details?|info)\\s+for`,
  `adauga\\s+(?:o\\s+)?(?:nota|notita|detalii)\\s+(?:la|pentru)`, `adauga\\s+la`, `noteaza\\s+la`,
  `nota\\s+(?:la|pentru)`, `actualizeaza`, `detalii\\s+(?:la|pentru)`,
];
const SERIES_MARK =
  `anymore|any\\s+more|for\\s+good|permanently|from\\s+now\\s+on|all\\s+of\\s+them|all\\s+occurrences|all\\s+future(?:\\s+ones)?|every\\s+time|the\\s+whole\\s+series|the\\s+series|entire\\s+series|de\\s+acum\\s+(?:inainte|incolo)|definitiv|permanent|toate|de\\s+fiecare\\s+data|toata\\s+seria|intreaga\\s+serie`;

const EARLIER_VERB = /(bring\s+(it\s+)?forward|brought\s+forward|move\s+up|devans)/;

// ---------------------------------------------------------------- stopwords

const STOP = new Set((
  'i im ive ill id me my mine we us our you your it its this that these those the a an to at on in for of with and or but so is am are was were be been being will would shall should can could may might must have has had do does did not no dont going go gonna wanna want need needs got get anymore any more there then just really please also about from by up out event events thing one some them they he she his her him again still now because since as if what when which all very too actually maybe probably think guess sorry unfortunately though already make made time date day today tomorrow it\'s i\'m don\'t can\'t won\'t cant wont isnt making able attend attending come coming join joining happening off rid get ' +
  'eu tu el ea noi voi ei ele ma te il ne va le mi imi iti ii vi meu mea mei mele nostru noastra la pe in din de cu si sau dar ca sa nu mai al ai ale are avem aveti au e este sunt era fi fost vom veti vor un una unui unei niste acest aceasta asta ala aia acel acea acolo aici deja inca tot totusi doar chiar foarte ceva cineva merg mergem duc ducem pot poate trebuie vreau vrem fac face acum apoi dupa pentru despre prin spre catre pana cand unde care ce cum daca iar ori nici lui lor eveniment chestia chestie treaba ora ore data zi ajung ajungem vin venim particip loc'
).split(/\s+/));

const SYN = [
  ['dentist', 'stomatolog', 'stomatologie', 'dentistul', 'dentista'],
  ['doctor', 'medic', 'doctorul', 'medicul', 'dr'],
  ['meeting', 'sedinta', 'sedinte', 'intalnire', 'meet'],
  ['gym', 'sala', 'salii', 'fitness', 'antrenament', 'workout', 'training'],
  ['birthday', 'aniversare', 'ziua', 'bday', 'zi de nastere'],
  ['dinner', 'cina', 'cinei'],
  ['lunch', 'pranz', 'pranzul'],
  ['party', 'petrecere', 'petrecerea', 'chef'],
  ['haircut', 'frizer', 'frizerie', 'coafor', 'tuns'],
  ['flight', 'zbor', 'zborul', 'avion'],
  ['exam', 'examen', 'examenul', 'test'],
  ['class', 'curs', 'cursul', 'ora'],
  ['call', 'apel', 'telefon', 'sun'],
  ['work', 'munca', 'serviciu', 'job', 'birou'],
];
const SYN_MAP = new Map();
SYN.forEach((g, i) => g.forEach((w) => SYN_MAP.set(w, i)));

export function tokens(s) {
  return norm(s).split(/[^\p{L}\p{N}']+/u).map((t) => t.replace(/^'+|'+$/g, '')).filter((t) => t.length >= 2 && !STOP.has(t));
}

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function sim(q, t) {
  if (q === t) return 1;
  const ml = Math.min(q.length, t.length);
  if (SYN_MAP.has(q) && SYN_MAP.get(q) === SYN_MAP.get(t)) return 0.75;
  if (ml >= 4 && (t.startsWith(q) || q.startsWith(t))) return 0.85;
  let l = 0;
  while (l < ml && q[l] === t[l]) l++;
  if (ml >= 4 && l >= Math.max(4, Math.ceil(0.7 * ml))) return 0.75;
  if (ml >= 4) {
    const d = lev(q, t);
    if (d <= 1) return 0.8;
    if (d <= 2 && ml >= 7) return 0.7;
  }
  if (ml >= 4 && l >= 3) return 0.45;
  // synonyms via prefix (e.g. "sedinta" vs "sedintei")
  for (const [w, gi] of SYN_MAP) {
    if (w.length >= 4 && (q.startsWith(w) || w.startsWith(q)) && q.length >= 4) {
      for (const [w2, gj] of SYN_MAP) if (gi === gj && (t.startsWith(w2) || w2.startsWith(t)) && t.length >= 3) return 0.7;
    }
  }
  return 0;
}

// ---------------------------------------------------------------- scanner

class Scan {
  constructor(text) {
    this.o = text;
    this.t = norm(text);
    this.used = new Uint8Array(text.length);
  }
  free(a, b) {
    for (let i = a; i < b; i++) if (this.used[i]) return false;
    return true;
  }
  take(a, b) {
    for (let i = a; i < b; i++) this.used[i] = 1;
  }
  each(src, fn) {
    const re = new RegExp(src, 'gu');
    let m;
    while ((m = re.exec(this.t))) {
      if (!m[0].length) { re.lastIndex++; continue; }
      let a = m.index;
      let b = a + m[0].length;
      while (b > a && /\s/.test(this.t[b - 1])) b--;
      while (a < b && /\s/.test(this.t[a])) a++;
      if (!this.free(a, b)) { re.lastIndex = m.index + 1; continue; }
      const r = fn(m, a, b);
      if (r === false) { re.lastIndex = m.index + 1; continue; }
      if (r && typeof r === 'object') {
        a = r.a ?? a;
        b = r.b ?? b;
      }
      this.take(a, b);
      re.lastIndex = Math.max(b, m.index + 1);
    }
  }
  before(a, n = 14) {
    return this.t.slice(Math.max(0, a - n), a);
  }
  after(b, n = 16) {
    return this.t.slice(b, b + n);
  }
}

function parseAtom(s) {
  s = (s || '').trim();
  if (!s) return null;
  if (/^(noon|midday|amiaza|pranz|ora pranzului|lunchtime)/.test(s)) return { h: 12, m: 0, strong: true, ampm: null };
  if (/^(midnight|miezul)/.test(s)) return { h: 0, m: 0, strong: true, midnight: true, ampm: null };
  const m = /^(\d{1,2})(?:[:.](\d{2})|h(\d{2})?)?\s*(a\.?m\.?|p\.?m\.?)?/.exec(s);
  if (!m) return null;
  const h = +m[1];
  const mi = +(m[2] || m[3] || 0);
  const ap = m[4] ? (m[4][0] === 'a' ? 'am' : 'pm') : null;
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return null;
  if (ap && (h < 1 || h > 12)) return null;
  const hasMin = m[2] != null || m[3] != null;
  const hSuf = /^\d{1,2}h/.test(s);
  return { h, m: mi, ampm: ap, lead0: /^0\d/.test(m[1]), hasMin, strong: !!ap || h >= 13 || hasMin || hSuf || h === 0 };
}

const toMin = (t) => t.h * 60 + t.m;

// ---------------------------------------------------------------- main parse

export function parse(text, ctx = {}) {
  const raw = (text || '').trim();
  if (!raw) return { intent: 'empty' };
  let res = parseOnce(raw, ctx, true);
  // A weak verb ("move", "change", "mută") only counts as a reschedule when it
  // clearly refers to an existing event; otherwise read the text as a new event.
  if (res.weak && !(res.target && res.targetScore >= 2.2)) {
    res = parseOnce(raw, ctx, false);
  }
  return res;
}

function parseOnce(raw, ctx, allowWeak) {
  const now = ctx.now ? new Date(ctx.now) : new Date();
  const today = startOfDay(now);
  const settings = { guessPM: true, ...(ctx.settings || {}) };
  const events = ctx.events || [];
  const S = new Scan(raw);
  const t = S.t;

  const P = {
    intents: new Set(), weak: false, series: false, nuMai: /\bnu\s+mai\b/.test(t),
    reminders: [], alarms: [], repeat: null, shift: null, duration: null, rel: null,
    dates: [], dateRange: null, times: [], timeRange: null, dayparts: [], allDay: false,
    location: null, wake: false, alarmCtx: false, earlier: EARLIER_VERB.test(t),
  };

  // language hint (only used for "am" ambiguity)
  const roHits = (t.match(/\b(la|pe|si|sa|cu|nu|mai|maine|azi|astazi|ora|dimineata|seara|saptamana|merg|trebuie|am o|am un|sedinta|programare|vineri|sambata|duminica|marti|miercuri|joi)\b/g) || []).length +
    (/[ăâîșşțţ]/i.test(raw) ? 3 : 0);
  const enHits = (t.match(/\b(the|at|on|tomorrow|today|i|to|with|and|my|next|meeting|is|for|of|pm)\b/g) || []).length;
  const isRO = roHits > enHits;

  // 1) intents
  S.each(`${L}(?:${SERIES_MARK})${R}`, () => { P.series = true; });
  S.each(`${L}(?:${CANCEL_STRONG.join('|')})${R}`, () => { P.intents.add('cancel'); });
  S.each(`${L}(?:${RESCHED_STRONG.join('|')})${R}`, () => { P.intents.add('reschedule'); });
  if (allowWeak) {
    S.each(`${L}(?:${RESCHED_WEAK.join('|')})${R}`, () => { P.intents.add('reschedule'); P.weakResched = true; });
  }
  S.each(`${L}(?:${EDIT_STRONG.join('|')})${R}`, () => { P.intents.add('edit'); });
  S.each(`${L}(?:please|pls|plz|te\\s+rog|va\\s+rog)${R}`, () => {});

  let intent = P.intents.has('reschedule') ? 'reschedule'
    : P.intents.has('cancel') ? 'cancel'
    : P.intents.has('edit') ? 'edit' : 'create';
  if (intent === 'reschedule' && P.weakResched && !RESCHED_STRONG.some((s) => new RegExp(`${L}(?:${s})${R}`, 'u').test(t))) P.weak = true;

  // 2) reminders
  const BEFORE = `(?:before(?:hand)?|ahead(?:\\s+of\\s+time)?|in\\s+advance|prior|inainte|in\\s+avans|earlier|mai\\s+devreme)`;
  const BEFORE_STRICT = `(?:before(?:hand)?|ahead(?:\\s+of\\s+time)?|in\\s+advance|prior|inainte|in\\s+avans)`;
  const DAYBEFORE = `(?:(?:the\\s+)?(?:day|night|evening|morning)\\s+before|(?:a|one|1)\\s+day\\s+(?:before|earlier|ahead)|cu\\s+o\\s+(?:zi|seara)\\s+(?:inainte|in\\s+avans)|(?:in\\s+)?(?:ziua|seara)\\s+(?:de\\s+)?dinainte)`;
  const REM_KW =
    `(?:remind(?:\\s+(?:me|us))?|notify(?:\\s+(?:me|us))?|alert\\s+(?:me|us)|ping\\s+(?:me|us)|(?:with|set|add)\\s+(?:an?\\s+)?(?:reminder|notification|alert)|reminder|notification` +
    `|aminteste-mi|aminteste-ne|aminteste-ma|aminteste\\s+mi|reaminteste-mi|adu-mi\\s+aminte|anunta-ma|anunta-ne|notifica-ma|da-mi\\s+(?:de\\s+stire|un\\s+semn|o\\s+notificare)|(?:cu\\s+|pune\\s+|si\\s+)?(?:un\\s+|o\\s+)?(?:memento|notificare|reminder|alerta))`;
  const pushRem = (txt) => {
    const dm = /(night|evening|seara)/.test(txt) && /(before|dinainte|inainte|avans)/.test(txt) ? 'eve'
      : /(day|zi|ziua)\s*(before|earlier|ahead|inainte|dinainte|in avans)|(morning before)|cu o zi/.test(txt) ? 'day' : null;
    if (dm) { P.reminders.push({ kind: 'dayBefore', eve: dm === 'eve', at: dm === 'eve' ? [20, 0] : [9, 0] }); return; }
    const qm = new RegExp(QTY, 'u').exec(txt);
    if (qm) {
      const q = parseQty(qm[0]);
      if (q) {
        const min = q.unit === 'min' ? q.value : q.unit === 'day' ? q.value * 1440 : q.value * 43200;
        P.reminders.push({ kind: 'offset', min });
        return;
      }
    }
    P.reminders.push({ kind: 'atTime' });
  };
  S.each(`${L}${REM_KW}(?:\\s+(?:about\\s+it|of\\s+it|about\\s+this|of\\s+this|despre\\s+asta))?(?:\\s+(?:with\\s+|cu\\s+)?(?:${QTY}(?:\\s+${BEFORE})?|${DAYBEFORE})|\\s+(?:at\\s+(?:the\\s+)?start(?:\\s+time)?|when\\s+it\\s+starts|on\\s+time|la\\s+inceput|cand\\s+incepe|la\\s+ora\\s+inceperii))?${R}`, (m) => {
    pushRem(m[0]);
  });

  // 3) alarms
  const ALARM_KW =
    `(?:(?:set|add|with|put|also|plus|cu|pune|seteaza|adauga|si|fa)(?:-mi)?\\s+)?(?:(?:an?|the|my|o|un)\\s+)?(?:alarm(?:\\s+clock)?|alarma|desteptator(?:ul)?)`;
  const WAKE_KW = `(?:wake\\s+(?:me\\s+)?up|wake\\s+me|wake-?up(?:\\s+call)?|trezeste-ma|scoala-ma|desteapta-ma|trezirea|trezire)`;
  S.each(`${L}(${ALARM_KW}|${WAKE_KW})(?:\\s+(?:cu\\s+)?(${QTY})\\s+${BEFORE}|\\s+(?:for|at|@|la\\s+ora|la|pe\\s+la|pentru|ora|to)?\\s*(${ATOMN}))?${R}`, (m, a) => {
    P.alarmCtx = true;
    if (new RegExp(WAKE_KW, 'u').test(m[1])) P.wake = true;
    if (m[2]) {
      const q = parseQty(m[2]);
      if (q) P.alarms.push({ kind: 'offset', min: q.unit === 'min' ? q.value : q.value * 1440 });
      else P.alarms.push({ kind: 'atTime' });
      return;
    }
    if (m[3]) {
      const at = parseAtom(m[3]);
      if (at) {
        // swallow a trailing daypart: "alarm at 7 in the morning"
        P.alarms.push({ kind: 'abs', atom: at });
        return;
      }
      return { a, b: a + m[1].length };
    }
    P.alarms.push({ kind: 'atTime' });
  });

  // 4) recurrence
  const setRepeat = (r) => { if (!P.repeat) P.repeat = r; };
  const wdList = (s, map) => {
    const out = [];
    for (const w of s.split(/\s*(?:,|and|&|\+|si)\s*|\s+/)) { if (map[w]) out.push(map[w]); }
    return [...new Set(out)].sort((a, b) => a - b);
  };
  S.each(`${L}(?:every|each)\\s+(?:(other|second|2nd|\\d+)\\s+)?(weekdays?|week\\s*days?|weekends?|days?|weeks?|months?|years?|(?:${WD_ALT})(?:\\s*(?:,|and|&|\\+)\\s*(?:${WD_ALT}))*)${R}`, (m) => {
    const n = m[1] ? (/\d+/.test(m[1]) ? +m[1] : 2) : 1;
    const u = m[2];
    if (/^week\s*days?$|^weekdays?$/.test(u)) setRepeat({ freq: 'weekly', interval: 1, days: [1, 2, 3, 4, 5] });
    else if (/^weekends?$/.test(u)) setRepeat({ freq: 'weekly', interval: 1, days: [6, 7] });
    else if (/^days?$/.test(u)) setRepeat({ freq: 'daily', interval: n });
    else if (/^weeks?$/.test(u)) setRepeat({ freq: 'weekly', interval: n });
    else if (/^months?$/.test(u)) setRepeat({ freq: 'monthly', interval: n });
    else if (/^years?$/.test(u)) setRepeat({ freq: 'yearly', interval: n });
    else setRepeat({ freq: 'weekly', interval: n, days: wdList(u, WD) });
  });
  S.each(`${L}(?:in\\s+|la\\s+)?fiecare\\s+(?:(a\\s+doua|\\d+)\\s+)?(zi\\s+lucratoare|zi|saptamana|luna|an|weekend|(?:${WD_ALT})(?:\\s*(?:,|si)\\s*(?:${WD_ALT}))*)${R}`, (m) => {
    const n = m[1] ? (/\d/.test(m[1]) ? +m[1] : 2) : 1;
    const u = m[2];
    if (/lucratoare/.test(u)) setRepeat({ freq: 'weekly', interval: 1, days: [1, 2, 3, 4, 5] });
    else if (u === 'zi') setRepeat({ freq: 'daily', interval: n });
    else if (u === 'saptamana') setRepeat({ freq: 'weekly', interval: n });
    else if (u === 'luna') setRepeat({ freq: 'monthly', interval: n });
    else if (u === 'an') setRepeat({ freq: 'yearly', interval: n });
    else if (u === 'weekend') setRepeat({ freq: 'weekly', interval: 1, days: [6, 7] });
    else setRepeat({ freq: 'weekly', interval: n, days: wdList(u, WD) });
  });
  S.each(`${L}(daily|weekly|monthly|yearly|annually|biweekly|fortnightly|every\\s*day|everyday|on\\s+weekdays|weekdays|on\\s+weekends|zilnic|saptamanal|lunar|anual|in\\s+zilele\\s+lucratoare|in\\s+timpul\\s+saptamanii|(?:o\\s+data|odata)\\s+pe\\s+(?:saptamana|luna|an))${R}`, (m, a) => {
    const w = m[1].replace(/\s+/g, ' ');
    // "Weekly sync ..." — adjective at the very start stays part of the title
    const keep = a === 0 && /^(daily|weekly|monthly|yearly|biweekly)$/.test(w) && /^\s+\p{L}/u.test(S.after(a + m[0].length, 3));
    const r0 = P.repeat;
    if (/^(daily|every ?day|everyday|zilnic)$/.test(w)) setRepeat({ freq: 'daily', interval: 1 });
    else if (/^(weekly|saptamanal)$|saptamana$/.test(w)) setRepeat({ freq: 'weekly', interval: 1 });
    else if (/^(biweekly|fortnightly)$/.test(w)) setRepeat({ freq: 'weekly', interval: 2 });
    else if (/^(monthly|lunar)$|luna$/.test(w)) setRepeat({ freq: 'monthly', interval: 1 });
    else if (/^(yearly|annually|anual)$|an$/.test(w)) setRepeat({ freq: 'yearly', interval: 1 });
    else if (/weekends/.test(w)) setRepeat({ freq: 'weekly', interval: 1, days: [6, 7] });
    else setRepeat({ freq: 'weekly', interval: 1, days: [1, 2, 3, 4, 5] });
    if (keep) { if (r0) P.repeat = r0; else P.repeatSoft = true; return { a, b: a }; }
  });
  S.each(`${L}la\\s+(?:fiecare\\s+)?(\\d+|doua|trei|patru)\\s+(zile|saptamani|luni)${R}|${L}din\\s+(\\d+)\\s+in\\s+\\d+\\s+(zile|saptamani)${R}`, (m) => {
    const nRaw = m[1] || m[3];
    const n = /\d/.test(nRaw) ? +nRaw : NUMW[nRaw];
    const u = m[2] || m[4];
    setRepeat({ freq: u === 'zile' ? 'daily' : u === 'luni' ? 'monthly' : 'weekly', interval: n });
  });
  S.each(`${L}(?:on\\s+)?(${WD_PL_ALT})(?:\\s*(?:,|and|&)\\s*(?:${WD_PL_ALT}))*${R}`, (m) => {
    setRepeat({ freq: 'weekly', interval: 1, days: wdList(m[0].replace(/^on\s+/, ''), WD_PL) });
  });

  // 5) shifts ("an hour later", "cu o zi mai devreme") — only for reschedule
  if (intent === 'reschedule') {
    S.each(`${L}(?:(back|out|forward|ahead|up)\\s+)?(?:by\\s+|with\\s+|cu\\s+)?(${QTY})(?:\\s+(later|earlier|back|forward|sooner|ahead|mai\\s+tarziu|mai\\s+devreme|inainte|inapoi|in\\s+plus))?${R}`, (m) => {
      const has = /\b(by|with|cu|later|earlier|back|forward|sooner|ahead|up|out|tarziu|devreme|inainte|inapoi|plus)\b/.test(m[0]);
      if (!has) return false;
      const q = parseQty(m[2]);
      if (!q) return false;
      const earlier = /(earlier|sooner|forward|ahead|\bup\b|devreme|inainte|inapoi)/.test(m[0]) || (P.earlier && !/(later|tarziu)/.test(m[0]));
      P.shift = { ...q, sign: earlier ? -1 : 1 };
    });
  }

  // 6) durations
  S.each(`${L}(?:for|lasting|timp\\s+de|pentru|vreme\\s+de|durata(?:\\s+de)?|dureaza)\\s+(?:about\\s+|around\\s+|aprox(?:imativ)?\\s+|cam\\s+)?(${QTY})${R}`, (m) => {
    const q = parseQty(m[1]);
    if (!q) return false;
    P.duration = q;
  });

  // 7) relative ("in 2 hours", "peste 3 zile", "într-o săptămână")
  S.each(`${L}(?:in|peste|after|dupa)\\s+(${QTY})${R}|${L}(?:intr-o|intr-un|intro|intrun)\\s+(${UNIT_WORDS})${R}|${L}(${QTY})\\s+(?:from\\s+now|from\\s+today|de\\s+acum|de\\s+azi)${R}`, (m) => {
    const q = m[1] ? parseQty(m[1]) : m[3] ? parseQty(m[3]) : parseQty('1 ' + m[2]);
    if (!q) return false;
    P.rel = q;
  });

  // 8) bare durations ("2 hours", "90 min") & standalone reminder offsets
  S.each(`${L}(?:cu\\s+)?(${QTY})\\s+${BEFORE_STRICT}${R}|${L}${DAYBEFORE}${R}`, (m) => {
    if (intent === 'reschedule' && !/(before|prior|advance|avans|dinainte)/.test(m[0])) return false;
    pushRem(m[0]);
  });
  S.each(`${L}((?:\\d{1,3}(?:[.,]5)?\\s*|(?:${NUM_WORDS})\\s+)(?:de\\s+)?(?:hours|hour|hrs|ore|ora|minutes|minute|mins|min)${R}(?!\\s*\\d)${HALF}?)`, (m, a) => {
    if (/(?:in|peste|cu|by|within|after|dupa|at|la)\s*$/.test(S.before(a))) return false;
    const q = parseQty(m[1]);
    if (!q || q.unit !== 'min') return false;
    if (!P.duration) P.duration = q;
  });

  // 9) dates
  const dateTok = (date, a, b, prefix, extra = {}) => {
    P.dates.push({ date: startOfDay(date), a, b, prefix: (prefix || '').replace(/\s+/g, ' '), ...extra });
  };
  const futureYear = (mo, d, y) => {
    if (y) return new Date(y < 100 ? 2000 + y : y, mo - 1, d);
    let dt = new Date(today.getFullYear(), mo - 1, d);
    if (dt < addDays(today, -1) && intent !== 'cancel') dt = new Date(today.getFullYear() + 1, mo - 1, d);
    return dt;
  };
  const validDM = (d, mo) => mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(new Date(2024, mo - 1, 1));
  const DPRE = `(?:(on|from|until|till|to|through|thru|by|for|starting|pe|din|de\\s+pe|de\\s+la|de|pana\\s+(?:pe|la|in)|pana|incepand\\s+cu|incepand\\s+din|in|la|between|intre)\\s+)?`;

  // ISO
  S.each(`${L}(\\d{4})-(\\d{1,2})-(\\d{1,2})${R}`, (m, a, b) => {
    if (!validDM(+m[3], +m[2])) return false;
    dateTok(new Date(+m[1], +m[2] - 1, +m[3]), a, b, '');
  });
  // day ranges with a month: "20-27 decembrie", "dec 20-27", "between 5 and 8 may"
  S.each(`${L}${DPRE}(\\d{1,2})(?:st|nd|rd|th)?\\s*(-|to|until|till|through|thru|pana\\s+(?:pe|la|in)|pana|si|and)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_ALT})\\.?(?:,?\\s+(\\d{4}))?${R}`, (m, a, b) => {
    if (/^(si|and)$/.test(m[3]) && !/^(between|intre)$/.test(m[1] || '')) return false;
    const mo = MONTHS[m[5]];
    const d1 = +m[2], d2 = +m[4];
    if (!validDM(d1, mo) || !validDM(d2, mo) || d2 < d1) return false;
    const s = futureYear(mo, d1, m[6] ? +m[6] : 0);
    P.dateRange = { start: s, end: new Date(s.getFullYear(), mo - 1, d2), a, b };
  });
  S.each(`${L}${DPRE}(${MONTH_ALT_PRE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|to|until|through|thru)\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${R}(?![:.]\\d)`, (m, a, b) => {
    const mo = MONTHS[m[2]];
    const d1 = +m[3], d2 = +m[4];
    if (!validDM(d1, mo) || !validDM(d2, mo) || d2 < d1) return false;
    const s = futureYear(mo, d1, m[5] ? +m[5] : 0);
    P.dateRange = { start: s, end: new Date(s.getFullYear(), mo - 1, d2), a, b };
  });
  // "5 December", "5th of Dec 2026", "pe 5 decembrie"
  S.each(`${L}${DPRE}(?:(?:the|data\\s+de|ziua\\s+de)\\s+)?(\\d{1,2})(?:st|nd|rd|th|-?lea|-a)?\\s*(?:of\\s+)?(${MONTH_ALT})\\.?(?:,?\\s+(\\d{4}))?${R}`, (m, a, b) => {
    const mo = MONTHS[m[3]];
    const d = +m[2];
    if (!validDM(d, mo)) return false;
    dateTok(futureYear(mo, d, m[4] ? +m[4] : 0), a, b, m[1]);
  });
  // "December 5", "Dec 5th, 2026"
  S.each(`${L}${DPRE}(${MONTH_ALT_PRE})\\.?\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${R}(?![:.]\\d)`, (m, a, b) => {
    const mo = MONTHS[m[2]];
    const d = +m[3];
    if (!validDM(d, mo)) return false;
    if (/^\s*(?:am|pm|a\.m|p\.m|h\b|o'?clock)/.test(S.after(b))) return false;
    dateTok(futureYear(mo, d, m[4] ? +m[4] : 0), a, b, m[1]);
  });
  // numeric day/month: "24/11", "24.11", "24.11.2026"
  S.each(`${L}${DPRE}(\\d{1,2})([./])(\\d{1,2})(?:\\2(\\d{2,4}))?${R}(?![:.]\\d)`, (m, a, b) => {
    const d = +m[2], mo = +m[4];
    if (!validDM(d, mo)) return false;
    const pre = m[1] || '';
    const timeCtx = /^(la|at|de la|pana la|from|until|till)$/.test(pre) || /(?:la|at|ora|@|de la|pana la)\s*$/.test(S.before(a));
    if (m[3] === '.' && !m[5] && (timeCtx || /^\s*(?:am|pm|h\b)/.test(S.after(b))) && d <= 23 && mo <= 59) return false;
    if (new RegExp(`^\\s*(?:${UNIT_WORDS})${R}(?!\\s*\\d)`, 'u').test(S.after(b))) return false;
    dateTok(futureYear(mo, d, m[5] ? +m[5] : 0), a, b, pre === 'la' ? '' : pre);
  });
  // relative days
  const REL_DAYS = [
    ['the day after tomorrow|day after tomorrow|overmorrow|poimaine|poi\\s+maine|poimiine', 2],
    ['raspoimaine', 3],
    ['tonight|tonite|diseara|deseara|in\\s+seara\\s+asta', 0, 'evening'],
    ['today(?:\'?s)?|azi|astazi|astazi|asta\\s+seara', 0],
    ['tomorrow(?:\'?s)?|tmrw|tmr|tomorow|tommorow|tommorrow|maine|miine', 1],
    ['yesterday|ieri', -1],
  ];
  for (const [src, off, dp] of REL_DAYS) {
    S.each(`${L}${DPRE}(${src})${R}`, (m, a, b) => {
      dateTok(addDays(today, off), a, b, m[1]);
      if (dp) P.dayparts.push({ part: dp, a, b });
    });
  }
  // weekdays
  const wdDate = (dow, mod) => {
    const d = isoDow(today);
    const diff = (dow - d + 7) % 7;
    if (/^(next|viitoare|viitor|urmatoare|urmator|din saptamana viitoare|de saptamana viitoare|saptamana viitoare|next week|saptamana urmatoare)$/.test(mod))
      return addDays(startOfWeek(today), 7 + dow - 1);
    if (/^(this|asta|aceasta|acesta|this week|saptamana asta|saptamana aceasta|din saptamana asta)$/.test(mod)) {
      const x = addDays(startOfWeek(today), dow - 1);
      return x < today ? addDays(x, 7) : x;
    }
    if (/^(coming|upcoming|following|the following|ce vine|care vine|urmatoarea)$/.test(mod)) return addDays(today, diff || 7);
    if (/^(last|trecuta|trecut)$/.test(mod)) return addDays(today, diff - 7 || -7);
    return addDays(today, diff);
  };
  const WD_POST = `(?:\\s+(next\\s+week|this\\s+week|viitoare|viitor|urmatoare|urmator|asta|aceasta|acesta|ce\\s+vine|care\\s+vine|trecuta|trecut|din\\s+saptamana\\s+(?:viitoare|asta)|de\\s+saptamana\\s+viitoare|saptamana\\s+(?:viitoare|asta|aceasta|urmatoare)))?`;
  S.each(`${L}${DPRE}(next\\s+week|this\\s+week|saptamana\\s+(?:viitoare|asta|aceasta|urmatoare))\\s+(?:on\\s+|pe\\s+|in\\s+)?(${WD_ALT})${R}`, (m, a, b) => {
    dateTok(wdDate(WD[m[3]], m[2].replace(/\s+/g, ' ')), a, b, m[1]);
  });
  S.each(`${L}${DPRE}(?:(next|this|coming|upcoming|the\\s+following|following|last|on|pe|in)\\s+)?(${WD_ALT})${WD_POST}${R}`, (m, a, b) => {
    const w = m[3];
    // "sun"/"sat"/"wed"/"mon" abbreviations are too ambiguous on their own
    if (/^(sun|sat|mon|wed|tue|thu|fri)$/.test(w) && !m[2] && !m[1] && !/^\s*(\d|,|$)/.test(S.after(b))) return false;
    const mod = (m[4] || m[2] || '').replace(/\s+/g, ' ');
    dateTok(wdDate(WD[w], mod === 'on' || mod === 'pe' || mod === 'in' ? '' : mod), a, b, m[1]);
  });
  // weeks / weekends / months
  S.each(`${L}${DPRE}(next\\s+weekend|weekendul\\s+(?:viitor|urmator)|this\\s+weekend|the\\s+weekend|weekendul\\s+(?:acesta|asta)|weekendul|la\\s+weekend|in\\s+weekend|weekend|next\\s+week|saptamana\\s+(?:viitoare|urmatoare)|next\\s+month|luna\\s+(?:viitoare|urmatoare)|end\\s+of\\s+(?:the\\s+)?month|(?:la\\s+)?(?:sfarsitul|finalul)\\s+lunii|end\\s+of\\s+(?:the\\s+)?week|(?:la\\s+)?(?:sfarsitul|finalul)\\s+saptamanii)${R}`, (m, a, b) => {
    const w = m[2].replace(/\s+/g, ' ');
    let d;
    if (/^next weekend|viitor|urmator$/.test(w) && /weekend/.test(w)) d = addDays(startOfWeek(today), 12);
    else if (/weekend/.test(w)) d = isoDow(today) >= 6 ? today : addDays(startOfWeek(today), 5);
    else if (/next week|saptamana (viitoare|urmatoare)/.test(w)) d = addDays(startOfWeek(today), 7);
    else if (/next month|luna/.test(w)) d = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    else if (/month|lunii/.test(w)) d = new Date(today.getFullYear(), today.getMonth(), daysInMonth(today));
    else { d = addDays(startOfWeek(today), 4); if (d < today) d = addDays(d, 7); }
    dateTok(d, a, b, m[1]);
  });
  // 10) time ranges
  S.each(`${L}(?:(from|between|de\\s+la|intre|at|la\\s+ora|la|ora|@|starting|incepand\\s+cu)\\s+)?(${ATOMN})\\s*(-|to|till|until|pana\\s+la|pana|la|and|si)\\s*(?:ora\\s+)?(${ATOMN})(?:\\s+(?:o'?clock|oclock))?${R}`, (m, a, b) => {
    const pre = (m[1] || '').replace(/\s+/g, ' ');
    const sep = m[3].replace(/\s+/g, ' ');
    const A = parseAtom(m[2]);
    const B = parseAtom(m[4]);
    if (!A || !B) return false;
    if (/^(and|si)$/.test(sep) && !/^(between|intre)$/.test(pre)) return false;
    if (sep === 'la' && !/^(from|de la)$/.test(pre)) return false;
    const strong = A.strong || B.strong;
    if (!pre && sep !== '-' && !strong) return false;
    if (new RegExp(`^\\s*(?:${UNIT_WORDS}|people|persoane|oameni|ori|times|euro|lei|ron|\\$|%)`, 'u').test(S.after(b))) return false;
    if (/^\s*(?:\.|\/)\d/.test(S.after(b))) return false;
    P.timeRange = { a: A, b: B, pos: a, end: b };
  });

  // 11) single times
  const pushTime = (atom, a, b, prefix) => {
    P.times.push({ ...atom, a, b, prefix: (prefix || '').replace(/\s+/g, ' ') });
  };
  S.each(`${L}(?:(${TPREFIX})\\s+)?(half|quarter|\\d{1,2})\\s+(past|after|to|till)\\s+(\\d{1,2})${R}`, (m, a, b) => {
    if (/^(to|till)$/.test(m[3]) && !/^(half|quarter)$/.test(m[2])) return false;
    let h = +m[4];
    let mi = m[2] === 'half' ? 30 : m[2] === 'quarter' ? 15 : +m[2];
    if (h > 12 || mi > 59) return false;
    if (/^(to|till)$/.test(m[3])) { h = h - 1; mi = 60 - mi; }
    pushTime({ h, m: mi, ampm: null, strong: true }, a, b, m[1]);
  });
  S.each(`${L}(?:(${TPREFIX})\\s+)?(?:ora\\s+)?(\\d{1,2})\\s+(si|fara)\\s+(jumatate|un\\s+sfert|sfert|\\d{1,2})(?:\\s+(?:minute|min))?${R}`, (m, a, b) => {
    if (!m[1]) return false;
    let h = +m[2];
    const part = m[4].replace(/\s+/g, ' ');
    let mi = part === 'jumatate' ? 30 : /sfert/.test(part) ? 15 : +part;
    if (h > 23 || mi > 59) return false;
    if (m[3] === 'fara') { h = h - 1; mi = 60 - mi; if (h < 0) h = 23; }
    pushTime({ h, m: mi, ampm: null, strong: true }, a, b, m[1]);
  });
  S.each(`${L}(?:(${TPREFIX})\\s+)?(?:ora\\s+)?(\\d{1,2})(?:([:.])(\\d{2})|h(\\d{2})?)?(?:\\s*(${AMPM}))?(?:\\s+(?:o'?clock|oclock|fix))?(?![\\p{L}\\p{N}])`, (m, a, b) => {
    const pre = m[1] || '';
    let s = m[2] + (m[4] ? ':' + m[4] : m[0].match(/\dh/) ? 'h' + (m[5] || '') : '');
    let ap = m[6] || '';
    // Romanian "am" = "I have" — don't read it as a.m. when it's followed by more words.
    if (ap && /^am$/.test(ap.replace(/\./g, '')) && isRO && /\s/.test(m[0].slice(m[0].length - ap.length - 1, m[0].length - ap.length))) {
      const after = S.after(b, 4);
      if (/^\s+\S/.test(after)) {
        ap = '';
        b = b - m[6].length;
        while (b > a && /\s/.test(t[b - 1])) b--;
      }
    }
    const atom = parseAtom(s + (ap ? ' ' + ap : ''));
    if (!atom) return false;
    const oclock = /o'?clock|oclock|fix/.test(m[0]);
    if (!pre && !atom.strong && !oclock) return false;
    if (pre && /^(before|after|dupa|inainte de|by)$/.test(pre.replace(/\s+/g, ' ')) && !atom.strong) return false;
    if (new RegExp(`^\\s*(?:${UNIT_WORDS}|people|persoane|oameni|ori|times|euro|lei|ron|km|kg)${R}`, 'u').test(S.after(b))) return false;
    pushTime(atom, a, b, pre);
    return { a, b };
  });
  S.each(`${L}(?:(${TPREFIX})\\s+)?(noon|midday|midnight|lunchtime|miezul\\s+noptii|ora\\s+pranzului)${R}`, (m, a, b) => {
    pushTime(parseAtom(m[2]), a, b, m[1]);
  });

  // 11b) ordinal day of month (after times so "from 2 to 4" stays a time range): "on the 5th", "pe 5", "pe data de 12"
  S.each(`${L}(on|from|until|till|by|pe|de\\s+pe|pana\\s+pe|pana\\s+in|data\\s+de|pe\\s+data\\s+de|in\\s+data\\s+de|the)\\s+(?:the\\s+)?(\\d{1,2})(st|nd|rd|th|-?lea|-a)?${R}`, (m, a, b) => {
    const d = +m[2];
    if (d < 1 || d > 31) return false;
    if (m[1] === 'the' && !m[3]) return false;
    if (new RegExp(`^\\s*(?:${UNIT_WORDS}|[:.]\\d|am${R}|pm${R}|h${R}|o'?clock|people|persoane|oameni)`, 'u').test(S.after(b))) return false;
    let dt = new Date(today.getFullYear(), today.getMonth(), d);
    if (dt.getDate() !== d || dt < today) {
      for (let k = 1; k < 13; k++) {
        dt = new Date(today.getFullYear(), today.getMonth() + k, d);
        if (dt.getDate() === d) break;
      }
    }
    dateTok(dt, a, b, m[1] === 'the' ? '' : m[1]);
  });

  // 12) dayparts
  const DP = [
    ['morning', 'this\\s+morning|in\\s+the\\s+morning|morning|de\\s+dimineata|dimineata(?:\\s+asta)?|in\\s+dimineata\\s+asta|dis-de-dimineata'],
    ['noon', 'at\\s+lunch|lunchtime|la\\s+pranz|pe\\s+la\\s+pranz|la\\s+amiaza|pe\\s+la\\s+amiaza'],
    ['afternoon', 'this\\s+afternoon|in\\s+the\\s+afternoon|afternoon|dupa-amiaza|dupa\\s+amiaza|dupaamiaza|dupa-masa|dupa\\s+masa|dupamasa|dupa-masa'],
    ['evening', 'this\\s+evening|in\\s+the\\s+evening|evening|in\\s+seara\\s+asta|seara(?:\\s+asta)?|spre\\s+seara'],
    ['night', 'at\\s+night|noaptea|la\\s+noapte|in\\s+noaptea\\s+asta'],
  ];
  for (const [part, src] of DP) {
    S.each(`${L}(?:${src})${R}`, (m, a, b) => { P.dayparts.push({ part, a, b }); });
  }
  S.each(`${L}(?:all\\s+day|whole\\s+day|full\\s+day|the\\s+entire\\s+day|toata\\s+ziua|intreaga\\s+zi|zi\\s+intreaga|toata\\s+ziua)${R}`, () => { P.allDay = true; });

  // 13) explicit location "@ Place"
  S.each(`@\\s*(?![\\d\\s])([^,;\\n]+)`, (m, a, b) => {
    P.location = raw.slice(a + 1, b).trim();
  });

  // ------------------------------------------------------------ text pieces
  const pieces = buildPieces(S);
  const { title, notes, location, queryTokens } = splitTitle(pieces, S, intent);
  if (!P.location && location) P.location = location;

  // ------------------------------------------------------------ resolve times
  const ctxOpts = {
    guessPM: settings.guessPM !== false,
    alarmCtx: P.alarmCtx && !P.times.length && !P.timeRange,
    eveningCtx: EVENING_CTX.test(t),
    morningCtx: MORNING_CTX.test(t),
  };
  const globalDaypart = P.dayparts.length ? P.dayparts[0].part : null;
  // attach dayparts that directly follow a time ("la 8 seara", "7 in the evening")
  for (const tm of P.times) {
    const dp = P.dayparts.find((d) => d.a >= tm.b && /^\s*$/.test(t.slice(tm.b, d.a)));
    if (dp) tm.daypart = dp.part;
  }
  if (P.timeRange) {
    const dp = P.dayparts.find((d) => d.a >= P.timeRange.end && /^\s*$/.test(t.slice(P.timeRange.end, d.a)));
    if (dp) P.timeRange.daypart = dp.part;
  }

  const resolve = (atom, extra = {}) => resolveHour(atom, { ...ctxOpts, daypart: atom.daypart || globalDaypart, ...extra });

  const out = {
    intent, weak: P.weak, raw, title, notes, location: P.location, queryTokens,
    series: P.series, warnings: [],
  };

  // dates: pick range / first / second
  P.dates.sort((x, y) => x.a - y.a);
  const isToWord = (p) => /^(to|until|till|through|thru|pana|pana pe|pana la|pana in)$/.test(p);
  let dRange = P.dateRange ? { start: P.dateRange.start, end: P.dateRange.end } : null;
  let rangeFromPair = false;
  if (!dRange && P.dates.length >= 2) {
    const [A, B] = P.dates;
    const gap = t.slice(A.b, B.a);
    if (isToWord(B.prefix) || /^\s*-\s*$/.test(gap)) {
      if (!(P.repeat && isToWord(B.prefix))) {
        dRange = { start: A.date, end: B.date };
        rangeFromPair = /^(from|de|de pe|de la|din|between|intre)$/.test(A.prefix) || isToWord(B.prefix);
        if (dRange.end < dRange.start) {
          const wk = addDays(dRange.end, 7);
          dRange.end = wk >= dRange.start ? wk : new Date(dRange.end.getFullYear() + 1, dRange.end.getMonth(), dRange.end.getDate());
        }
      }
    }
  }
  if (P.repeat) {
    const u = P.dates.find((d) => isToWord(d.prefix));
    if (u) { P.repeat.until = ymd(u.date); P.dates = P.dates.filter((d) => d !== u); }
  }

  // time of day
  let st = null, et = null, endNextDay = false;
  if (P.timeRange) {
    const rr = resolveRange(P.timeRange.a, P.timeRange.b, { ...ctxOpts, daypart: P.timeRange.daypart || globalDaypart });
    st = rr.s; et = rr.e; endNextDay = rr.nextDay;
  } else if (P.times.length) {
    st = resolve(P.times[0]);
    if (P.times.length >= 2 && (isToWord(P.times[1].prefix) || dRange)) {
      et = resolve(P.times[1], { guessPM: false });
      if (!P.times[1].ampm && et.h < 12 && toMin(et) <= toMin(st) && et.h + 12 < 24 && !dRange) et = { h: et.h + 12, m: et.m };
      if (!dRange && toMin(et) <= toMin(st)) endNextDay = true;
    }
  }
  const dpDefault = !st && globalDaypart && !P.allDay ? DAYPART_DEFAULT[globalDaypart] : null;

  // alarm with an absolute time and no other time: the alarm time *is* the event time
  const absAlarm = P.alarms.find((x) => x.kind === 'abs');
  if (absAlarm) absAlarm.time = resolveHour(absAlarm.atom, { ...ctxOpts, alarmCtx: true, daypart: absAlarm.atom.daypart || globalDaypart });
  if (!st && !dpDefault && absAlarm && intent === 'create') {
    st = absAlarm.time;
    absAlarm.kind = 'atTime';
  }

  out.timing = {
    dates: P.dates, dRange, rangeFromPair, st, et, endNextDay, dpDefault, rel: P.rel, shift: P.shift,
    duration: P.duration, allDayFlag: P.allDay, repeat: P.repeat,
  };
  out.reminders = P.reminders;
  out.alarms = P.alarms;
  out.wake = P.wake;

  if (intent === 'create') {
    out.draft = composeCreate(out, P, { now, today });
    if (!out.title) out.title = P.alarms.length ? (P.wake ? 'Wake up' : 'Alarm') : 'New event';
    out.draft.title = out.title;
    out.draft.notes = notes;
    out.draft.location = P.location || '';
    return out;
  }

  // ---------------------------------------------------- cancel / reschedule / edit
  let onDate = null, atTimeQ = null;
  if (intent === 'cancel' || intent === 'edit') {
    onDate = P.dates[0]?.date || (dRange ? dRange.start : null);
    if (P.timeRange) atTimeQ = st;
    else if (P.times[0]) atTimeQ = st;
  } else if (intent === 'reschedule') {
    if (P.dates.length >= 2 && !P.dateRange && (!dRange || rangeFromPair)) onDate = P.dates[0].date;
  }
  const { best, candidates, ambiguous } = findTargets(queryTokens, events, { now, today, onDate, atTime: atTimeQ });
  out.candidates = candidates;
  out.ambiguous = ambiguous;
  out.target = best || null;
  out.targetScore = best ? best.score : 0;
  out.onDate = onDate;
  out.extraNotes = extraNotes(pieces, S, best?.ev);
  out.extraNotesFor = (ev) => extraNotes(pieces, S, ev);
  if (best) finishChange(out, best, P, { now, today, onDate });
  return out;
}

// ---------------------------------------------------------------- hours

function resolveHour(atom, o) {
  let h = atom.h;
  const mi = atom.m || 0;
  if (atom.midnight) return { h: 0, m: 0, midnight: true };
  if (atom.ampm === 'pm' && h < 12) h += 12;
  else if (atom.ampm === 'am' && h === 12) h = 0;
  else if (!atom.ampm && h <= 12) {
    const dp = o.daypart;
    if (dp === 'afternoon' || dp === 'evening') { if (h < 12) h += 12; }
    else if (dp === 'night') { if (h >= 6 && h < 12) h += 12; else if (h === 12) h = 0; }
    else if (dp === 'morning') { /* keep */ }
    else if (dp === 'noon') { if (h < 6) h += 12; }
    else if (atom.lead0) { /* "05:30" is explicit */ }
    else if (o.alarmCtx || o.morningCtx) { /* keep a.m. */ }
    else if (o.eveningCtx && h >= 5 && h < 12) h += 12;
    else if (o.guessPM && h >= 1 && h <= 6) h += 12;
  }
  if (h === 24) h = 0;
  return { h, m: mi };
}

function resolveRange(A, B, o) {
  const s = resolveHour(A, o);
  let e = resolveHour(B, { ...o, guessPM: false });
  if (!A.ampm && B.ampm === 'pm' && A.h < 12 && A.h + 12 <= e.h) s.h = A.h + 12;
  if (!B.ampm && !B.lead0 && B.h <= 12 && toMin(e) <= toMin(s) && toMin({ h: e.h + 12, m: e.m }) > toMin(s) && e.h + 12 < 24) {
    e = { h: e.h + 12, m: e.m };
  }
  if (B.midnight) return { s, e: { h: 0, m: 0 }, nextDay: true };
  return { s, e, nextDay: toMin(e) <= toMin(s) };
}

// ---------------------------------------------------------------- compose create

function composeCreate(out, P, { now, today }) {
  const T = out.timing;
  let startDate = null, endDate = null;
  let st = T.st || (T.dpDefault ? { h: T.dpDefault[0], m: T.dpDefault[1] } : null);
  let et = T.et;
  let startDT = null;

  if (T.rel) {
    if (T.rel.unit === 'min') {
      startDT = addMinutes(now, T.rel.value);
      startDT = new Date(Math.round(startDT.getTime() / 300000) * 300000);
      startDT.setSeconds(0, 0);
      startDate = startOfDay(startDT);
      if (!st) st = { h: startDT.getHours(), m: startDT.getMinutes() };
    } else if (T.rel.unit === 'day') startDate = addDays(today, T.rel.value);
    else startDate = addMonths(today, T.rel.value);
  }
  if (T.dRange) { startDate = T.dRange.start; endDate = T.dRange.end; }
  else if (T.dates.length) startDate = T.dates[0].date;

  // repeat without explicit date: first matching day
  if (T.repeat && !T.dates.length && !T.dRange && !T.rel) {
    if (T.repeat.freq === 'weekly' && T.repeat.days && T.repeat.days.length) {
      for (let k = 0; k < 8; k++) {
        const d = addDays(today, k);
        if (T.repeat.days.includes(isoDow(d)) && !(k === 0 && st && atTime(d, st.h, st.m) < now)) { startDate = d; break; }
      }
    }
  }
  if (T.repeat && T.repeat.freq === 'weekly' && T.repeat.days && startDate && !T.repeat.days.includes(isoDow(startDate))) {
    T.repeat.days = [...T.repeat.days, isoDow(startDate)].sort();
  }

  let noDate = false;
  if (!startDate) {
    startDate = today;
    if (st && atTime(today, st.h, st.m) < addMinutes(now, -1)) startDate = addDays(today, 1);
    if (!st) noDate = true;
  }
  const allDay = !st || (T.allDayFlag && !T.st);
  const d = { allDay, repeat: T.repeat || null, exdates: [] };
  if (allDay) {
    d.start = ymd(startDate);
    let last = endDate && endDate > startDate ? endDate : null;
    if (!last && T.duration && T.duration.unit === 'day' && T.duration.value > 1) last = addDays(startDate, T.duration.value - 1);
    d.end = last ? ymd(last) : null;
  } else {
    const s = atTime(startDate, st.h, st.m);
    d.start = toLocal(s);
    if (et) {
      let e = atTime(endDate || startDate, et.h, et.m);
      if (e <= s) e = addDays(e, 1);
      d.end = toLocal(e);
    } else if (T.duration) {
      const e = T.duration.unit === 'min' ? addMinutes(s, T.duration.value) : addDays(s, T.duration.value);
      d.end = toLocal(e);
    } else if (endDate && endDate > startDate) {
      d.end = toLocal(atTime(endDate, st.h, st.m));
    } else d.end = null;
  }
  d.reminders = out.reminders.length ? out.reminders.map((r) => remToOffset(r, d)) : null;
  d.alarms = out.alarms.length ? out.alarms.map((a) => alarmToOffset(a, d)) : [];
  if (noDate) out.warnings.push('No date found — added for today.');
  return d;
}

export function remToOffset(r, d) {
  if (d.allDay) {
    if (r.kind === 'dayBefore') return 1440 - (r.at[0] * 60 + r.at[1]);
    if (r.kind === 'offset' && r.min >= 1440) return Math.round(r.min / 1440) * 1440 - 540;
    return -540; // 09:00 on the day
  }
  if (r.kind === 'atTime') return 0;
  if (r.kind === 'offset') return r.min;
  if (!r.eve) return 1440;
  const s = parseDate(d.start);
  const t = atTime(addDays(s, -1), r.at[0], r.at[1]);
  return Math.round((s - t) / 60000);
}

export function alarmToOffset(a, d) {
  const s = parseDate(d.start);
  if (d.allDay) {
    if (a.kind === 'abs') return -(a.time.h * 60 + a.time.m);
    if (a.kind === 'offset') return a.min - 480;
    return -480; // 08:00
  }
  if (a.kind === 'offset') return a.min;
  if (a.kind === 'abs') {
    let t = atTime(s, a.time.h, a.time.m);
    if (t > s) t = addDays(t, -1);
    return Math.round((s - t) / 60000);
  }
  return 0;
}

// ---------------------------------------------------------------- pieces / title

function buildPieces(S) {
  const out = [];
  let i = 0;
  const n = S.o.length;
  while (i < n) {
    while (i < n && S.used[i]) i++;
    let j = i;
    while (j < n && !S.used[j]) j++;
    if (j > i) {
      // split further on punctuation and note-connectors
      const seg = S.t.slice(i, j);
      const re = /[,;:\n!?]+|\s+-\s+|\.(?=\s|$)|\s+(?=(?:and\s+|si\s+)?(?:bring|need\s+to\s+bring|remember\s+to|don'?t\s+forget|because|cause|since|so\s+that|sa\s+(?:aduc|iau|duc)|de\s+luat|nu\s+uita|trebuie\s+sa\s+(?:aduc|iau|duc)|pentru\s+ca|deoarece|fiindca|ca\s+sa)\b)/g;
      let last = 0, m;
      while ((m = re.exec(seg))) {
        if (m.index > last) out.push({ a: i + last, b: i + m.index, after: m[0] });
        last = m.index + m[0].length;
        if (!m[0].length) re.lastIndex++;
      }
      if (last < seg.length) out.push({ a: i + last, b: j });
    }
    i = j;
  }
  return out;
}

const LEAD = [
  /^(?:hey|hi|ok|okay|so|um|uh|well|also|and|then|oh|btw|deci|bun|pai|si|apoi|plus|iar)\b[\s,]*/,
  /^(?:i|we)(?:'ve|\s+have)?\s+got\s+(?:to\s+)?/,
  /^(?:i|we)(?:'m|\s+am|'re|\s+are|m)\s+(?:going\s+to|gonna|planning\s+to|supposed\s+to|having|seeing)\s+/,
  /^(?:i|we)(?:'ll|\s+will|'d|\s+would)?\s+(?:have|has|need|must|should|want|wanna|gotta|plan|ought)(?:\s+to)?\s+/,
  /^(?:i|we)(?:'ll|\s+will)\s+(?:be\s+)?/,
  /^(?:there(?:'s|\s+is|\s+are|\s+will\s+be|'ll\s+be))\s+/,
  /^(?:remember|don'?t\s+forget|do\s+not\s+forget)(?:\s+(?:to|about|that|of))?\s+/,
  /^(?:add|schedule|create|put|set\s+up|setup|new|log)(?:\s+(?:in|an?|the|new|my))*(?:\s+(?:event|entry|item))?(?:\s+(?:for|called|named|about))?\s+/,
  /^(?:eu|noi)\s+/,
  /^(?:trebuie|tre|trb|ar\s+trebui|vreau|vrem|o\s+sa|am\s+de\s+gand|voi|vom)(?:\s+sa)?\s+/,
  /^(?:am|avem|e|este|exista|o\s+sa\s+am|voi\s+avea)\s+(?=\S)/,
  /^(?:merg|mergem|ma\s+duc|ne\s+ducem|plec|plecam)\s+(?:la\s+|in\s+|pe\s+|spre\s+)?/,
  /^(?:nu\s+uita|aminteste-mi|adu-mi\s+aminte)(?:\s+(?:sa|de|ca|despre))?\s+/,
  /^(?:adauga|pune|programeaza|creeaza|seteaza|noteaza)(?:-mi)?(?:\s+(?:un|o|in\s+calendar|eveniment|in))*\s+/,
  /^(?:the|a|an|my|our|un|o|niste|to|sa|ca\s+sa|la|pe|in|at|on|for|is|it|its|it's|that|this)\s+/,
  /^(?:i|we|it)\s*$/,
];
const TRAIL = /\s+(?:on|at|for|in|from|by|to|until|till|and|or|the|a|an|of|with|is|was|are|be|it|la|pe|de|din|pana|si|sau|cu|sa|ca|ora|around|about|this|next|starting|incepand|e|este|a|fost|s-a|are|o|un|my|our|-)$/;

const LEAD_LIGHT = [/^(?:and|si|then|apoi|also|plus|iar|but|dar)\s+/];

function cleanSpan(S, a, b, full = true) {
  let changed = true;
  const leads = full ? LEAD : LEAD_LIGHT;
  while (changed && a < b) {
    changed = false;
    while (a < b && /[\s,.;:\-–—"'()]/.test(S.t[a])) { a++; changed = true; }
    while (b > a && /[\s,;:\-–—"'(]/.test(S.t[b - 1])) { b--; changed = true; }
    const seg = S.t.slice(a, b);
    for (const re of leads) {
      const m = re.exec(seg);
      if (m && m[0].length && m[0].length < seg.length) { a += m[0].length; changed = true; break; }
      if (m && m[0].length === seg.length && re === leads[leads.length - 1] && full) { a = b; changed = true; break; }
    }
    const seg2 = S.t.slice(a, b);
    const tm = TRAIL.exec(seg2);
    if (tm) { b -= tm[0].length; changed = true; }
  }
  return [a, b];
}

const cap = (s) => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);
const hasLetters = (s) => /\p{L}/u.test(s);

function splitTitle(pieces, S, intent) {
  const queryTokens = [];
  const light = [];
  for (const p of pieces) {
    const [a, b] = cleanSpan(S, p.a, p.b, false);
    if (b > a && hasLetters(S.t.slice(a, b))) light.push({ a, b });
  }
  for (const p of light) queryTokens.push(...tokens(S.o.slice(p.a, p.b)));
  let title = '';
  let ti = -1;
  for (let i = 0; i < light.length && ti < 0; i++) {
    const [a, b] = cleanSpan(S, light[i].a, light[i].b, true);
    if (b > a && hasLetters(S.t.slice(a, b))) { title = S.o.slice(a, b).trim(); ti = i; }
  }
  let notesArr = light.filter((_, i) => i > ti).map((p) => S.o.slice(p.a, p.b).trim());
  // drop leftovers that are only connector words ("and", "și")
  notesArr = notesArr.filter((n) => tokens(n).length || n.split(/\s+/).length > 2);
  // "Meeting at 3 tomorrow with John" → "Meeting with John"
  if (title && notesArr.length && /^(?:with|w\/|cu|together\s+with|impreuna\s+cu|împreună\s+cu)\s+\S/i.test(notesArr[0]) && notesArr[0].split(/\s+/).length <= 4) {
    title = title + ' ' + notesArr.shift();
  }
  let location = null;
  notesArr = notesArr.filter((n) => {
    const m = /^(?:at|in|la|@)\s+(\p{Lu}[\p{L}\p{N}'’&.\- ]*)$/u.exec(n);
    if (!location && m && n.split(/\s+/).length <= 6) { location = m[1].trim(); return false; }
    return true;
  });
  if (title.length > 60) {
    const cut = title.lastIndexOf(' ', 50);
    notesArr.unshift(title.slice(cut > 20 ? cut + 1 : 50));
    title = title.slice(0, cut > 20 ? cut : 50);
  }
  return { title: cap(title), notes: notesArr.map(cap).join('\n'), location, queryTokens };
}

function extraNotes(pieces, S, ev) {
  // For reschedule/edit: pieces that don't refer to the target become notes.
  if (!ev) return '';
  const tt = tokens(ev.title + ' ' + (ev.location || ''));
  const out = [];
  pieces.forEach((p) => {
    const [a, b] = cleanSpan(S, p.a, p.b, false);
    if (b <= a) return;
    const text = S.o.slice(a, b).trim();
    const toks = tokens(text);
    if (!toks.length || !hasLetters(text)) return;
    const matched = toks.filter((q) => tt.some((x) => sim(q, x) >= 0.7)).length;
    if (matched === 0 && toks.length >= 1) out.push(cap(text.replace(/^(?:and|si|then|apoi|also|to|sa)\s+/i, '')));
    else if (matched > 0 && toks.length - matched >= 2) {
      // "dentist bring x-rays" → keep the non-matching words
      const rest = text.split(/\s+/).filter((w) => !tokens(w).some((q) => tt.some((x) => sim(q, x) >= 0.7)) && tokens(w).length);
      if (rest.length >= 2) out.push(cap(rest.join(' ')));
    }
  });
  return out.join('\n');
}

// ---------------------------------------------------------------- matching

export function findTargets(q, events, { now, today, onDate, atTime: tq }) {
  const from = onDate ? onDate : addDays(today, -1);
  const scored = [];
  for (const ev of events) {
    let occ = null;
    if (onDate) occ = occurrences(ev, onDate, addDays(onDate, 1), 2)[0] || null;
    if (!occ) {
      const list = occurrences(ev, startOfDay(now), addDays(today, 800), 2);
      occ = list[0] || null;
      if (!occ && !ev.repeat) {
        // recently passed (yesterday)
        const past = occurrences(ev, from, addDays(today, 1), 1)[0];
        if (past && occEnd(past) > addDays(now, -1)) occ = past;
      }
    }
    if (!occ) continue;
    const tt = tokens(ev.title);
    const nt = tokens((ev.notes || '') + ' ' + (ev.location || ''));
    let score = 0;
    for (const w of q) {
      let bt = 0;
      for (const x of tt) bt = Math.max(bt, sim(w, x));
      if (bt > 0) score += bt * 3;
      else {
        let bn = 0;
        for (const x of nt) bn = Math.max(bn, sim(w, x));
        score += bn * 0.8;
      }
    }
    if (onDate) score += onDate && ymd(occ.start) === ymd(onDate) ? 1.5 : -1;
    if (tq && !occ.allDay && occ.start.getHours() === tq.h && occ.start.getMinutes() === tq.m) score += 1.2;
    const daysAway = Math.max(0, dayDiff(today, occ.start));
    score += 0.3 / (1 + daysAway / 7);
    scored.push({ ev, occ, score, q: q.length });
  }
  scored.sort((a, b) => b.score - a.score);
  let best = scored[0];
  const threshold = q.length ? 2.2 : 1.5;
  if (!q.length && onDate) {
    const same = scored.filter((s) => ymd(s.occ.start) === ymd(onDate));
    if (same.length === 1) return { best: { ...same[0], score: 2.5 }, candidates: same, ambiguous: false };
    if (same.length > 1) return { best: null, candidates: same.slice(0, 6), ambiguous: true };
  }
  if (!best || best.score < threshold) {
    return { best: null, candidates: scored.filter((s) => s.score >= 1.2).slice(0, 5), ambiguous: false };
  }
  const close = scored.filter((s) => s !== best && s.score >= best.score * 0.92 && s.ev.id !== best.ev.id);
  if (close.length) return { best: null, candidates: [best, ...close].slice(0, 6), ambiguous: true };
  return { best, candidates: [best], ambiguous: false };
}

// ---------------------------------------------------------------- reschedule / cancel

export function finishChange(out, target, Pin, { now, today, onDate }) {
  const ev = target.ev;
  const occ = target.occ;
  const T = out.timing;
  out.target = target;
  if (out.intent === 'cancel') {
    out.scope = ev.repeat ? (out.series || (Pin?.nuMai && !onDate) ? 'series' : 'occurrence') : 'series';
    return out;
  }
  if (out.intent === 'edit') {
    out.change = { notesAdd: out.extraNotes };
    return out;
  }
  // reschedule
  out.scope = ev.repeat ? (out.series ? 'series' : 'occurrence') : 'series';
  const curAllDay = occ.allDay;
  const span = eventSpan(ev);
  let newStartDate = null, newEndDate = null;
  const dates = T.dates || [];
  if (T.dRange && !T.rangeFromPair) { newStartDate = T.dRange.start; newEndDate = T.dRange.end; }
  else if (T.dRange && T.rangeFromPair) newStartDate = T.dRange.end;
  else if (dates.length >= 2) newStartDate = dates[dates.length - 1].date;
  else if (dates.length === 1) newStartDate = dates[0].date;
  if (T.rel && !newStartDate) {
    if (T.rel.unit === 'day') newStartDate = addDays(today, T.rel.value);
    else if (T.rel.unit === 'month') newStartDate = addMonths(today, T.rel.value);
  }
  let st = T.st, et = T.et;
  // "move the meeting from 3 to 5": the range is old→new
  if (st && et && !curAllDay && occ.start.getHours() === st.h && occ.start.getMinutes() === st.m && !T.duration) {
    st = et; et = null;
  }
  let s, e, allDay = curAllDay;
  if (T.shift && !newStartDate && !st) {
    const sign = T.shift.sign;
    if (T.shift.unit === 'min') {
      if (curAllDay) { out.needsTime = true; return out; }
      s = addMinutes(occ.start, sign * T.shift.value);
      e = occ.end ? addMinutes(occ.end, sign * T.shift.value) : null;
    } else if (T.shift.unit === 'day') {
      s = addDays(occ.start, sign * T.shift.value);
      e = occ.end ? addDays(occ.end, sign * T.shift.value) : null;
    } else {
      s = addMonths(occ.start, sign * T.shift.value);
      e = occ.end ? new Date(s.getTime() + (occ.end - occ.start)) : null;
    }
  } else if (newStartDate || st) {
    const baseDate = newStartDate || startOfDay(occ.start);
    if (st) {
      allDay = false;
      s = atTime(baseDate, st.h, st.m);
      if (et) { e = atTime(baseDate, et.h, et.m); if (e <= s) e = addDays(e, 1); }
      else if (T.duration && T.duration.unit === 'min') e = addMinutes(s, T.duration.value);
      else if (!curAllDay && occ.end) e = new Date(s.getTime() + (occ.end - occ.start));
      else e = null;
    } else if (curAllDay) {
      s = baseDate;
      e = newEndDate ? addDays(newEndDate, 1) : addDays(baseDate, span);
    } else {
      s = atTime(baseDate, occ.start.getHours(), occ.start.getMinutes());
      e = occ.end ? new Date(s.getTime() + (occ.end - occ.start)) : null;
    }
  } else {
    out.needsTime = true;
    return out;
  }
  out.change = {
    allDay,
    start: allDay ? ymd(s) : toLocal(s),
    end: allDay ? (e && dayDiff(s, e) > 1 ? ymd(addDays(e, -1)) : null) : (e ? toLocal(e) : null),
    notesAdd: out.extraNotes,
  };
  if (allDay !== curAllDay) out.change.allDayChanged = true;
  return out;
}

/** Re-run target-specific resolution after the user picks a candidate. */
export function chooseTarget(result, cand, ctx = {}) {
  const now = ctx.now ? new Date(ctx.now) : new Date();
  const r = { ...result, ambiguous: false, needsTime: false };
  r.extraNotes = result.extraNotesFor ? result.extraNotesFor(cand.ev) : result.extraNotes;
  finishChange(r, cand, { nuMai: /\bnu\s+mai\b/.test(norm(result.raw)) }, { now, today: startOfDay(now), onDate: result.onDate });
  return r;
}

export const _test = { parseAtom, parseQty, resolveHour, sim, norm, tokens };
