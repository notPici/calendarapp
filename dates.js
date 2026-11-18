// Local-time date helpers. Events are stored as floating local times:
//   all-day:  "YYYY-MM-DD"
//   timed:    "YYYY-MM-DDTHH:mm"

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const toLocal = (d) => `${ymd(d)}T${hm(d)}`;

export function parseDate(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
}

export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => {
  const r = new Date(d.getTime());
  r.setDate(r.getDate() + n);
  return r;
};
export const addMinutes = (d, n) => new Date(d.getTime() + n * 60000);
export const daysInMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
export function addMonths(d, n, strict = false) {
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes());
  const dim = daysInMonth(r);
  if (strict && d.getDate() > dim) return null;
  r.setDate(Math.min(d.getDate(), dim));
  return r;
}
export const isoDow = (d) => ((d.getDay() + 6) % 7) + 1; // Mon=1 … Sun=7
export const startOfWeek = (d) => addDays(startOfDay(d), 1 - isoDow(d));
export const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const dayDiff = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
export const atTime = (d, h, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
export const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes();

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DOW_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function fmtDate(d, { long = false, year = 'auto', weekday = true } = {}) {
  const wd = weekday ? (long ? DOW_LONG : DOW)[isoDow(d) - 1] + (long ? ', ' : ' ') : '';
  const mo = (long ? MONTHS : MONTHS_SHORT)[d.getMonth()];
  const showYear = year === true || (year === 'auto' && d.getFullYear() !== new Date().getFullYear());
  return `${wd}${d.getDate()} ${mo}${showYear ? ' ' + d.getFullYear() : ''}`;
}

export function relDayLabel(d, now = new Date()) {
  const diff = dayDiff(now, d);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return null;
}

// ---------- events & recurrence ----------

export function eventSpan(ev) {
  // all-day: number of days (>=1); timed: duration in minutes (0 = start only)
  const s = parseDate(ev.start);
  if (ev.allDay) {
    const e = ev.end ? parseDate(ev.end) : s;
    return Math.max(1, dayDiff(s, e) + 1);
  }
  if (!ev.end) return 0;
  return Math.max(0, Math.round((parseDate(ev.end) - s) / 60000));
}

function makeOcc(ev, start, span) {
  if (ev.allDay) {
    return { ev, start, end: addDays(start, span), allDay: true, key: ymd(start), span };
  }
  return { ev, start, end: span ? addMinutes(start, span) : null, allDay: false, key: ymd(start), span };
}

// Effective end used for overlap tests.
export const occEnd = (o) => (o.allDay ? o.end : o.end || addMinutes(o.start, 1));

/** All occurrences of `ev` overlapping [from, to). */
export function occurrences(ev, from, to, limit = 1500) {
  const s0 = parseDate(ev.start);
  if (!s0) return [];
  const span = eventSpan(ev);
  const out = [];
  const ex = new Set(ev.exdates || []);
  const push = (d) => {
    if (ex.has(ymd(d))) return;
    const o = makeOcc(ev, d, span);
    if (o.start < to && occEnd(o) > from) out.push(o);
  };
  const r = ev.repeat;
  if (!r) {
    push(s0);
    return out;
  }
  const interval = Math.max(1, r.interval || 1);
  const until = r.until ? addDays(parseDate(r.until), 1) : null;
  const spanMs = ev.allDay ? span * 86400000 : Math.max(span, 1) * 60000;
  const lowBound = new Date(from.getTime() - spanMs);
  const done = (d) => d >= to || (until && d >= until) || out.length >= limit;
  if (r.freq === 'daily') {
    let k = Math.max(0, Math.floor(dayDiff(s0, lowBound) / interval) * interval - interval);
    for (let guard = 0; guard < 5000; guard++, k += interval) {
      const d = addDays(s0, k);
      if (done(d)) break;
      push(d);
    }
  } else if (r.freq === 'weekly') {
    const days = r.days && r.days.length ? [...r.days].sort((a, b) => a - b) : [isoDow(s0)];
    const w0 = startOfWeek(s0);
    let w = Math.max(0, Math.floor(Math.floor(dayDiff(w0, lowBound) / 7) / interval) * interval - interval);
    outer: for (let guard = 0; guard < 3000; guard++, w += interval) {
      for (const dow of days) {
        const day = addDays(w0, w * 7 + dow - 1);
        const d = atTime(day, s0.getHours(), s0.getMinutes());
        if (d < s0) continue;
        if (done(d)) break outer;
        push(d);
      }
    }
  } else if (r.freq === 'monthly' || r.freq === 'yearly') {
    const step = r.freq === 'monthly' ? interval : 12 * interval;
    for (let k = 0, guard = 0; guard < 2400; guard++, k += step) {
      const d = addMonths(s0, k, true);
      if (!d) continue;
      if (done(d)) break;
      push(d);
    }
  }
  return out;
}

/** Occurrences of all events overlapping [from, to), sorted. */
export function occurrencesAll(events, from, to) {
  const out = [];
  for (const ev of events) out.push(...occurrences(ev, from, to));
  out.sort((a, b) => a.start - b.start || (b.allDay - a.allDay) || a.ev.title.localeCompare(b.ev.title));
  return out;
}

/** Next occurrence starting at/after `from` (or containing it). */
export function nextOccurrence(ev, from, horizonDays = 800) {
  const list = occurrences(ev, from, addDays(from, horizonDays), 3);
  return list[0] || null;
}

export function describeRepeat(r) {
  if (!r) return '';
  const n = r.interval || 1;
  let s;
  if (r.freq === 'daily') s = n === 1 ? 'Every day' : `Every ${n} days`;
  else if (r.freq === 'weekly') {
    const days = r.days && r.days.length ? r.days : null;
    const isWeekdays = days && days.length === 5 && [1, 2, 3, 4, 5].every((x) => days.includes(x));
    const isWeekend = days && days.length === 2 && days.includes(6) && days.includes(7);
    const base = n === 1 ? 'Every week' : n === 2 ? 'Every 2 weeks' : `Every ${n} weeks`;
    if (isWeekdays && n === 1) s = 'Every weekday';
    else if (isWeekend && n === 1) s = 'Every weekend';
    else if (days) s = `${base} on ${days.map((d) => DOW[d - 1]).join(', ')}`;
    else s = base;
  } else if (r.freq === 'monthly') s = n === 1 ? 'Every month' : `Every ${n} months`;
  else if (r.freq === 'yearly') s = n === 1 ? 'Every year' : `Every ${n} years`;
  else s = 'Repeats';
  if (r.until) s += ` until ${fmtDate(parseDate(r.until), { weekday: false })}`;
  return s;
}

export function uid() {
  return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);
}
