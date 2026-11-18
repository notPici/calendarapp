// Persistence (localStorage), settings, colors.
import { uid, parseDate, ymd, toLocal } from './dates.js';
import { norm, tokens } from './parser.js';

const K_EVENTS = 'daybook.events.v1';
const K_SETTINGS = 'daybook.settings.v1';

export const PALETTE = [
  { name: 'Red', c: '#FF453A' },
  { name: 'Orange', c: '#FF9F0A' },
  { name: 'Yellow', c: '#FFD60A' },
  { name: 'Green', c: '#30D158' },
  { name: 'Mint', c: '#63E6E2' },
  { name: 'Teal', c: '#40C8E0' },
  { name: 'Blue', c: '#0A84FF' },
  { name: 'Indigo', c: '#5E5CE6' },
  { name: 'Purple', c: '#BF5AF2' },
  { name: 'Pink', c: '#FF375F' },
  { name: 'Brown', c: '#AC8E68' },
  { name: 'Gray', c: '#98989D' },
];

export const DEFAULT_RULES = [
  { id: 'r-work', name: 'Work', color: '#0A84FF', keywords: 'work, meeting, call, standup, office, client, interview, deadline, ședință, sedinta, birou, muncă, serviciu, interviu, prezentare' },
  { id: 'r-health', name: 'Health', color: '#FF453A', keywords: 'doctor, dentist, hospital, clinic, therapy, pharmacy, medic, stomatolog, spital, clinică, analize, farmacie' },
  { id: 'r-fit', name: 'Fitness', color: '#30D158', keywords: 'gym, workout, run, running, yoga, training, football, tennis, swim, sală, antrenament, alergare, fotbal, tenis, înot, bicicletă' },
  { id: 'r-social', name: 'Social', color: '#FF9F0A', keywords: 'birthday, party, dinner, lunch, drinks, wedding, friends, ziua, zi de naștere, petrecere, cină, prânz, nuntă, ieșire, bere' },
  { id: 'r-travel', name: 'Travel', color: '#BF5AF2', keywords: 'flight, train, trip, vacation, holiday, airport, hotel, zbor, tren, excursie, vacanță, concediu, aeroport' },
  { id: 'r-study', name: 'Study', color: '#FFD60A', keywords: 'exam, class, lecture, course, school, homework, examen, curs, școală, seminar, laborator, teme' },
];

export const DEFAULT_SETTINGS = {
  theme: 'dark', // dark | light | auto
  guessPM: true,
  defaultReminder: 15, // minutes before; null = none
  defaultAllDayReminder: -540, // 09:00 on the day; null = none
  defaultColor: '#5E5CE6',
  rules: DEFAULT_RULES,
  bridge: { enabled: false, name: 'Calendar Bridge', auto: true },
  dayStart: 7,
};

function read(k, def) {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : def;
  } catch {
    return def;
  }
}
function write(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

const listeners = new Set();

export const store = {
  events: read(K_EVENTS, []),
  settings: { ...DEFAULT_SETTINGS, ...read(K_SETTINGS, {}) },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit() { listeners.forEach((fn) => fn()); },
  save() { write(K_EVENTS, this.events); this.emit(); },
  saveSettings() {
    write(K_SETTINGS, this.settings);
    this.emit();
  },
  get(id) { return this.events.find((e) => e.id === id) || null; },
  upsert(ev) {
    ev.updated = Date.now();
    const i = this.events.findIndex((e) => e.id === ev.id);
    if (i >= 0) this.events[i] = ev;
    else this.events.push(ev);
  },
  remove(id) { this.events = this.events.filter((e) => e.id !== id); },
  snapshot() { return JSON.stringify(this.events); },
  restore(snap) { this.events = JSON.parse(snap); this.save(); },
};
store.settings.bridge = { ...DEFAULT_SETTINGS.bridge, ...(store.settings.bridge || {}) };
if (!Array.isArray(store.settings.rules)) store.settings.rules = DEFAULT_RULES;

export function newEvent(p = {}) {
  const now = Date.now();
  return {
    id: uid(),
    title: p.title || 'New event',
    notes: p.notes || '',
    location: p.location || '',
    source: p.source || '',
    allDay: !!p.allDay,
    start: p.start,
    end: p.end || null,
    color: p.color || null,
    reminders: Array.isArray(p.reminders) ? p.reminders : [],
    alarms: Array.isArray(p.alarms) ? p.alarms : [],
    repeat: p.repeat || null,
    exdates: p.exdates || [],
    needsReschedule: false,
    created: now,
    updated: now,
  };
}

export function defaultReminders(allDay) {
  const v = allDay ? store.settings.defaultAllDayReminder : store.settings.defaultReminder;
  return v === null || v === undefined || v === '' ? [] : [Number(v)];
}

const ruleCache = new Map();
function ruleTokens(rule) {
  const key = rule.keywords;
  if (!ruleCache.has(key)) {
    ruleCache.set(key, key.split(/[,;\n]+/).map((k) => norm(k.trim())).filter(Boolean));
  }
  return ruleCache.get(key);
}

export function matchRule(title) {
  const t = norm(title || '');
  const words = t.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const rule of store.settings.rules) {
    for (const kw of ruleTokens(rule)) {
      if (kw.includes(' ')) { if (t.includes(kw)) return rule; continue; }
      if (words.some((w) => w === kw || (kw.length >= 4 && w.startsWith(kw)) || (w.length >= 4 && kw.startsWith(w) && kw.length - w.length <= 2))) return rule;
    }
  }
  return null;
}

export function colorFor(ev) {
  if (ev.color) return ev.color;
  const r = matchRule(ev.title);
  return r ? r.color : store.settings.defaultColor;
}

export function exportData() {
  return JSON.stringify({ app: 'daybook', version: 1, exported: new Date().toISOString(), events: store.events, settings: store.settings }, null, 1);
}

export function importData(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.events)) throw new Error('Not a Daybook backup file');
  const byId = new Map(store.events.map((e) => [e.id, e]));
  let added = 0;
  for (const e of data.events) {
    if (!e || !e.id || !e.start) continue;
    if (!byId.has(e.id)) added++;
    byId.set(e.id, e);
  }
  store.events = [...byId.values()];
  if (data.settings && typeof data.settings === 'object') {
    store.settings = { ...store.settings, ...data.settings, bridge: { ...store.settings.bridge, ...(data.settings.bridge || {}) } };
    store.saveSettings();
  }
  store.save();
  return added;
}

export { ymd, toLocal, parseDate, tokens };
