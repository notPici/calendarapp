import * as D from './dates.js';
import { parse, chooseTarget } from './parser.js';
import { store, newEvent, colorFor, defaultReminders, PALETTE, DEFAULT_RULES, exportData, importData, matchRule } from './store.js';
import {
  startAlertLoop, unlockAudio, beep, systemNotify, alertLabel, fmtOffset, fmtDur,
  bridgePending, bridgeUrl, bridgeTestUrl, bridgeLastSent, bridgeForget,
} from './alerts.js';

// ------------------------------------------------------------------ helpers

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
  alarm: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2.5 1.5M5.5 3.5 2.5 6.5M18.5 3.5l3 3"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M17 3l3 3-3 3"/><path d="M4 12v-2a4 4 0 0 1 4-4h12"/><path d="M7 21l-3-3 3-3"/><path d="M20 12v2a4 4 0 0 1-4 4H4"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-6-5.6-6-11a6 6 0 1 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M9 12h7M9 16h7"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/></svg>',
};

const timeLabel = (d) => D.hm(d);

function whenText(ev, { long = true } = {}) {
  const s = D.parseDate(ev.start);
  const rel = D.relDayLabel(s);
  const dateStr = rel ? `${rel}, ${D.fmtDate(s, { weekday: false })}` : D.fmtDate(s, { long });
  if (ev.allDay) {
    const e = ev.end ? D.parseDate(ev.end) : null;
    if (e && !D.sameDay(s, e)) return `${D.fmtDate(s)} – ${D.fmtDate(e)} · all-day`;
    return `${dateStr} · all-day`;
  }
  const e = ev.end ? D.parseDate(ev.end) : null;
  let t = `${dateStr} · ${timeLabel(s)}`;
  if (e) t += D.sameDay(s, e) ? `–${timeLabel(e)}` : ` → ${D.fmtDate(e)} ${timeLabel(e)}`;
  return t;
}

function alarmTimeText(ev, off) {
  const s = D.parseDate(ev.start);
  const base = ev.allDay ? D.startOfDay(s) : s;
  const at = D.addMinutes(base, -off);
  const dd = D.dayDiff(s, at);
  return `${timeLabel(at)}${dd === -1 ? ' (day before)' : dd < -1 ? ` (${-dd} days before)` : ''}`;
}

function alertChips(ev) {
  const out = [];
  for (const r of ev.reminders || []) out.push(`<span class="chip">${ICON.bell}${esc(fmtOffset(r, ev.allDay))}</span>`);
  for (const a of ev.alarms || []) out.push(`<span class="chip">${ICON.alarm}Alarm ${esc(alarmTimeText(ev, a))}</span>`);
  if (ev.repeat) out.push(`<span class="chip">${ICON.repeat}${esc(D.describeRepeat(ev.repeat))}</span>`);
  if (ev.location) out.push(`<span class="chip">${ICON.pin}${esc(ev.location)}</span>`);
  return out.join('');
}

// ------------------------------------------------------------------ state

const today0 = () => D.startOfDay(new Date());
const state = {
  tab: 'home',
  cursor: today0(),
  result: null,
  results: null,
  scopeOverride: null,
  text: '',
  homeDays: 14,
};

// ------------------------------------------------------------------ toasts

function toast(msg, { sub = '', action = null, actionLabel = '', ms = 5000, cls = '' } = {}) {
  const root = $('#toasts');
  if (cls !== 'alert') root.querySelectorAll('.toast:not(.alert)').forEach((t) => t._close && t._close());
  const el = document.createElement('div');
  el.className = `toast ${cls}`;
  el.innerHTML = `<div class="msg">${esc(msg)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>${action ? `<button>${esc(actionLabel)}</button>` : ''}`;
  root.appendChild(el);
  let left = ms;
  let last = Date.now();
  const timer = setInterval(() => {
    if (document.hidden) { last = Date.now(); return; }
    left -= Date.now() - last;
    last = Date.now();
    if (left <= 0) close();
  }, 250);
  const close = () => { clearInterval(timer); el.remove(); };
  el._close = close;
  if (action) el.querySelector('button').addEventListener('click', () => { close(); action(); });
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('.msg')) close(); });
  while (root.children.length > 3) root.firstChild.remove();
  return close;
}

// ------------------------------------------------------------------ sheets

function openSheet({ title = '', left = '', right = '', body = '', tall = false, onClose = null }) {
  $$('#toasts .toast:not(.alert)').forEach((t) => t._close && t._close());
  const root = $('#sheets');
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  const sh = document.createElement('div');
  sh.className = `sheet${tall ? ' tall' : ''}`;
  sh.setAttribute('role', 'dialog');
  sh.innerHTML = `<div class="grabber"></div><div class="sheet-h"><div>${left}</div><h3>${esc(title)}</h3><div>${right}</div></div><div class="sheet-b">${body}</div>`;
  root.append(bg, sh);
  const close = () => {
    sh.classList.add('closing');
    bg.style.opacity = '0';
    bg.style.transition = 'opacity .2s';
    setTimeout(() => { sh.remove(); bg.remove(); }, 220);
    onClose && onClose();
  };
  bg.addEventListener('click', close);
  sh._close = close;
  // swipe down on the grabber/header to close
  let y0 = null;
  const hd = sh.querySelector('.sheet-h');
  [sh.querySelector('.grabber'), hd].forEach((el) => {
    el.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
    el.addEventListener('touchend', (e) => { if (y0 != null && e.changedTouches[0].clientY - y0 > 70) close(); y0 = null; });
  });
  return sh;
}
const closeTopSheet = () => { const s = $$('#sheets .sheet:not(.closing)').pop(); if (s) s._close(); };
const closeAllSheets = () => $$('#sheets .sheet:not(.closing)').forEach((s) => s._close());

// ------------------------------------------------------------------ render root

function render() {
  $$('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  const v = $('#view');
  v.classList.toggle('tlview', state.tab === 'day' || state.tab === 'week');
  if (state.tab === 'home') renderHome(v);
  else if (state.tab === 'day') renderTimelineView(v, 1);
  else if (state.tab === 'week') renderTimelineView(v, 7);
  else if (state.tab === 'month') renderMonth(v);
  else renderSettings(v);
}

function switchTab(tab) {
  if (state.tab === tab && (tab === 'day' || tab === 'week' || tab === 'month')) state.cursor = today0();
  state.tab = tab;
  render();
  window.scrollTo(0, 0);
  if (tab === 'day' || tab === 'week') scrollTimelineToNow();
}

// ------------------------------------------------------------------ home

const EXAMPLES = [
  'dentist next tuesday at 15, bring ID',
  'gym tomorrow 7-8:30, set an alarm',
  'mâine la 8 seara cină cu Ana',
  'concediu 20-27 decembrie',
  'yoga every monday at 18:00',
  'nu mai merg la dentist',
];

function homeAgenda() {
  const now = new Date();
  const t0 = D.startOfDay(now);
  const horizon = D.addDays(t0, state.homeDays);
  const occs = D.occurrencesAll(store.events, t0, horizon);
  const days = new Map();
  const add = (key, item) => { if (!days.has(key)) days.set(key, []); days.get(key).push(item); };
  for (const o of occs) {
    if (o.allDay && o.span > 1) {
      for (let i = 0; i < o.span; i++) {
        const d = D.addDays(o.start, i);
        if (d < t0 || d >= horizon) continue;
        add(D.ymd(d), { o, part: `Day ${i + 1}/${o.span}` });
      }
    } else if (!o.allDay && o.end && !D.sameDay(o.start, D.addMinutes(o.end, -1)) && o.start < t0) {
      add(D.ymd(t0), { o, part: 'continues' });
    } else add(o.key, { o });
  }
  const flagged = store.events.filter((e) => e.needsReschedule);
  let html = '';
  if (flagged.length) {
    html += `<div class="section-h"><h2>Needs a new time</h2></div><div class="list">${flagged.map((e) => evRowFlag(e)).join('')}</div>`;
  }
  const keys = [...days.keys()].sort();
  const todayKey = D.ymd(t0);
  if (!keys.includes(todayKey)) keys.unshift(todayKey);
  if (!store.events.length) {
    return html + `<div class="empty"><h3>Your calendar is empty</h3>Type what you need to do and when, in English or Romanian.<div class="examples">${EXAMPLES.map((x) => `<button data-act="example" data-text="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>`;
  }
  for (const k of keys) {
    const d = D.parseDate(k);
    const items = days.get(k) || [];
    const rel = D.relDayLabel(d, now);
    const title = rel || D.fmtDate(d, { long: true, year: 'auto' }).split(',')[0];
    const muted = rel ? D.fmtDate(d, { weekday: true }) : D.fmtDate(d, { weekday: false });
    html += `<div class="section-h${rel === 'Today' ? ' today' : ''}"><h2>${esc(title)}</h2><span class="muted">${esc(muted)}</span></div>`;
    if (!items.length) {
      html += `<div class="list"><div class="ev-row"><div class="ev-main ev-sub">Nothing planned</div></div></div>`;
      continue;
    }
    html += `<div class="list">${items.map(({ o, part }) => evRow(o, now, part)).join('')}</div>`;
  }
  const more = D.occurrencesAll(store.events, horizon, D.addDays(horizon, 120)).length;
  if (more) html += `<div style="text-align:center;margin-top:18px"><button class="pillbtn" data-act="more">Show more · ${state.homeDays < 60 ? 'next 2 months' : 'next 6 months'}</button></div>`;
  return html;
}

function evRow(o, now, part = '') {
  const ev = o.ev;
  const c = colorFor(ev);
  const past = !o.allDay && (o.end ? o.end < now : o.start < D.addMinutes(now, -30));
  let time;
  if (o.allDay) time = '<b>all-day</b>';
  else if (part === 'continues') time = `<b>…</b><span>${o.end ? timeLabel(o.end) : ''}</span>`;
  else time = `<b>${timeLabel(o.start)}</b>${o.end ? `<span>${D.sameDay(o.start, o.end) ? timeLabel(o.end) : '→ ' + D.fmtDate(o.end, { weekday: false })}</span>` : ''}`;
  const icons = `${(ev.reminders || []).length ? ICON.bell : ''}${(ev.alarms || []).length ? ICON.alarm : ''}${ev.repeat ? ICON.repeat : ''}`;
  const sub = [part && part !== 'continues' ? part : '', ev.location, (ev.notes || '').split('\n')[0]].filter(Boolean).join(' · ');
  return `<button class="ev-row${past ? ' past' : ''}" data-act="open" data-id="${ev.id}" data-occ="${o.key}">
    <div class="ev-time">${time}</div><div class="ev-bar" style="background:${c}"></div>
    <div class="ev-main"><div class="ev-title"><span class="t">${esc(ev.title)}</span>${icons}</div>${sub ? `<div class="ev-sub">${esc(sub)}</div>` : ''}</div></button>`;
}

function evRowFlag(ev) {
  const c = colorFor(ev);
  return `<button class="ev-row" data-act="open" data-id="${ev.id}">
    <div class="ev-time"><b class="flag">!</b></div><div class="ev-bar" style="background:${c}"></div>
    <div class="ev-main"><div class="ev-title"><span class="t">${esc(ev.title)}</span></div><div class="ev-sub">Was ${esc(whenText(ev))} · tap to pick a new time</div></div></button>`;
}

function renderHome(v) {
  const now = new Date();
  const focused = document.activeElement && document.activeElement.id === 'smart';
  const text = $('#smart')?.value ?? state.text;
  v.innerHTML = `
    <div class="topline"><div class="left"><span class="eyebrow">${esc(D.fmtDate(now, { long: true, year: false }))}</span></div>
      <div class="right"><button class="iconbtn" data-act="new" aria-label="New event">${ICON.plus}</button></div></div>
    <h1 class="big">Daybook</h1>
    <div class="composer">
      <textarea id="smart" rows="1" placeholder="What's coming up?" enterkeyhint="send" autocomplete="off" autocapitalize="sentences"></textarea>
      <button class="send" data-act="send" aria-label="Add" disabled>${ICON.up}</button>
    </div>
    <div id="preview" class="preview"></div>
    <div id="bridgeBanner"></div>
    ${homeAgenda()}`;
  const ta = $('#smart');
  ta.value = text;
  autoGrow(ta);
  ta.addEventListener('input', () => { state.text = ta.value; state.scopeOverride = null; autoGrow(ta); schedulePreview(); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submitSmart(); }
  });
  if (focused) ta.focus();
  updatePreview();
  renderBridgeBanner();
}

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
}

let pvTimer = null;
function schedulePreview() {
  clearTimeout(pvTimer);
  pvTimer = setTimeout(updatePreview, 90);
}

function parseText(text) {
  return parse(text, { now: new Date(), events: store.events, settings: store.settings });
}

function updatePreview() {
  const box = $('#preview');
  const btn = $('.send');
  if (!box) return;
  const lines = state.text.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!lines.length) { box.innerHTML = ''; state.result = null; state.results = null; if (btn) btn.disabled = true; return; }
  if (lines.length > 1) {
    state.results = lines.map(parseText);
    state.result = null;
    box.innerHTML = `<div class="pcard"><div class="act create">${ICON.spark}${lines.length} commands</div>${state.results.map((r) => `<div class="when">• ${esc(shortSummary(r))}</div>`).join('')}<div class="pfoot"><span>Press return ↵ to apply all</span></div></div>`;
    if (btn) btn.disabled = false;
    return;
  }
  const prevChoice = state.result && state.result.raw === lines[0] && state.result._chosen ? state.result : null;
  state.result = prevChoice || parseText(lines[0]);
  state.results = null;
  box.innerHTML = previewCard(state.result);
  if (btn) btn.disabled = !canApply(state.result);
}

function canApply(r) {
  if (!r || r.intent === 'empty') return false;
  if (r.intent === 'create') return true;
  return !!r.target && !r.ambiguous;
}

function shortSummary(r) {
  if (r.intent === 'create') return `Add “${r.draft.title}” — ${whenText(r.draft, { long: false })}`;
  if (!r.target) return r.ambiguous ? `Which event? (${r.candidates.length} match)` : `No matching event for “${r.raw}”`;
  const t = r.target.ev.title;
  if (r.intent === 'cancel') return `Delete “${t}”`;
  if (r.intent === 'edit') return `Add note to “${t}”`;
  if (r.needsTime) return `Mark “${t}” for rescheduling`;
  return `Move “${t}” → ${whenText({ ...r.change }, { long: false })}`;
}

function previewCard(r) {
  if (r.intent === 'create') {
    const d = r.draft;
    const fakeEv = { ...d, reminders: d.reminders ?? defaultReminders(d.allDay) };
    const c = colorFor(fakeEv);
    const rule = !d.color && matchRule(d.title);
    return `<div class="pcard">
      <div class="act create">${ICON.plus}New event${rule ? ` <span class="chip" style="text-transform:none;letter-spacing:0">${esc(rule.name)}</span>` : ''}</div>
      <div class="row"><span class="dot" style="background:${c}"></span><div><div class="ttl">${esc(d.title)}</div><div class="when">${esc(whenText(d))}</div></div></div>
      ${d.notes ? `<div class="notes">${esc(d.notes)}</div>` : ''}
      <div class="chips">${alertChips(fakeEv)}</div>
      ${r.warnings.map((w) => `<div class="warnline">${esc(w)}</div>`).join('')}
      <div class="pfoot"><span>Press return ↵ to add</span><button class="textbtn" data-act="edit-draft">Edit details</button></div>
    </div>`;
  }
  const verb = { cancel: 'Delete', reschedule: 'Reschedule', edit: 'Update' }[r.intent];
  if (r.ambiguous) {
    return `<div class="pcard"><div class="act ${r.intent}">${verb} — which one?</div><div class="cands">${r.candidates.map((c, i) => `<button class="cand" data-act="choose" data-i="${i}"><span class="dot" style="background:${colorFor(c.ev)}"></span><span><b>${esc(c.ev.title)}</b><small>${esc(whenText(occAsEv(c)))}</small></span></button>`).join('')}</div></div>`;
  }
  if (!r.target) {
    const q = r.title || r.raw;
    return `<div class="pcard"><div class="act warn">${ICON.warn}${verb}</div><div class="when">I couldn't find an event matching “${esc(q)}”.${r.candidates?.length ? ' Did you mean:' : ''}</div>${r.candidates?.length ? `<div class="cands">${r.candidates.map((c, i) => `<button class="cand" data-act="choose" data-i="${i}"><span class="dot" style="background:${colorFor(c.ev)}"></span><span><b>${esc(c.ev.title)}</b><small>${esc(whenText(occAsEv(c)))}</small></span></button>`).join('')}</div>` : ''}</div>`;
  }
  const ev = r.target.ev;
  const occEv = occAsEv(r.target);
  const scope = state.scopeOverride || r.scope;
  const scopeSeg = ev.repeat && r.intent !== 'edit'
    ? `<div class="seg"><button data-act="scope" data-scope="occurrence" class="${scope === 'occurrence' ? 'on' : ''}">Only ${esc(D.fmtDate(r.target.occ.start, { weekday: true }))}</button><button data-act="scope" data-scope="series" class="${scope === 'series' ? 'on' : ''}">All repeats</button></div>` : '';
  let body = `<div class="row"><span class="dot" style="background:${colorFor(ev)}"></span><div><div class="ttl">${esc(ev.title)}</div>`;
  if (r.intent === 'cancel') body += `<div class="when"><s>${esc(whenText(occEv))}</s></div>`;
  else if (r.intent === 'reschedule' && r.needsTime) body += `<div class="when">${esc(whenText(occEv))}</div>`;
  else if (r.intent === 'reschedule') body += `<div class="when"><s>${esc(whenText(occEv, { long: false }))}</s></div><div class="when" style="color:var(--text)">→ ${esc(whenText({ ...r.change }))}</div>`;
  else body += `<div class="when">${esc(whenText(occEv))}</div>`;
  body += '</div></div>';
  const notes = r.change?.notesAdd || r.extraNotes;
  const foot = {
    cancel: 'Press return ↵ to delete',
    reschedule: r.needsTime ? 'No new time given — press return ↵, then pick one' : 'Press return ↵ to move it',
    edit: 'Press return ↵ to save',
  }[r.intent];
  return `<div class="pcard"><div class="act ${r.intent}">${verb}</div>${body}
    ${notes ? `<div class="notes">+ ${esc(notes)}</div>` : ''}
    ${r.intent === 'edit' && !notes ? '<div class="warnline">Add the note after a colon, e.g. “add note to dentist: bring x-rays”.</div>' : ''}
    ${scopeSeg}
    <div class="pfoot"><span>${esc(foot)}</span></div></div>`;
}

function occAsEv(c) {
  const o = c.occ;
  const ev = c.ev;
  if (o.allDay) return { allDay: true, start: D.ymd(o.start), end: o.span > 1 ? D.ymd(D.addDays(o.start, o.span - 1)) : null };
  return { allDay: false, start: D.toLocal(o.start), end: o.end ? D.toLocal(o.end) : null, title: ev.title };
}

// ------------------------------------------------------------------ apply

function submitSmart() {
  unlockAudio();
  const ta = $('#smart');
  if (state.results) {
    const snap = store.snapshot();
    let n = 0;
    for (const line of state.text.split('\n').map((s) => s.trim()).filter(Boolean)) {
      const r = parseText(line);
      if (canApply(r)) { applyResult(r, { silent: true }); n++; }
    }
    store.save();
    finishSmart(ta);
    toast(`${n} change${n === 1 ? '' : 's'} applied`, { action: () => { store.restore(snap); render(); }, actionLabel: 'Undo' });
    afterChange(true);
    return;
  }
  const r = state.result;
  if (!r) return;
  if (!canApply(r)) {
    if (r.ambiguous) toast('Pick which event you mean first');
    else if (r.intent !== 'create') toast("Couldn't find that event", { sub: 'Try including a word from its title' });
    return;
  }
  const snap = store.snapshot();
  const out = applyResult(r);
  store.save();
  finishSmart(ta);
  toast(out.msg, { sub: out.sub, action: () => { store.restore(snap); render(); toast('Undone'); }, actionLabel: 'Undo', ms: 6000 });
  if (out.openEditor) openEditor({ ev: out.openEditor, reschedule: true });
  afterChange(true);
}

function finishSmart(ta) {
  state.text = '';
  state.result = null;
  state.results = null;
  state.scopeOverride = null;
  if (ta) { ta.value = ''; autoGrow(ta); }
  render();
}

function appendNotes(ev, add) {
  if (!add) return;
  ev.notes = ev.notes ? `${ev.notes}\n${add}` : add;
}

function applyResult(r) {
  if (r.intent === 'create') {
    const d = r.draft;
    const ev = newEvent({ ...d, source: r.raw, reminders: d.reminders ?? defaultReminders(d.allDay) });
    store.upsert(ev);
    return { msg: `Added “${ev.title}”`, sub: whenText(ev) };
  }
  const ev = store.get(r.target.ev.id);
  if (!ev) return { msg: 'Event no longer exists' };
  const occ = r.target.occ;
  const scope = state.scopeOverride || r.scope || 'series';
  if (r.intent === 'cancel') {
    if (ev.repeat && scope === 'occurrence') {
      ev.exdates = [...new Set([...(ev.exdates || []), occ.key])];
      store.upsert(ev);
      return { msg: `Removed “${ev.title}” on ${D.fmtDate(occ.start)}`, sub: 'Other repeats are kept' };
    }
    store.remove(ev.id);
    return { msg: `Deleted “${ev.title}”` };
  }
  if (r.intent === 'edit') {
    appendNotes(ev, r.change?.notesAdd);
    store.upsert(ev);
    return { msg: `Updated “${ev.title}”`, sub: r.change?.notesAdd || '' };
  }
  // reschedule
  if (r.needsTime) {
    ev.needsReschedule = true;
    appendNotes(ev, r.extraNotes);
    store.upsert(ev);
    return { msg: `“${ev.title}” needs a new time`, sub: 'Pick one below, or type e.g. “move it to friday 10:00”', openEditor: ev };
  }
  const ch = r.change;
  if (ev.repeat && scope === 'occurrence') {
    ev.exdates = [...new Set([...(ev.exdates || []), occ.key])];
    store.upsert(ev);
    const copy = newEvent({ ...ev, repeat: null, exdates: [], allDay: ch.allDay, start: ch.start, end: ch.end, source: r.raw });
    copy.color = ev.color;
    appendNotes(copy, ch.notesAdd);
    store.upsert(copy);
    return { msg: `Moved “${ev.title}” (this time only)`, sub: whenText(copy) };
  }
  if (ev.repeat) {
    // shift the whole series by the same amount
    const oldS = occ.start;
    const newS = D.parseDate(ch.start);
    const deltaMin = Math.round((newS - oldS) / 60000);
    const deltaDays = D.dayDiff(oldS, newS);
    const s0 = D.parseDate(ev.start);
    const ns = ch.allDay ? D.addDays(D.startOfDay(s0), deltaDays) : (ev.allDay ? D.atTime(D.addDays(s0, deltaDays), newS.getHours(), newS.getMinutes()) : D.addMinutes(s0, deltaMin));
    const span = ch.end ? D.parseDate(ch.end) - newS : null;
    ev.allDay = ch.allDay;
    ev.start = ch.allDay ? D.ymd(ns) : D.toLocal(ns);
    ev.end = ch.allDay ? (ch.end ? D.ymd(D.addDays(ns, D.dayDiff(newS, D.parseDate(ch.end)))) : null) : (span != null ? D.toLocal(new Date(ns.getTime() + span)) : null);
    if (ev.repeat.freq === 'weekly' && ev.repeat.days && deltaDays % 7) {
      ev.repeat.days = [...new Set(ev.repeat.days.map((d) => ((((d - 1 + deltaDays) % 7) + 7) % 7) + 1))].sort();
    }
    ev.exdates = [];
  } else {
    ev.allDay = ch.allDay;
    ev.start = ch.start;
    ev.end = ch.end;
  }
  if (ch.allDayChanged) ev.reminders = defaultReminders(ev.allDay);
  ev.needsReschedule = false;
  appendNotes(ev, ch.notesAdd);
  store.upsert(ev);
  return { msg: `Moved “${ev.title}”`, sub: whenText(ev) };
}

// After a data change: maybe hand alerts to iOS.
function afterChange(userInitiated) {
  renderBridgeBanner();
  const b = store.settings.bridge;
  if (!b.enabled || !b.auto || !userInitiated) return;
  const p = bridgePending();
  if (p.changed.length || p.alarmsChanged) sendToIphone();
}

function sendToIphone(all = false) {
  const b = bridgeUrl({ all });
  if (!b) { toast('Your iPhone already has all alerts'); return; }
  b.commit();
  renderBridgeBanner();
  window.location.href = b.url;
}

function renderBridgeBanner() {
  const box = $('#bridgeBanner');
  if (!box) return;
  const b = store.settings.bridge;
  const hasAlerts = store.events.some((e) => (e.reminders || []).length || (e.alarms || []).length);
  if (b.enabled) {
    const p = bridgePending();
    const n = p.changed.length + (p.alarmsChanged && !p.changed.length ? 1 : 0);
    box.innerHTML = n ? `<div class="banner attn"><div class="bi">${ICON.phone}</div><div class="bt"><b>${n} alert change${n === 1 ? '' : 's'} not on your iPhone yet</b>Sends them to Reminders & Clock.</div><button class="pillbtn" data-act="bridge-send">Send</button></div>` : '';
    return;
  }
  let dismissed = false;
  try { dismissed = localStorage.getItem('daybook.bridgeHint') === '1'; } catch { /* */ }
  box.innerHTML = hasAlerts && !dismissed ? `<div class="banner"><div class="bi">${ICON.bell}</div><div class="bt"><b>Get notifications & alarms</b>Works even when Daybook is closed — 5-minute setup.</div><button class="pillbtn" data-act="bridge-setup">Set up</button></div>` : '';
}

// ------------------------------------------------------------------ timeline views

const HOUR_H = { 1: 54, 7: 46 };

function renderTimelineView(v, cols) {
  const now = new Date();
  const cur = state.cursor;
  const days = cols === 1 ? [cur] : Array.from({ length: 7 }, (_, i) => D.addDays(D.startOfWeek(cur), i));
  const H = HOUR_H[cols];
  const title = cols === 1
    ? `${D.DOW[D.isoDow(cur) - 1]} ${cur.getDate()} ${D.MONTHS_SHORT[cur.getMonth()]}`
    : weekTitle(days[0], days[6]);
  const weekDays = Array.from({ length: 7 }, (_, i) => D.addDays(D.startOfWeek(cur), i));
  const occs = D.occurrencesAll(store.events, days[0], D.addDays(days[days.length - 1], 1));

  const strip = cols === 1
    ? `<div class="strip week7">${weekDays.map((d) => `<button class="d${D.sameDay(d, now) ? ' today' : ''}${D.sameDay(d, cur) ? ' sel' : ''}" data-act="pickday" data-day="${D.ymd(d)}">${D.DOW[D.isoDow(d) - 1].slice(0, 1)}<b>${d.getDate()}</b>${dotsFor(d, occs, true)}</button>`).join('')}</div>`
    : `<div class="strip" style="--cols:7"><div></div>${days.map((d) => `<button class="d${D.sameDay(d, now) ? ' today' : ''}" data-act="dayview" data-day="${D.ymd(d)}">${D.DOW[D.isoDow(d) - 1].slice(0, 2)}<b>${d.getDate()}</b></button>`).join('')}</div>`;

  // all-day row
  const adCols = days.map((d) => {
    const items = occs.filter((o) => o.allDay && o.start <= d && o.end > d);
    return `<div class="col">${items.map((o) => `<button class="ad" data-act="open" data-id="${o.ev.id}" data-occ="${o.key}" style="background:${colorFor(o.ev)}33;color:var(--ev-text);border-left:3px solid ${colorFor(o.ev)}">${esc(o.ev.title)}</button>`).join('')}</div>`;
  }).join('');
  const hasAllDay = occs.some((o) => o.allDay);

  // timed blocks
  const colsHtml = days.map((d) => {
    const dEnd = D.addDays(d, 1);
    const items = occs.filter((o) => !o.allDay && o.start < dEnd && D.occEnd(o) > d).map((o) => {
      const s = Math.max(0, (o.start - d) / 60000);
      const e = o.end ? Math.min(1440, (o.end - d) / 60000) : s + 30;
      return { o, s, e: Math.max(e, s + 22), point: !o.end };
    });
    layoutLanes(items);
    const blocks = items.map((it) => {
      const c = colorFor(it.o.ev);
      const top = (it.s / 60) * H;
      const h = it.point ? 22 : Math.max(20, ((it.e - it.s) / 60) * H - 2);
      const left = `calc(${(it.lane / it.lanes) * 100}% + 1px)`;
      const width = `calc(${100 / it.lanes}% - 3px)`;
      const style = `top:${top}px;height:${h}px;left:${left};width:${width};background:${c}${it.point ? '40' : '30'};border-color:${c}`;
      const t = timeLabel(it.o.start);
      return `<button class="blk${it.point ? ' point' : ''}" data-act="open" data-id="${it.o.ev.id}" data-occ="${it.o.key}" style="${style}">${it.point ? `<span>${t}</span> <b>${esc(it.o.ev.title)}</b>` : `<b>${esc(it.o.ev.title)}</b><span>${t}${it.o.end ? '–' + timeLabel(it.o.end) : ''}${cols === 1 && it.o.ev.location ? ' · ' + esc(it.o.ev.location) : ''}</span>`}</button>`;
    }).join('');
    return `<div class="col${D.sameDay(d, now) ? ' today' : ''}" data-act="slot" data-day="${D.ymd(d)}" style="height:${24 * H}px">${blocks}</div>`;
  }).join('');

  const hours = Array.from({ length: 23 }, (_, i) => `<div style="top:${(i + 1) * H}px">${D.pad(i + 1)}:00</div>`).join('');
  const lines = Array.from({ length: 24 }, (_, i) => `<div style="top:${i * H}px"></div>`).join('');
  const nowIdx = days.findIndex((d) => D.sameDay(d, now));
  const nowTop = (D.minutesOfDay(now) / 60) * H;
  const nowLine = nowIdx >= 0
    ? (cols === 1 ? `<div class="nowline" style="top:${nowTop}px"></div>` : `<div class="nowline" style="top:${nowTop}px;left:calc(40px + (100% - 40px) * ${nowIdx} / 7);right:auto;width:calc((100% - 40px) / 7)"></div>`)
    : '';

  v.innerHTML = `
    <div class="tlhead">
      <div class="dhead"><h1>${esc(title)}</h1>
        <div class="right" style="display:flex;align-items:center;gap:2px">
          <button class="textbtn" data-act="today">Today</button>
          <button class="iconbtn" data-act="prev" aria-label="Previous">${ICON.left}</button>
          <button class="iconbtn" data-act="next" aria-label="Next">${ICON.right}</button>
          <button class="iconbtn" data-act="new" aria-label="New event">${ICON.plus}</button>
        </div></div>
      ${strip}
      ${hasAllDay || cols === 7 ? `<div class="allday" style="--cols:${cols}"><div class="lbl">all-day</div>${adCols}</div>` : ''}
    </div>
    <div class="tl-wrap" id="tlwrap"><div class="tl${cols === 7 ? ' week' : ''}" style="--cols:${cols}">
      <div class="hours" style="height:${24 * H}px">${hours}</div>${colsHtml}
      <div class="lines">${lines}</div>${nowLine}
    </div></div>`;
  attachSwipe($('#tlwrap'), (dir) => { shiftCursor(dir); });
}

function weekTitle(a, b) {
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${D.MONTHS_SHORT[a.getMonth()]}`;
  return `${a.getDate()} ${D.MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${D.MONTHS_SHORT[b.getMonth()]}`;
}

function dotsFor(d, occs, small) {
  const dEnd = D.addDays(d, 1);
  const list = occs.filter((o) => o.start < dEnd && D.occEnd(o) > d);
  if (!list.length) return small ? '<span class="mdots"></span>' : '';
  const max = 3;
  return `<span class="mdots">${list.slice(0, max).map((o) => `<i style="background:${colorFor(o.ev)}"></i>`).join('')}${list.length > max ? '<em>+</em>' : ''}</span>`;
}

function layoutLanes(items) {
  items.sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanesEnd = [];
    for (const it of cluster) {
      let lane = lanesEnd.findIndex((end) => end <= it.s);
      if (lane < 0) { lane = lanesEnd.length; lanesEnd.push(it.e); } else lanesEnd[lane] = it.e;
      it.lane = lane;
    }
    for (const it of cluster) it.lanes = lanesEnd.length;
    cluster = [];
  };
  for (const it of items) {
    if (cluster.length && it.s >= clusterEnd) { flush(); clusterEnd = -1; }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length) flush();
}

function scrollTimelineToNow() {
  requestAnimationFrame(() => {
    const wrap = $('#tlwrap');
    if (!wrap) return;
    const H = HOUR_H[state.tab === 'day' ? 1 : 7];
    const isToday = state.tab === 'day' ? D.sameDay(state.cursor, new Date()) : D.sameDay(D.startOfWeek(state.cursor), D.startOfWeek(new Date()));
    const hour = isToday ? Math.max(0, new Date().getHours() - 1.5) : store.settings.dayStart || 7;
    const y = wrap.getBoundingClientRect().top + window.scrollY + hour * H - ($('.tlhead')?.offsetHeight || 0);
    window.scrollTo(0, Math.max(0, y));
  });
}

function shiftCursor(dir) {
  if (state.tab === 'day') state.cursor = D.addDays(state.cursor, dir);
  else if (state.tab === 'week') state.cursor = D.addDays(state.cursor, 7 * dir);
  else if (state.tab === 'month') state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + dir, Math.min(state.cursor.getDate(), 28));
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

function attachSwipe(el, fn) {
  if (!el) return;
  let x0 = null, y0 = null;
  el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) fn(dx < 0 ? 1 : -1);
  });
}

// ------------------------------------------------------------------ month

function renderMonth(v) {
  const now = new Date();
  const cur = state.cursor;
  const first = D.startOfMonth(cur);
  const gridStart = D.startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => D.addDays(gridStart, i));
  const rows = cells[35].getMonth() !== cur.getMonth() ? 5 : 6;
  const shown = cells.slice(0, rows * 7);
  const occs = D.occurrencesAll(store.events, shown[0], D.addDays(shown[shown.length - 1], 1));
  const sel = cur;
  const selOccs = D.occurrencesAll(store.events, D.startOfDay(sel), D.addDays(D.startOfDay(sel), 1));
  v.innerHTML = `
    <div class="mhead"><h1>${D.MONTHS[cur.getMonth()]} <span>${cur.getFullYear()}</span></h1>
      <div style="display:flex;align-items:center;gap:2px">
        <button class="textbtn" data-act="today">Today</button>
        <button class="iconbtn" data-act="prev" aria-label="Previous month">${ICON.left}</button>
        <button class="iconbtn" data-act="next" aria-label="Next month">${ICON.right}</button>
        <button class="iconbtn" data-act="new" aria-label="New event">${ICON.plus}</button>
      </div></div>
    <div class="dow">${D.DOW.map((d) => `<span>${d.slice(0, 2)}</span>`).join('')}</div>
    <div class="mgrid" id="mgrid">${shown.map((d) => `<button class="mcell${d.getMonth() !== cur.getMonth() ? ' out' : ''}${D.isoDow(d) >= 6 ? ' wkend' : ''}${D.sameDay(d, now) ? ' today' : ''}${D.sameDay(d, sel) ? ' sel' : ''}" data-act="pickday" data-day="${D.ymd(d)}"><span class="n">${d.getDate()}</span>${dotsFor(d, occs, true)}</button>`).join('')}</div>
    <div class="section-h"><h2>${esc(D.relDayLabel(sel, now) || D.fmtDate(sel, { long: true }).split(',')[0])}</h2><span class="muted">${esc(D.fmtDate(sel, { weekday: !D.relDayLabel(sel, now) ? false : true }))}</span></div>
    <div class="list">${selOccs.length ? selOccs.map((o) => evRow(o, now)).join('') : `<button class="ev-row" data-act="new"><div class="ev-main ev-sub">Nothing planned — tap to add</div></button>`}</div>`;
  attachSwipe($('#mgrid'), (dir) => shiftCursor(dir));
}

// ------------------------------------------------------------------ detail sheet

function openDetail(id, occKey) {
  const ev = store.get(id);
  if (!ev) return;
  let occ = null;
  if (occKey) {
    const d = D.parseDate(occKey);
    occ = D.occurrences(ev, d, D.addDays(d, 1), 3).find((o) => o.key === occKey) || null;
  }
  const occEv = occ ? occAsEv({ ev, occ }) : ev;
  const c = colorFor(ev);
  const rule = !ev.color && matchRule(ev.title);
  const body = `
    <div class="det-title"><span class="dot" style="background:${c}"></span><h2>${esc(ev.title)}</h2></div>
    <div class="det-when">${esc(whenText(occEv))}${ev.repeat ? `<br>${esc(D.describeRepeat(ev.repeat))}` : ''}${rule ? `<br><span style="color:${c}">● ${esc(rule.name)}</span>` : ''}</div>
    ${ev.needsReschedule ? `<div class="det-actions"><button class="btn warn" data-act="det-edit" data-id="${ev.id}" data-occ="${occKey || ''}">Pick a new time</button></div>` : ''}
    ${ev.location ? `<div class="det-block"><h4>Location</h4><p>${esc(ev.location)}</p></div>` : ''}
    ${ev.notes ? `<div class="det-block"><h4>Notes</h4><p>${esc(ev.notes)}</p></div>` : ''}
    ${(ev.reminders || []).length || (ev.alarms || []).length ? `<div class="det-block"><h4>Alerts</h4><div class="chips">${(ev.reminders || []).map((r) => `<span class="chip">${ICON.bell}${esc(fmtOffset(r, ev.allDay))}</span>`).join('')}${(ev.alarms || []).map((a) => `<span class="chip">${ICON.alarm}Alarm ${esc(alarmTimeText(ev, a))}</span>`).join('')}</div></div>` : ''}
    ${ev.source ? `<div class="det-block"><h4>You typed</h4><p class="src">“${esc(ev.source)}”</p></div>` : ''}
    <div class="det-actions">
      <button class="btn" data-act="det-edit" data-id="${ev.id}" data-occ="${occKey || ''}">Edit</button>
      <button class="btn" data-act="det-dup" data-id="${ev.id}">Duplicate</button>
      ${ev.repeat && occ ? `<button class="btn danger" data-act="det-del-one" data-id="${ev.id}" data-occ="${occKey}">Delete only this one</button><button class="btn danger" data-act="det-del" data-id="${ev.id}">Delete all repeats</button>` : `<button class="btn danger" data-act="det-del" data-id="${ev.id}">Delete event</button>`}
    </div>`;
  openSheet({ title: '', left: '<button class="textbtn" data-act="close-sheet">Close</button>', right: `<button class="textbtn strong" data-act="det-edit" data-id="${ev.id}" data-occ="${occKey || ''}">Edit</button>`, body });
}

// ------------------------------------------------------------------ editor sheet

const REM_TIMED = [[0, 'At start'], [5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min'], [60, '1 h'], [120, '2 h'], [1440, '1 day'], [2880, '2 days'], [10080, '1 week']];
const REM_ALLDAY = [[-540, 'Same day 09:00'], [-480, 'Same day 08:00'], [900, 'Day before 09:00'], [240, 'Day before 20:00'], [2340, '2 days before'], [9540, '1 week before']];
const ALARM_TIMED = [[null, 'None'], [0, 'At start'], [10, '10 min'], [30, '30 min'], [60, '1 h'], [120, '2 h'], ['custom', 'Custom time']];
const ALARM_ALLDAY = [[null, 'None'], ['custom', 'At time…']];
const REPEAT_OPTS = [
  ['', 'Never'], ['daily', 'Every day'], ['weekdays', 'Every weekday'], ['weekly', 'Every week'],
  ['biweekly', 'Every 2 weeks'], ['monthly', 'Every month'], ['yearly', 'Every year'],
];

function repeatKey(r) {
  if (!r) return '';
  if (r.freq === 'weekly' && r.days && r.days.length === 5 && [1, 2, 3, 4, 5].every((x) => r.days.includes(x))) return 'weekdays';
  if (r.freq === 'weekly' && (r.interval || 1) === 2) return 'biweekly';
  if (r.freq === 'weekly' && r.days && r.days.length > 1) return 'custom';
  return r.freq;
}

function openEditor({ ev = null, occKey = null, preset = null, reschedule = false } = {}) {
  const isNew = !ev;
  const now = new Date();
  let base;
  let occ = null;
  if (ev && occKey && ev.repeat) {
    const d = D.parseDate(occKey);
    occ = D.occurrences(ev, d, D.addDays(d, 1), 2).find((o) => o.key === occKey) || null;
  }
  if (ev) base = JSON.parse(JSON.stringify(ev));
  else {
    let start = preset?.start;
    if (!start) {
      const day = state.tab === 'home' ? D.startOfDay(now) : state.cursor;
      const h = D.sameDay(day, now) ? Math.min(23, now.getHours() + 1) : 9;
      start = D.toLocal(D.atTime(day, h, 0));
    }
    base = newEvent({ title: '', allDay: !!preset?.allDay, start, end: preset?.end || null, reminders: defaultReminders(!!preset?.allDay), ...(preset || {}) });
    base.title = preset?.title || '';
  }
  // working values shown in the form (occurrence values when editing one repeat)
  let ws = D.parseDate(base.start);
  let we = base.end ? D.parseDate(base.end) : null;
  if (occ) { ws = occ.start; we = occ.allDay ? (occ.span > 1 ? D.addDays(occ.start, occ.span - 1) : null) : occ.end; }
  let allDay = base.allDay;
  let reminders = [...(base.reminders || [])];
  let alarm = (base.alarms || [])[0];
  let color = base.color;
  let scope = 'all';
  const custom = alarm != null && (allDay || !ALARM_TIMED.some(([v]) => v === alarm));
  let alarmSel = alarm == null ? null : custom ? 'custom' : alarm;
  let alarmCustomTime = alarm != null ? (() => { const s = D.parseDate(base.start); const b0 = base.allDay ? D.startOfDay(s) : s; return D.hm(D.addMinutes(b0, -alarm)); })() : '08:00';

  const sh = openSheet({
    title: isNew ? 'New Event' : 'Edit Event',
    tall: true,
    left: '<button class="textbtn" data-act="close-sheet">Cancel</button>',
    right: `<button class="textbtn strong" id="ed-save">${isNew ? 'Add' : 'Save'}</button>`,
    body: '<div class="editor" id="ed"></div>',
  });
  const root = sh.querySelector('#ed');

  const draw = () => {
    const remOpts = allDay ? REM_ALLDAY : REM_TIMED;
    const almOpts = allDay ? ALARM_ALLDAY : ALARM_TIMED;
    const rk = repeatKey(base.repeat);
    root.innerHTML = `
      ${reschedule ? '<div class="banner-inline">Pick the new date and time, then tap Save.</div>' : ''}
      ${occ ? `<div class="group" style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px"><span class="subtle" style="font-size:14px">Repeating event</span><div class="seg"><button data-sc="this" class="${scope === 'this' ? 'on' : ''}">This one</button><button data-sc="all" class="${scope === 'all' ? 'on' : ''}">All</button></div></div>` : ''}
      <input class="field-title" id="ed-title" placeholder="Title" value="${esc(base.title)}" autocomplete="off" style="margin-top:${occ || reschedule ? 14 : 4}px">
      <div class="group">
        <label class="cell"><span class="lab">All-day</span><span class="switch"><input type="checkbox" id="ed-allday" ${allDay ? 'checked' : ''}><span></span></span></label>
        <label class="cell"><span class="lab">Starts</span><input type="date" id="ed-sd" value="${D.ymd(ws)}">${allDay ? '' : `<input type="time" id="ed-st" value="${D.hm(ws)}" style="max-width:110px">`}</label>
        ${allDay
          ? `<label class="cell"><span class="lab">Ends<small>Leave as start for one day</small></span><input type="date" id="ed-ed" value="${D.ymd(we || ws)}"></label>`
          : `<label class="cell"><span class="lab">End time<small>Off = start time only</small></span><span class="switch"><input type="checkbox" id="ed-hasend" ${we ? 'checked' : ''}><span></span></span></label>
             ${we ? `<label class="cell"><span class="lab">Ends</span><input type="date" id="ed-ed" value="${D.ymd(we)}"><input type="time" id="ed-et" value="${D.hm(we)}" style="max-width:110px"></label>` : ''}`}
        <label class="cell"><span class="lab">Repeat</span><select id="ed-rep">${REPEAT_OPTS.map(([k, l]) => `<option value="${k}" ${k === rk ? 'selected' : ''}>${l}</option>`).join('')}${rk === 'custom' ? `<option value="custom" selected>${esc(D.describeRepeat(base.repeat))}</option>` : ''}</select></label>
        ${rk ? `<label class="cell"><span class="lab">Repeat until<small>Optional</small></span><input type="date" id="ed-until" value="${base.repeat?.until || ''}"></label>` : ''}
      </div>
      <div class="group-h">Color</div>
      <div class="group"><div class="swatches">
        <button data-color="" class="${!color ? 'on' : ''}" style="background:${colorFor({ ...base, color: null, title: $('#ed-title')?.value || base.title })}" title="Automatic">A</button>
        ${PALETTE.map((p) => `<button data-color="${p.c}" class="${color === p.c ? 'on' : ''}" style="background:${p.c}" aria-label="${p.name}"></button>`).join('')}
      </div></div>
      <div class="group-f">“A” picks a color from your color rules (Settings → Colors).</div>
      <div class="group-h">Notification</div>
      <div class="group"><div class="chipsel" id="ed-rem">${remOpts.map(([v, l]) => `<button data-v="${v}" class="${reminders.includes(v) ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="group-h">Alarm</div>
      <div class="group"><div class="chipsel" id="ed-alm">${almOpts.map(([v, l]) => `<button data-v="${v}" class="${String(alarmSel) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${alarmSel === 'custom' ? `<label class="cell"><span class="lab">Alarm time<small>${allDay ? 'On the day' : 'Before the start'}</small></span><input type="time" id="ed-almt" value="${alarmCustomTime}" style="max-width:100px"></label>` : ''}
      </div>
      <div class="group-h">Details</div>
      <div class="group"><label class="cell">${ICON.pin}<input type="text" id="ed-loc" placeholder="Location" value="${esc(base.location || '')}" style="text-align:left;max-width:none;flex:1;color:var(--text)"></label></div>
      <textarea class="field-notes" id="ed-notes" placeholder="Notes" style="margin-top:14px">${esc(base.notes || '')}</textarea>
      ${base.source ? `<div class="group-f">You typed: “${esc(base.source)}”</div>` : ''}
      ${!isNew ? `<div class="det-actions"><button class="btn danger" id="ed-del">Delete event</button></div>` : ''}`;
  };

  const readForm = () => {
    base.title = $('#ed-title', root).value.trim() || 'New event';
    base.location = $('#ed-loc', root).value.trim();
    base.notes = $('#ed-notes', root).value.trim();
    const sd = $('#ed-sd', root).value;
    if (sd) {
      const t = allDay ? [0, 0] : ($('#ed-st', root)?.value || '09:00').split(':').map(Number);
      ws = D.atTime(D.parseDate(sd), t[0], t[1]);
    }
    if (allDay) {
      const ed = $('#ed-ed', root)?.value;
      we = ed ? D.parseDate(ed) : null;
    } else if ($('#ed-hasend', root)?.checked) {
      const ed = $('#ed-ed', root)?.value || D.ymd(ws);
      const et = ($('#ed-et', root)?.value || D.hm(D.addMinutes(ws, 60))).split(':').map(Number);
      we = D.atTime(D.parseDate(ed), et[0], et[1]);
    } else we = null;
    const at = $('#ed-almt', root);
    if (at) alarmCustomTime = at.value || alarmCustomTime;
    const until = $('#ed-until', root);
    if (until && base.repeat) base.repeat.until = until.value || null;
  };

  draw();
  if (isNew && !preset?.title) setTimeout(() => $('#ed-title', root)?.focus(), 350);

  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'ed-allday') {
      readForm();
      allDay = t.checked;
      reminders = defaultReminders(allDay);
      alarmSel = alarmSel == null ? null : 'custom';
      if (!allDay && !D.minutesOfDay(ws)) ws = D.atTime(ws, 9, 0);
      if (allDay && we) we = D.sameDay(we, ws) ? null : we;
      draw();
    } else if (t.id === 'ed-hasend') {
      readForm();
      we = t.checked ? D.addMinutes(ws, 60) : null;
      draw();
    } else if (t.id === 'ed-rep') {
      readForm();
      const k = t.value;
      const dow = D.isoDow(ws);
      base.repeat = !k ? null
        : k === 'weekdays' ? { freq: 'weekly', interval: 1, days: [1, 2, 3, 4, 5] }
        : k === 'biweekly' ? { freq: 'weekly', interval: 2, days: [dow] }
        : k === 'weekly' ? { freq: 'weekly', interval: 1, days: [dow] }
        : k === 'custom' ? base.repeat
        : { freq: k, interval: 1 };
      draw();
    } else if (t.id === 'ed-sd' || t.id === 'ed-st') {
      // keep duration when the start moves
      const oldS = ws;
      readForm();
      if (we && !allDay) we = new Date(we.getTime() + (ws - oldS));
      if (we && allDay && we < ws) we = null;
      draw();
    }
  });
  root.addEventListener('input', (e) => {
    if (e.target.id === 'ed-title' && !color) {
      const sw = root.querySelector('.swatches button[data-color=""]');
      if (sw) sw.style.background = colorFor({ title: e.target.value, color: null });
    }
  });
  root.addEventListener('click', (e) => {
    const sc = e.target.closest('[data-sc]');
    if (sc) { readForm(); scope = sc.dataset.sc; draw(); return; }
    const col = e.target.closest('[data-color]');
    if (col) { readForm(); color = col.dataset.color || null; draw(); return; }
    const rem = e.target.closest('#ed-rem button');
    if (rem) {
      readForm();
      const v = Number(rem.dataset.v);
      reminders = reminders.includes(v) ? reminders.filter((x) => x !== v) : [...reminders, v].sort((a, b) => a - b);
      draw();
      return;
    }
    const alm = e.target.closest('#ed-alm button');
    if (alm) {
      readForm();
      const v = alm.dataset.v;
      alarmSel = v === 'null' ? null : v === 'custom' ? 'custom' : Number(v);
      if (alarmSel === 'custom' && !allDay && alarm == null) alarmCustomTime = D.hm(D.addMinutes(ws, -60));
      draw();
      return;
    }
    if (e.target.id === 'ed-del') {
      sh._close();
      deleteEvent(base.id);
    }
  });

  sh.querySelector('#ed-save').addEventListener('click', () => {
    readForm();
    if (we && !allDay && we <= ws) { toast('End must be after start'); return; }
    if (we && allDay && we < ws) { toast('End date is before the start'); return; }
    const out = { ...base };
    out.allDay = allDay;
    out.color = color;
    out.reminders = reminders;
    out.start = allDay ? D.ymd(ws) : D.toLocal(ws);
    out.end = we ? (allDay ? (D.sameDay(we, ws) ? null : D.ymd(we)) : D.toLocal(we)) : null;
    let alarmOff = null;
    if (alarmSel === 'custom') {
      const [h, m] = alarmCustomTime.split(':').map(Number);
      if (allDay) alarmOff = -(h * 60 + m);
      else {
        let t = D.atTime(ws, h, m);
        if (t > ws) t = D.addDays(t, -1);
        alarmOff = Math.round((ws - t) / 60000);
      }
    } else if (alarmSel != null) alarmOff = Number(alarmSel);
    out.alarms = alarmOff == null ? [] : [alarmOff];
    out.needsReschedule = false;
    const snap = store.snapshot();
    if (occ && scope === 'this') {
      const orig = store.get(base.id);
      orig.exdates = [...new Set([...(orig.exdates || []), occ.key])];
      store.upsert(orig);
      const single = newEvent({ ...out, repeat: null, exdates: [] });
      single.color = out.color;
      store.upsert(single);
    } else if (occ && scope === 'all') {
      // editing "all" from an occurrence: move series by the same delta
      const orig = store.get(base.id);
      const s0 = D.parseDate(orig.start);
      const delta = ws - occ.start;
      const ns = new Date(s0.getTime() + delta);
      out.start = allDay ? D.ymd(ns) : D.toLocal(ns);
      out.end = we ? (allDay ? D.ymd(new Date(D.parseDate(orig.start).getTime() + (we - occ.start))) : D.toLocal(new Date(ns.getTime() + (we - ws)))) : null;
      store.upsert(out);
    } else {
      if (out.repeat && out.repeat.freq === 'weekly' && out.repeat.days && out.repeat.days.length === 1) out.repeat.days = [D.isoDow(ws)];
      store.upsert(out);
    }
    store.save();
    closeAllSheets();
    render();
    toast(isNew ? `Added “${out.title}”` : `Saved “${out.title}”`, { sub: whenText(out), action: () => { store.restore(snap); render(); }, actionLabel: 'Undo' });
    afterChange(true);
  });
}

function deleteEvent(id, occKey = null) {
  const ev = store.get(id);
  if (!ev) return;
  const snap = store.snapshot();
  if (occKey && ev.repeat) {
    ev.exdates = [...new Set([...(ev.exdates || []), occKey])];
    store.upsert(ev);
  } else store.remove(id);
  store.save();
  closeAllSheets();
  render();
  toast(`Deleted “${ev.title}”`, { action: () => { store.restore(snap); render(); }, actionLabel: 'Undo' });
  afterChange(true);
}

// ------------------------------------------------------------------ settings

const REM_DEFAULT_OPTS = [['', 'None'], [0, 'At start'], [5, '5 min before'], [10, '10 min before'], [15, '15 min before'], [30, '30 min before'], [60, '1 hour before'], [1440, '1 day before']];
const REM_DEFAULT_ALLDAY = [['', 'None'], [-540, 'Same day 09:00'], [-480, 'Same day 08:00'], [900, 'Day before 09:00'], [240, 'Day before 20:00']];

function renderSettings(v) {
  const s = store.settings;
  const b = s.bridge;
  const p = b.enabled ? bridgePending() : null;
  const pend = p ? p.changed.length + (p.alarmsChanged && !p.changed.length ? 1 : 0) : 0;
  const last = bridgeLastSent();
  const notifPerm = 'Notification' in window ? Notification.permission : 'unsupported';
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  v.innerHTML = `
    <div class="topline"></div>
    <h1 class="big">Settings</h1>
    ${!standalone ? `<div class="banner attn"><div class="bi">${ICON.phone}</div><div class="bt"><b>Install Daybook</b>In Safari tap Share → “Add to Home Screen”. Then it works offline and gets its own icon.</div></div>` : ''}

    <div class="group-h">Appearance</div>
    <div class="group">
      <div class="cell"><span class="lab">Theme</span><div class="seg">${[['dark', 'Dark'], ['light', 'Light'], ['auto', 'Auto']].map(([k, l]) => `<button data-act="set-theme" data-v="${k}" class="${s.theme === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    </div>

    <div class="group-h">iPhone notifications & alarms</div>
    <div class="group">
      <button class="cell" data-act="bridge-setup"><span class="bi" style="color:var(--accent)">${ICON.phone}</span><span class="lab">Setup guide<small>2 shortcuts + 1 automation, about 5 minutes</small></span>${ICON.chev}</button>
      <label class="cell"><span class="lab">I've set up the shortcuts<small>Send alerts to Reminders & Clock</small></span><span class="switch"><input type="checkbox" data-set="bridge.enabled" ${b.enabled ? 'checked' : ''}><span></span></span></label>
      ${b.enabled ? `
      <label class="cell"><span class="lab">Send automatically<small>Opens Shortcuts right after each change</small></span><span class="switch"><input type="checkbox" data-set="bridge.auto" ${b.auto ? 'checked' : ''}><span></span></span></label>
      <label class="cell"><span class="lab">Shortcut name</span><input type="text" data-set="bridge.name" value="${esc(b.name)}" autocapitalize="words"></label>
      <div class="cell"><span class="lab"><span class="status-dot" style="background:${pend ? 'var(--warn)' : 'var(--ok)'}"></span>${pend ? `${pend} change${pend === 1 ? '' : 's'} waiting` : 'In sync'}<small>${last ? 'Last sent ' + D.fmtDate(new Date(last), { weekday: false }) + ' ' + D.hm(new Date(last)) : 'Nothing sent yet'}</small></span>${pend ? '<button class="pillbtn" data-act="bridge-send">Send now</button>' : ''}</div>
      <button class="cell accent" data-act="bridge-test">Send a test notification</button>
      <button class="cell accent" data-act="bridge-all">Resend everything</button>` : ''}
    </div>
    <div class="group-f">iOS doesn't let web apps schedule alerts by themselves, so Daybook hands them to your Reminders (notifications) and Clock (alarms) through Shortcuts. Everything stays on your phone.</div>

    <div class="group-h">While Daybook is open</div>
    <div class="group">
      <div class="cell"><span class="lab">In-app sound & banners<small>Plays when an alert is due and the app is on screen</small></span><button class="pillbtn" data-act="test-sound">Test</button></div>
      ${notifPerm !== 'unsupported' ? `<div class="cell"><span class="lab">System notifications<small>${notifPerm === 'granted' ? 'Allowed' : notifPerm === 'denied' ? 'Blocked in iOS Settings' : 'Not allowed yet'}</small></span>${notifPerm === 'default' ? '<button class="pillbtn" data-act="ask-notif">Allow</button>' : ''}</div>` : ''}
    </div>

    <div class="group-h">Default alerts</div>
    <div class="group">
      <label class="cell"><span class="lab">Timed events</span><select data-set="defaultReminder">${REM_DEFAULT_OPTS.map(([k, l]) => `<option value="${k}" ${String(s.defaultReminder ?? '') === String(k) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="cell"><span class="lab">All-day events</span><select data-set="defaultAllDayReminder">${REM_DEFAULT_ALLDAY.map(([k, l]) => `<option value="${k}" ${String(s.defaultAllDayReminder ?? '') === String(k) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div class="group-f">Used when you don't say “remind me …” yourself.</div>

    <div class="group-h">Colors</div>
    <div class="group">
      ${s.rules.map((r) => `<button class="cell" data-act="rule-edit" data-id="${r.id}"><span class="swatch" style="background:${r.color}"></span><span class="lab">${esc(r.name)}<small>${esc(r.keywords)}</small></span>${ICON.chev}</button>`).join('')}
      <button class="cell accent" data-act="rule-new">${ICON.plus} Add color rule</button>
      <div class="cell"><span class="lab">Everything else</span></div>
      <div class="swatches" style="padding-top:0">${PALETTE.map((p) => `<button data-act="set-defcolor" data-v="${p.c}" class="${s.defaultColor === p.c ? 'on' : ''}" style="background:${p.c}" aria-label="${p.name}"></button>`).join('')}</div>
    </div>
    <div class="group-f">Events whose title contains a keyword get that color automatically. You can still pick any color per event.</div>

    <div class="group-h">Understanding what you type</div>
    <div class="group">
      <label class="cell"><span class="lab">Read 1–6 as afternoon<small>“at 3” → 15:00. Write 03:00 for early morning.</small></span><span class="switch"><input type="checkbox" data-set="guessPM" ${s.guessPM ? 'checked' : ''}><span></span></span></label>
      <button class="cell" data-act="help"><span class="lab">Examples of what you can type</span>${ICON.chev}</button>
    </div>
    <div class="group-f">Dates like 5.12 or 5/12 are read day/month. Times are 24-hour, weeks start on Monday.</div>

    <div class="group-h">Your data</div>
    <div class="group">
      <button class="cell accent" data-act="export">Export backup</button>
      <label class="cell accent" style="cursor:pointer">Import backup<input type="file" id="importFile" accept=".json,application/json" style="display:none"></label>
      <button class="cell danger" data-act="erase">Erase all events</button>
    </div>
    <div class="group-f">${store.events.length} event${store.events.length === 1 ? '' : 's'} stored on this device only. Removing the Home Screen icon deletes them, so export a backup now and then.</div>
    <div class="group-f" style="text-align:center;margin-top:28px;color:var(--text-3)">Daybook · works offline</div>`;
  $('#importFile', v).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const n = importData(await f.text());
      toast(`Imported — ${n} new event${n === 1 ? '' : 's'}`);
      render();
      afterChange(false);
    } catch (err) {
      toast('Could not import', { sub: err.message });
    }
  });
}

function setPath(path, value) {
  const parts = path.split('.');
  let o = store.settings;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = value;
  store.saveSettings();
}

function openRuleEditor(id) {
  const isNew = !id;
  const rule = isNew ? { id: 'r-' + Date.now().toString(36), name: '', color: PALETTE[6].c, keywords: '' } : { ...store.settings.rules.find((r) => r.id === id) };
  const sh = openSheet({
    title: isNew ? 'New Color Rule' : 'Color Rule',
    left: '<button class="textbtn" data-act="close-sheet">Cancel</button>',
    right: '<button class="textbtn strong" id="rule-save">Save</button>',
    body: `<input class="field-title" id="rule-name" placeholder="Name (e.g. Work)" value="${esc(rule.name)}">
      <div class="group-h">Color</div>
      <div class="group"><div class="swatches" id="rule-sw">${PALETTE.map((p) => `<button data-c="${p.c}" class="${rule.color === p.c ? 'on' : ''}" style="background:${p.c}" aria-label="${p.name}"></button>`).join('')}</div></div>
      <div class="group-h">Keywords</div>
      <textarea class="field-notes" id="rule-kw" placeholder="gym, yoga, sală, antrenament">${esc(rule.keywords)}</textarea>
      <div class="group-f">Separate with commas. Matching ignores capitals and diacritics, and also catches word forms (“sală” matches “sala”).</div>
      ${!isNew ? '<div class="det-actions"><button class="btn danger" id="rule-del">Delete rule</button></div>' : ''}`,
  });
  sh.querySelector('#rule-sw').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    rule.color = b.dataset.c;
    sh.querySelectorAll('#rule-sw button').forEach((x) => x.classList.toggle('on', x === b));
  });
  sh.querySelector('#rule-save').addEventListener('click', () => {
    rule.name = sh.querySelector('#rule-name').value.trim() || 'Untitled';
    rule.keywords = sh.querySelector('#rule-kw').value.trim();
    const rules = store.settings.rules.filter((r) => r.id !== rule.id);
    const idx = store.settings.rules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) rules.splice(idx, 0, rule);
    else rules.push(rule);
    store.settings.rules = rules;
    store.saveSettings();
    sh._close();
    render();
  });
  sh.querySelector('#rule-del')?.addEventListener('click', () => {
    store.settings.rules = store.settings.rules.filter((r) => r.id !== rule.id);
    store.saveSettings();
    sh._close();
    render();
  });
}

function openHelp() {
  const ex = (a) => a.map((x) => `<li><code>${esc(x)}</code></li>`).join('');
  openSheet({
    title: 'What you can type',
    tall: true,
    left: '<button class="textbtn" data-act="close-sheet">Done</button>',
    body: `<div class="guide">
      <p class="note">Type naturally, in English or Romanian. The card under the box shows what will happen before you press return.</p>
      <h4>Add events</h4><ul>${ex(['dentist next tuesday at 15, bring ID', 'team offsite dec 5', 'gym tomorrow 7-8:30', 'flight to Rome 5.12 at 06:40', 'concediu 20-27 decembrie', 'mâine la 8 seara cină cu Ana', 'ședință vineri de la 10 la 12', 'call mom in 2 hours'])}</ul>
      <p class="note">Date only → all-day. Start time → marks the start. Start and end → marks the whole block. Anything after a comma becomes the notes.</p>
      <h4>Alerts & alarms</h4><ul>${ex(['… remind me 30 min before', '… remind me the day before', 'wake me up at 6:30 tomorrow', 'presentation at 10, alarm at 8', 'trezește-mă la 6', 'amintește-mi cu o oră înainte'])}</ul>
      <h4>Repeating</h4><ul>${ex(['yoga every monday and wednesday at 18', 'standup every weekday at 9:15', 'sală în fiecare luni la 7 dimineața', 'pay rent on the 1st every month'])}</ul>
      <h4>Cancel</h4><ul>${ex(["I'm not going to the dentist anymore", "can't make it to yoga tomorrow", 'nu mai merg la sală mâine', 'anulează ședința de vineri'])}</ul>
      <p class="note">For repeating events you choose “only this one” or “all repeats” in the preview.</p>
      <h4>Reschedule</h4><ul>${ex(['dentist moved to thursday 17:00, bring x-rays', 'push the meeting back an hour', 'mută dentistul joi la 17', 'amână ședința cu o zi', 'need to reschedule the dentist'])}</ul>
      <p class="note">If you don't say when, the event is flagged and Daybook asks you for the new time.</p>
      <h4>Add notes</h4><ul>${ex(['add note to dentist: bring x-rays', 'adaugă la ședință: pregătește prezentarea'])}</ul>
      <h4>Several at once</h4><p class="note">Put each on its own line — they're applied together.</p>
      <h4>Colors</h4><p class="note">Titles with keywords like “gym”, “dentist”, “ședință” get colors automatically. Change the rules in Settings → Colors.</p>
    </div>`,
  });
}

function openBridgeGuide() {
  const name = esc(store.settings.bridge.name || 'Calendar Bridge');
  openSheet({
    title: 'Notifications & alarms',
    tall: true,
    left: '<button class="textbtn" data-act="close-sheet">Done</button>',
    body: `<div class="guide">
      <p class="note">Daybook can't schedule iPhone alerts by itself (Apple doesn't allow it for web apps), so it passes them to two shortcuts you make once. Reminders shows the notifications, and the Clock app rings the alarms, all offline.</p>

      <h4>1 · Prepare</h4>
      <ol>
        <li>In <b>Reminders</b>, add a new list called <code>Daybook</code>.</li>
        <li>In <b>Settings → Apps → Shortcuts → Advanced</b>, turn on <b>Allow Deleting Without Confirmation</b>.</li>
      </ol>

      <h4>2 · Shortcut “${name}”</h4>
      <p class="note">Shortcuts app → <b>+</b> → name it exactly <code>${name}</code>. Add these actions in order (search for each by name):</p>
      <ol>
        <li><span class="act">Save File</span> — save <i>Shortcut Input</i>. Turn off <i>Ask Where to Save</i>, set path <code>daybook.json</code>, turn on <i>Overwrite If File Exists</i>.</li>
        <li><span class="act">Get Dictionary from Input</span> — input: <i>Shortcut Input</i>.</li>
        <li><span class="act">Get Dictionary Value</span> — get <i>Value</i> for <code>ops</code> in <i>Dictionary</i>.</li>
        <li><span class="act">Repeat with Each</span> — item in <i>Dictionary Value</i>. Inside the repeat:
          <ol>
            <li><span class="act">Get Dictionary Value</span> — <code>id</code> in <i>Repeat Item</i>, then <span class="act">Set Variable</span> <code>EventID</code>.</li>
            <li><span class="act">Find Reminders</span> — where <i>Notes</i> contains <i>EventID</i>.</li>
            <li><span class="act">Remove Reminders</span> — the found <i>Reminders</i>.</li>
            <li><span class="act">Get Dictionary Value</span> — <code>n</code> in <i>Repeat Item</i>.</li>
            <li><span class="act">Repeat with Each</span> — item in that value. Inside:
              <ol>
                <li><span class="act">Get Dictionary Value</span> <code>d</code> in <i>Repeat Item 2</i> → <span class="act">Get Dates from Input</span>.</li>
                <li><span class="act">Get Dictionary Value</span> <code>t</code> in <i>Repeat Item 2</i>.</li>
                <li><span class="act">Add New Reminder</span> — title: that <code>t</code> value, list: <code>Daybook</code>, turn on the alert/due time and use the <i>Dates</i> value, notes: <i>EventID</i>.</li>
              </ol></li>
          </ol></li>
        <li>After the outer repeat ends: <span class="act">Run Shortcut</span> → <code>Calendar Arm</code> (make it in step 3, then come back and pick it).</li>
      </ol>

      <h4>3 · Shortcut “Calendar Arm”</h4>
      <p class="note">This one turns alarms for the next 24 hours into real Clock alarms.</p>
      <ol>
        <li><span class="act">Get File</span> — from the Shortcuts folder, path <code>daybook.json</code>, turn off <i>Error If Not Found</i>.</li>
        <li><span class="act">Get Dictionary from Input</span> — the <i>File</i>.</li>
        <li><span class="act">Get Dictionary Value</span> — <code>alarms</code> in <i>Dictionary</i> → <span class="act">Set Variable</span> <code>Alarms</code>.</li>
        <li><span class="act">Get All Alarms</span> → <span class="act">Repeat with Each</span> → <span class="act">If</span> <i>Repeat Item</i>'s <i>Label</i> begins with <code>📅</code> → <span class="act">Delete Alarms</span> <i>Repeat Item</i> → End If / End Repeat. (Only Daybook's alarms start with 📅.)</li>
        <li><span class="act">Repeat with Each</span> item in <i>Alarms</i>:
          <ol>
            <li><span class="act">Get Dictionary Value</span> <code>d</code> in <i>Repeat Item</i> → <span class="act">Get Dates from Input</span> → <span class="act">Set Variable</span> <code>When</code>.</li>
            <li><span class="act">Get Time Between Dates</span> — between <i>Current Date</i> and <i>When</i>, in <b>Minutes</b>.</li>
            <li><span class="act">If</span> <i>Time Between Dates</i> is between <code>0</code> and <code>1440</code>:
              <span class="act">Get Dictionary Value</span> <code>t</code> in <i>Repeat Item</i> → <span class="act">Add Alarm</span> (also called <i>Create Alarm</i>) at <i>When</i>, label: that <code>t</code> value. Turn off <i>Open When Run</i> if you see it.</li>
          </ol></li>
      </ol>

      <h4>4 · Daily automation</h4>
      <ol>
        <li>Shortcuts → <b>Automation</b> → <b>+</b> → <b>Time of Day</b> → <code>00:05</code>, <i>Daily</i>, <b>Run Immediately</b>.</li>
        <li>Action: <span class="act">Run Shortcut</span> → <code>Calendar Arm</code>.</li>
      </ol>
      <p class="note">Clock alarms have no date, only a time, so this sets each day's alarms just after midnight. Alarms in the next 24 hours are set right away whenever you change something.</p>

      <h4>5 · Turn it on</h4>
      <ol>
        <li>Back in Daybook: Settings → turn on <b>I've set up the shortcuts</b>.</li>
        <li>Tap <b>Send a test notification</b>. Shortcuts opens and runs; tap “◀ Daybook” at the top-left to come back. You should get a “Daybook test ✓” reminder about 2 minutes later.</li>
      </ol>
      <p class="note">From then on, each time you add, move or delete an event with an alert, Daybook opens Shortcuts for a second to update iOS. If you turn off <i>Send automatically</i>, a “Send” banner appears on Home instead.</p>

      <h4>Troubleshooting</h4>
      <ul>
        <li>“Shortcut not found”: the name in Settings must match the shortcut exactly.</li>
        <li>Nothing arrives: check that Reminders notifications are allowed in iOS Settings, and that the reminder's alert time is set from the <i>Dates</i> value.</li>
        <li>If iOS asks before deleting each time, re-check the setting in step 1.</li>
        <li>On iOS 26.2 and later you can also mark reminders in the Daybook list as <i>Urgent</i> to make them ring like alarms.</li>
      </ul>
      <h4>What gets sent</h4>
      <pre>{"v":1,"ops":[{"id":"daybook:…","n":[{"t":"Dentist · 15:00 (in 15 min)","d":"2026-11-24 14:45"}]}],"alarms":[{"t":"📅 Gym","d":"2026-11-19 06:00"}]}</pre>
    </div>`,
  });
}

// ------------------------------------------------------------------ alerts while open

function onAlert(a) {
  if (a.kind === 'alarm') {
    showAlarm(a);
    return;
  }
  beep('notify');
  const title = a.ev.title;
  const sub = a.occ.allDay ? whenText(a.ev) : `${timeLabel(a.occ.start)}${a.offset > 0 ? ` · in ${fmtDur(a.offset)}` : ' · now'}`;
  toast(`🔔 ${title}`, { sub, cls: 'alert', ms: 15000, action: () => openDetail(a.ev.id, a.occ.key), actionLabel: 'Open' });
  systemNotify(title, sub, a.key);
}

function showAlarm(a) {
  const el = document.createElement('div');
  el.className = 'alarm-full';
  el.innerHTML = `<div class="clock">${D.hm(new Date())}</div><h2>${esc(a.ev.title)}</h2><div class="subtle" style="color:#bbb">${esc(a.occ.allDay ? 'Today' : 'Starts ' + timeLabel(a.occ.start))}</div><button>Stop</button><button class="snooze">Snooze 9 min</button>`;
  document.body.appendChild(el);
  beep('alarm');
  const iv = setInterval(() => beep('alarm'), 2600);
  const stop = () => { clearInterval(iv); el.remove(); };
  setTimeout(stop, 90000);
  el.querySelector('button').addEventListener('click', stop);
  el.querySelector('.snooze').addEventListener('click', () => {
    stop();
    setTimeout(() => showAlarm(a), 9 * 60000);
    toast('Snoozed for 9 minutes', { sub: 'Keep Daybook open for the snooze to ring' });
  });
  systemNotify(`⏰ ${a.ev.title}`, a.occ.allDay ? 'Today' : `Starts ${timeLabel(a.occ.start)}`, a.key);
}

// ------------------------------------------------------------------ events

document.addEventListener('click', (e) => {
  unlockAudio();
  const tab = e.target.closest('[data-tab]');
  if (tab) { switchTab(tab.dataset.tab); return; }
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  switch (act) {
    case 'send': submitSmart(); break;
    case 'example': {
      const ta = $('#smart');
      ta.value = t.dataset.text;
      state.text = ta.value;
      autoGrow(ta);
      updatePreview();
      ta.focus();
      break;
    }
    case 'choose': {
      const r = state.result;
      const cand = r?.candidates?.[Number(t.dataset.i)];
      if (!cand) break;
      const nr = chooseTarget(r, cand, { now: new Date() });
      nr._chosen = true;
      state.result = nr;
      $('#preview').innerHTML = previewCard(nr);
      $('.send').disabled = !canApply(nr);
      break;
    }
    case 'scope':
      state.scopeOverride = t.dataset.scope;
      $('#preview').innerHTML = previewCard(state.result);
      break;
    case 'edit-draft': {
      const d = state.result?.draft;
      if (!d) break;
      openEditor({ preset: { ...d, reminders: d.reminders ?? defaultReminders(d.allDay), source: state.result.raw } });
      finishSmart($('#smart'));
      break;
    }
    case 'new': openEditor(); break;
    case 'more': { const y = window.scrollY; state.homeDays = state.homeDays < 60 ? 60 : 180; render(); window.scrollTo(0, y); break; }
    case 'open': openDetail(t.dataset.id, t.dataset.occ || null); break;
    case 'close-sheet': closeTopSheet(); break;
    case 'det-edit': {
      const ev = store.get(t.dataset.id);
      closeAllSheets();
      setTimeout(() => openEditor({ ev, occKey: t.dataset.occ || null, reschedule: !!ev?.needsReschedule }), 230);
      break;
    }
    case 'det-dup': {
      const ev = store.get(t.dataset.id);
      if (!ev) break;
      const copy = newEvent({ ...ev, exdates: [], source: '' });
      copy.color = ev.color;
      copy.title = ev.title;
      store.upsert(copy);
      store.save();
      closeAllSheets();
      render();
      toast(`Duplicated “${ev.title}”`);
      setTimeout(() => openEditor({ ev: copy }), 230);
      afterChange(false);
      break;
    }
    case 'det-del': deleteEvent(t.dataset.id); break;
    case 'det-del-one': deleteEvent(t.dataset.id, t.dataset.occ); break;
    case 'prev': shiftCursor(-1); break;
    case 'next': shiftCursor(1); break;
    case 'today': state.cursor = today0(); render(); if (state.tab !== 'month') scrollTimelineToNow(); break;
    case 'pickday': {
      const y = window.scrollY;
      state.cursor = D.parseDate(t.dataset.day);
      render();
      window.scrollTo(0, y);
      break;
    }
    case 'dayview': state.cursor = D.parseDate(t.dataset.day); switchTab('day'); break;
    case 'slot': {
      if (e.target.closest('.blk')) break;
      const rect = t.getBoundingClientRect();
      const H = HOUR_H[state.tab === 'day' ? 1 : 7];
      const min = Math.max(0, Math.min(23 * 60 + 30, Math.floor(((e.clientY - rect.top) / H) * 2) * 30));
      const day = D.parseDate(t.dataset.day);
      const s = D.addMinutes(day, min);
      openEditor({ preset: { start: D.toLocal(s), end: D.toLocal(D.addMinutes(s, 60)), allDay: false } });
      break;
    }
    case 'bridge-send': sendToIphone(); break;
    case 'bridge-all': sendToIphone(true); break;
    case 'bridge-setup':
      try { localStorage.setItem('daybook.bridgeHint', '1'); } catch { /* */ }
      openBridgeGuide();
      renderBridgeBanner();
      break;
    case 'bridge-test': window.location.href = bridgeTestUrl(); break;
    case 'test-sound': unlockAudio(); setTimeout(() => beep('notify'), 50); toast('🔔 This is how alerts sound', { sub: 'Make sure your phone isn’t on silent' }); break;
    case 'ask-notif':
      Notification.requestPermission().then(() => render());
      break;
    case 'set-theme':
      store.settings.theme = t.dataset.v;
      store.saveSettings();
      document.documentElement.setAttribute('data-theme', t.dataset.v);
      render();
      break;
    case 'set-defcolor': store.settings.defaultColor = t.dataset.v; store.saveSettings(); render(); break;
    case 'rule-edit': openRuleEditor(t.dataset.id); break;
    case 'rule-new': openRuleEditor(null); break;
    case 'help': openHelp(); break;
    case 'export': doExport(); break;
    case 'erase':
      if (confirm('Delete all events from this device? This cannot be undone (unless you have a backup).')) {
        store.events = [];
        store.save();
        render();
        toast('All events erased');
        afterChange(false);
      }
      break;
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (!t.dataset || !t.dataset.set) return;
  const path = t.dataset.set;
  let val;
  if (t.type === 'checkbox') val = t.checked;
  else if (t.tagName === 'SELECT') val = t.value === '' ? null : Number(t.value);
  else val = t.value.trim();
  setPath(path, val);
  if (path === 'bridge.enabled' && val) {
    toast('Alerts will now go to your iPhone', { sub: 'Try “Send a test notification”' });
  }
  if (path === 'bridge.enabled' || path === 'bridge.auto') render();
});

async function doExport() {
  const data = exportData();
  const name = `daybook-backup-${D.ymd(new Date())}.json`;
  try {
    const file = new File([data], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Daybook backup' });
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// keep "now" fresh
setInterval(() => {
  if (document.hidden) return;
  if ($('#sheets .sheet')) return;
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT' || ae.tagName === 'SELECT')) return;
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}, 60000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    const ae = document.activeElement;
    if (!(ae && ae.id === 'smart')) { const y = window.scrollY; render(); window.scrollTo(0, y); }
  }
});

// ------------------------------------------------------------------ boot

render();
startAlertLoop(onAlert);

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('Daybook was updated', { action: () => location.reload(), actionLabel: 'Reload', ms: 15000 });
  });
}
try { navigator.storage?.persist?.(); } catch { /* */ }

// expose for debugging in the console
window.daybook = { store, parse: parseText };
