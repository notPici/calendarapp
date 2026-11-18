// Alerts: computing reminder/alarm times, in-app alerts while the app is open,
// and the iOS Shortcuts bridge that hands alerts to Reminders + Clock.
import { occurrences, addDays, addMinutes, startOfDay, hm, ymd, pad, fmtDate } from './dates.js';
import { store } from './store.js';

const HORIZON_SEND = 60; // days of alerts sent to iOS
const HORIZON_CHECK = 30; // days that must be covered before we ask to resync

function alertTime(occ, offset) {
  const base = occ.allDay ? startOfDay(occ.start) : occ.start;
  return addMinutes(base, -offset);
}

/** All alerts with fire time in [from, to). */
export function alertsBetween(events, from, to) {
  const out = [];
  for (const ev of events) {
    const rem = ev.reminders || [];
    const alm = ev.alarms || [];
    if (!rem.length && !alm.length) continue;
    const offs = [...rem, ...alm];
    const maxBefore = Math.max(0, ...offs);
    const maxAfter = Math.max(0, ...offs.map((o) => -o));
    const occs = occurrences(ev, addMinutes(from, -maxAfter - 1), addMinutes(to, maxBefore + 1), 400);
    for (const occ of occs) {
      for (const [kind, list] of [['notify', rem], ['alarm', alm]]) {
        for (const off of list) {
          const at = alertTime(occ, off);
          if (at >= from && at < to) out.push({ kind, at, ev, occ, offset: off, key: `${ev.id}|${kind}|${at.getTime()}` });
        }
      }
    }
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

export function fmtOffset(off, allDay) {
  if (allDay) {
    if (off <= 0) return `on the day at ${pad(Math.floor(-off / 60))}:${pad(-off % 60)}`;
    const days = Math.ceil(off / 1440);
    const t = days * 1440 - off;
    return `${days === 1 ? '1 day' : days + ' days'} before at ${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
  }
  if (off === 0) return 'at start';
  if (off < 0) return `${fmtDur(-off)} after`;
  return `${fmtDur(off)} before`;
}

export function fmtDur(min) {
  if (min % 10080 === 0) return `${min / 10080} wk`;
  if (min % 1440 === 0) return `${min / 1440} day${min === 1440 ? '' : 's'}`;
  if (min >= 60 && min % 60 === 0) return `${min / 60} h`;
  if (min > 60) return `${Math.floor(min / 60)} h ${min % 60} min`;
  return `${min} min`;
}

export function alertLabel(a) {
  const ev = a.ev;
  if (a.occ.allDay) return ev.title;
  const when = hm(a.occ.start);
  if (a.offset > 0) return `${ev.title} · ${when} (in ${fmtDur(a.offset)})`;
  return `${ev.title} · ${when}`;
}

// ------------------------------------------------------------- sound

let audioCtx = null;
export function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* no audio */ }
}

export function beep(pattern = 'notify') {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime + 0.02;
  const notes = pattern === 'alarm'
    ? [[880, 0], [880, 0.25], [880, 0.5], [1175, 0.75], [880, 1.2], [880, 1.45], [880, 1.7], [1175, 1.95]]
    : [[880, 0], [1320, 0.16]];
  for (const [f, dt] of notes) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + dt);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + dt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.22);
    o.connect(g).connect(audioCtx.destination);
    o.start(t0 + dt);
    o.stop(t0 + dt + 0.25);
  }
}

// ------------------------------------------------------------- in-app loop

const K_FIRED = 'daybook.fired.v1';
const K_LAST = 'daybook.lastCheck.v1';

export function startAlertLoop(onFire) {
  let fired;
  try { fired = new Set(JSON.parse(localStorage.getItem(K_FIRED) || '[]')); } catch { fired = new Set(); }
  let last = Number(localStorage.getItem(K_LAST)) || Date.now();
  const tick = () => {
    if (document.hidden) return;
    const now = Date.now();
    const from = Math.max(last, now - 10 * 60000);
    const due = alertsBetween(store.events, new Date(from - 1000), new Date(now + 1000));
    for (const a of due) {
      if (fired.has(a.key)) continue;
      fired.add(a.key);
      onFire(a);
    }
    last = now;
    try {
      localStorage.setItem(K_LAST, String(now));
      localStorage.setItem(K_FIRED, JSON.stringify([...fired].slice(-300)));
    } catch { /* ignore */ }
  };
  setInterval(tick, 10000);
  document.addEventListener('visibilitychange', tick);
  setTimeout(tick, 1500);
}

export async function systemNotify(title, body, tag) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.showNotification) { await reg.showNotification(title, { body, tag, icon: 'icon-192.png', badge: 'icon-192.png' }); return true; }
    new Notification(title, { body, tag });
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------- iOS Shortcuts bridge
//
// The app keeps a record of what it last sent to iOS. Whenever the alerts it would
// send now differ (an event changed, was deleted, or a repeating event's next
// alerts moved into view), there are "pending" changes. Sending them opens the
// user's "Calendar Bridge" shortcut with a small JSON payload:
//
//   { v:1, ops:[{ id, n:[{t,d}] }], alarms:[{t,d}] }
//
//  - ops: one entry per changed event. The shortcut deletes that event's old
//    reminders (found by "daybook:<id>" in their notes) and adds the new ones.
//  - alarms: the full list of upcoming alarms. The shortcut saves it to a file;
//    a daily automation ("Calendar Arm") turns the next 24 h into Clock alarms.

const K_SENT = 'daybook.bridge.sent.v1';

function fmtD(d) {
  return `${ymd(d)} ${hm(d)}`;
}

function desiredState(now = new Date()) {
  const from = now;
  const to = addDays(now, HORIZON_SEND);
  const per = {};
  const alarms = [];
  for (const a of alertsBetween(store.events, from, to)) {
    if (a.kind === 'notify') (per[a.ev.id] ||= []).push({ t: alertLabel(a), d: fmtD(a.at) });
    else alarms.push({ t: `📅 ${a.ev.title}`, d: fmtD(a.at) });
  }
  return { per, alarms };
}

function readSent() {
  try { return JSON.parse(localStorage.getItem(K_SENT) || '{"per":{},"alarms":[]}'); } catch { return { per: {}, alarms: [] }; }
}

const itemKey = (x) => `${x.d}|${x.t}`;

function needsSync(desired, sent, now) {
  const nowS = fmtD(now);
  const checkS = fmtD(addDays(now, HORIZON_CHECK));
  const sentKeys = new Set(sent.map(itemKey));
  const desKeys = new Set(desired.map(itemKey));
  // something we want (soon) that iOS doesn't have
  if (desired.some((x) => x.d <= checkS && !sentKeys.has(itemKey(x)))) return true;
  // something iOS still has in the future that we no longer want
  if (sent.some((x) => x.d > nowS && !desKeys.has(itemKey(x)))) return true;
  return false;
}

export function bridgePending(now = new Date()) {
  const des = desiredState(now);
  const sent = readSent();
  const ids = new Set([...Object.keys(des.per), ...Object.keys(sent.per)]);
  const changed = [];
  for (const id of ids) {
    if (needsSync(des.per[id] || [], sent.per[id] || [], now)) changed.push(id);
  }
  const alarmsChanged = needsSync(des.alarms, sent.alarms || [], now);
  return { changed, alarmsChanged, count: changed.length + (alarmsChanged && !changed.length ? 1 : 0), des };
}

export function bridgeUrl({ all = false } = {}) {
  const now = new Date();
  const p = bridgePending(now);
  const ids = all ? [...new Set([...Object.keys(p.des.per), ...Object.keys(readSent().per)])] : p.changed;
  if (!ids.length && !p.alarmsChanged && !all) return null;
  const payload = {
    v: 1,
    ops: ids.map((id) => ({ id: `daybook:${id}`, n: p.des.per[id] || [] })),
    alarms: p.des.alarms,
  };
  const name = store.settings.bridge.name || 'Calendar Bridge';
  const url = `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(JSON.stringify(payload))}`;
  const commit = () => {
    const sent = readSent();
    for (const id of ids) {
      if (p.des.per[id]?.length) sent.per[id] = p.des.per[id];
      else delete sent.per[id];
    }
    sent.alarms = p.des.alarms;
    sent.at = Date.now();
    try { localStorage.setItem(K_SENT, JSON.stringify(sent)); } catch { /* ignore */ }
  };
  return { url, commit, ops: payload.ops.length, alarms: payload.alarms.length };
}

export function bridgeTestUrl() {
  const name = store.settings.bridge.name || 'Calendar Bridge';
  const at = addMinutes(new Date(), 2);
  at.setSeconds(0, 0);
  const payload = { v: 1, ops: [{ id: 'daybook:test', n: [{ t: 'Daybook test ✓', d: fmtD(at) }] }], alarms: readSent().alarms || [] };
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(JSON.stringify(payload))}`;
}

export function bridgeLastSent() {
  return readSent().at || null;
}

export function bridgeForget() {
  try { localStorage.removeItem(K_SENT); } catch { /* ignore */ }
}

export { fmtDate };
