import { parse } from '../parser.js';

const NOW = new Date(2026, 10, 18, 10, 0); // Wed 18 Nov 2026, 10:00
const EVENTS = [
  { id: 'den', title: 'Dentist appointment', notes: '', allDay: false, start: '2026-11-24T15:00', end: '2026-11-24T16:00', reminders: [15], alarms: [], repeat: null, exdates: [] },
  { id: 'gym', title: 'Gym', notes: '', allDay: false, start: '2026-11-03T18:00', end: '2026-11-03T19:30', reminders: [], alarms: [], repeat: { freq: 'weekly', interval: 1, days: [2, 4] }, exdates: [] },
  { id: 'john', title: 'Meeting with John', notes: 'budget', allDay: false, start: '2026-11-18T15:00', end: '2026-11-18T16:00', reminders: [], alarms: [], repeat: null, exdates: [] },
  { id: 'sed', title: 'Ședință echipă', notes: '', allDay: false, start: '2026-11-20T10:00', end: '2026-11-20T11:00', reminders: [], alarms: [], repeat: null, exdates: [] },
  { id: 'yoga', title: 'Yoga', notes: '', allDay: false, start: '2026-11-12T19:00', end: null, reminders: [], alarms: [], repeat: { freq: 'weekly', interval: 1 }, exdates: [] },
  { id: 'sala', title: 'Sală', notes: '', allDay: false, start: '2026-11-05T07:00', end: null, reminders: [], alarms: [], repeat: { freq: 'weekly', interval: 1, days: [4] }, exdates: [] },
];

let pass = 0, fail = 0;
function check(text, exp) {
  const r = parse(text, { now: NOW, events: EVENTS, settings: { guessPM: true } });
  const got = {
    intent: r.intent,
    title: r.draft?.title ?? r.title,
    start: r.draft?.start,
    end: r.draft?.end,
    allDay: r.draft?.allDay,
    notes: r.draft?.notes,
    location: r.draft?.location,
    reminders: r.draft?.reminders,
    alarms: r.draft?.alarms,
    repeat: r.draft?.repeat ? JSON.stringify(r.draft.repeat) : undefined,
    target: r.target?.ev?.id,
    occ: r.target?.occ ? r.target.occ.key : undefined,
    scope: r.scope,
    newStart: r.change?.start,
    newEnd: r.change?.end,
    notesAdd: r.change?.notesAdd,
    needsTime: r.needsTime,
    ambiguous: r.ambiguous,
  };
  const errs = [];
  for (const [k, v] of Object.entries(exp)) {
    const g = got[k];
    const ok = typeof v === 'object' && v !== null ? JSON.stringify(g) === JSON.stringify(v) : g === v;
    if (!ok) errs.push(`${k}: expected ${JSON.stringify(v)} got ${JSON.stringify(g)}`);
  }
  if (errs.length) { fail++; console.log(`✗ "${text}"\n    ${errs.join('\n    ')}`); }
  else pass++;
}

// ---- create: English
check('dentist next tuesday at 3pm, bring insurance card', { intent: 'create', title: 'Dentist', start: '2026-11-24T15:00', end: null, allDay: false, notes: 'Bring insurance card' });
check('team offsite dec 5', { title: 'Team offsite', start: '2026-12-05', allDay: true, end: null });
check('gym tomorrow 6-7:30am, set an alarm', { title: 'Gym', start: '2026-11-19T06:00', end: '2026-11-19T07:30', alarms: [0] });
check('call mom in 2 hours', { title: 'Call mom', start: '2026-11-18T12:00' });
check('remind me to call the bank tomorrow at 9', { title: 'Call the bank', start: '2026-11-19T09:00', reminders: [0] });
check('yoga every monday and wednesday at 18:00', { title: 'Yoga', start: '2026-11-18T18:00', repeat: JSON.stringify({ freq: 'weekly', interval: 1, days: [1, 3] }) });
check('flight to Rome 5.12 at 06:40', { title: 'Flight to Rome', start: '2026-12-05T06:40' });
check('meeting with Ana at 3', { intent: 'create', title: 'Meeting with Ana', start: '2026-11-18T15:00' });
check('dinner at 8', { title: 'Dinner', start: '2026-11-18T20:00' });
check('wake me up at 6:30 tomorrow', { title: 'Wake up', start: '2026-11-19T06:30', alarms: [0] });
check('doctor appointment on the 25th at 10:30, remind me 1 hour before', { title: 'Doctor appointment', start: '2026-11-25T10:30', reminders: [60] });
check('birthday party saturday 19-23', { title: 'Birthday party', start: '2026-11-21T19:00', end: '2026-11-21T23:00' });
check('conference from monday to wednesday', { title: 'Conference', start: '2026-11-23', end: '2026-11-25', allDay: true });
check('lunch with Sarah tomorrow at noon @ Olive Garden', { title: 'Lunch with Sarah', start: '2026-11-19T12:00', location: 'Olive Garden' });
check('haircut friday 14:30 for 45 minutes', { title: 'Haircut', start: '2026-11-20T14:30', end: '2026-11-20T15:15' });
check('exam on 12/01', { title: 'Exam', start: '2027-01-12', allDay: true });
check('move furniture saturday', { intent: 'create', title: 'Move furniture', start: '2026-11-21', allDay: true });
check('change oil next week', { intent: 'create', title: 'Change oil', start: '2026-11-23', allDay: true });
check('standup every weekday at 9:15', { title: 'Standup', start: '2026-11-19T09:15', repeat: JSON.stringify({ freq: 'weekly', interval: 1, days: [1, 2, 3, 4, 5] }) });
check("Sophie's birthday 3 March", { title: "Sophie's birthday", start: '2027-03-03', allDay: true });
check('meeting tomorrow 14:00-15:30 about budget', { title: 'Meeting', start: '2026-11-19T14:00', end: '2026-11-19T15:30', notes: 'About budget' });
check('dentist tomorrow', { intent: 'create', title: 'Dentist', start: '2026-11-19' });
check('movie tonight', { title: 'Movie', start: '2026-11-18T19:00' });
check('pay rent on the 1st every month', { title: 'Pay rent', start: '2026-12-01', repeat: JSON.stringify({ freq: 'monthly', interval: 1 }) });
check('dinner at Mario\'s tomorrow 8pm', { title: "Dinner at Mario's", start: '2026-11-19T20:00' });
check('I have a dentist appointment next friday at 9am', { title: 'Dentist appointment', start: '2026-11-27T09:00' });
check('vacation dec 20 to jan 3', { title: 'Vacation', start: '2026-12-20', end: '2027-01-03', allDay: true });
check('pick up the kids at 4:30 every day', { title: 'Pick up the kids', start: '2026-11-18T16:30' });
check('pitch meeting thursday from 2 to 4pm', { title: 'Pitch meeting', start: '2026-11-19T14:00', end: '2026-11-19T16:00' });
check('call with the bank at 11', { title: 'Call with the bank', start: '2026-11-18T11:00' });
check('run at 7 in the morning on sunday', { title: 'Run', start: '2026-11-22T07:00' });
check('drinks friday at 7 in the evening', { title: 'Drinks', start: '2026-11-20T19:00' });
check('team lunch 21/11 12:30', { title: 'Team lunch', start: '2026-11-21T12:30' });
check('alarm at 5:45 tomorrow for the airport', { start: '2026-11-19T05:45', alarms: [0] });
check('presentation tomorrow at 10, alarm at 8', { title: 'Presentation', start: '2026-11-19T10:00', alarms: [120] });
check('school trip all day thursday', { title: 'School trip', start: '2026-11-19', allDay: true });
check('report due end of month', { title: 'Report due', start: '2026-11-30', allDay: true });
check('book club the day after tomorrow at 6pm, remind me the day before', { title: 'Book club', start: '2026-11-20T18:00', reminders: [1440] });
check('weekly sync every 2 weeks on tuesday at 10', { title: 'Weekly sync', start: '2026-11-24T10:00' });

// ---- create: Romanian
check('programare la dentist marți la 15, să iau buletinul', { title: 'Programare la dentist', start: '2026-11-24T15:00', notes: 'Să iau buletinul' });
check('mâine la 8 seara cina cu Ana', { title: 'Cina cu Ana', start: '2026-11-19T20:00' });
check('ședință vineri de la 10 la 12', { title: 'Ședință', start: '2026-11-20T10:00', end: '2026-11-20T12:00' });
check('concediu 20-27 decembrie', { title: 'Concediu', start: '2026-12-20', end: '2026-12-27', allDay: true });
check('examen la mate pe 15 ianuarie la ora 9', { title: 'Examen la mate', start: '2027-01-15T09:00' });
check('petrecere sâmbătă seara', { title: 'Petrecere', start: '2026-11-21T19:00' });
check('trezește-mă la 6', { title: 'Wake up', start: '2026-11-19T06:00', alarms: [0] });
check('programare frizer joi la 3 și jumătate', { title: 'Programare frizer', start: '2026-11-19T15:30' });
check('în 3 zile la 10 interviu', { title: 'Interviu', start: '2026-11-21T10:00' });
check('alarmă mâine la 7', { title: 'Alarm', start: '2026-11-19T07:00', alarms: [0] });
check('am ședință mâine la 9 dimineața', { title: 'Ședință', start: '2026-11-19T09:00' });
check('sală în fiecare luni la 7 dimineața', { title: 'Sală', start: '2026-11-23T07:00', repeat: JSON.stringify({ freq: 'weekly', interval: 1, days: [1] }) });
check('ziua Mariei pe 3 decembrie', { title: 'Ziua Mariei', start: '2026-12-03', allDay: true });
check('trebuie să sun la bancă poimâine la 11, amintește-mi cu 30 de minute înainte', { title: 'Sun la bancă', start: '2026-11-20T11:00', reminders: [30] });
check('cumpărături azi după-amiază', { title: 'Cumpărături', start: '2026-11-18T15:00' });
check('merg la film vinerea viitoare la 21:00', { title: 'Film', start: '2026-11-27T21:00' });
check('meci de fotbal duminică de la 18 până la 20', { title: 'Meci de fotbal', start: '2026-11-22T18:00', end: '2026-11-22T20:00' });
check('zbor spre Londra pe 12.12 la 6:15, alarmă cu o oră înainte', { title: 'Zbor spre Londra', start: '2026-12-12T06:15', alarms: [60] });
check('curs de engleză în fiecare marți și joi la 18', { title: 'Curs de engleză', start: '2026-11-19T18:00', repeat: JSON.stringify({ freq: 'weekly', interval: 1, days: [2, 4] }) });
check('plata facturii lunar pe 10', { title: 'Plata facturii', start: '2026-12-10' });
check('întâlnire cu Mihai peste o oră', { title: 'Întâlnire cu Mihai', start: '2026-11-18T11:00' });
check('la 3 am ședință', { title: 'Ședință', start: '2026-11-18T15:00' });

// ---- cancel
check('not going to the dentist anymore', { intent: 'cancel', target: 'den' });
check("I can't make it to yoga tomorrow", { intent: 'cancel', target: 'yoga', occ: '2026-11-19', scope: 'occurrence' });
check("cancel friday's meeting", { intent: 'cancel', target: 'sed' });
check('the meeting with John is cancelled', { intent: 'cancel', target: 'john' });
check('nu mai merg la sală mâine', { intent: 'cancel', target: 'sala', occ: '2026-11-19', scope: 'occurrence' });
check('nu mai merg la sală', { intent: 'cancel', target: 'sala', scope: 'series' });
check('dentistul s-a anulat', { intent: 'cancel', target: 'den' });
check('anulează ședința de vineri', { intent: 'cancel', target: 'sed' });
check('skip gym on thursday', { intent: 'cancel', target: 'gym', occ: '2026-11-19' });
check("I'm not doing yoga anymore", { intent: 'cancel', target: 'yoga', scope: 'series' });
check('delete the dentist', { intent: 'cancel', target: 'den' });

// ---- reschedule
check('dentist moved to thursday 5pm, bring x-rays', { intent: 'reschedule', target: 'den', newStart: '2026-11-19T17:00', newEnd: '2026-11-19T18:00', notesAdd: 'Bring x-rays' });
check('need to reschedule the dentist', { intent: 'reschedule', target: 'den', needsTime: true });
check('mută dentistul joi la 17', { intent: 'reschedule', target: 'den', newStart: '2026-11-19T17:00' });
check('amână ședința cu o oră', { intent: 'reschedule', target: 'sed', newStart: '2026-11-20T11:00', newEnd: '2026-11-20T12:00' });
check('move the meeting with John to 5pm', { intent: 'reschedule', target: 'john', newStart: '2026-11-18T17:00', newEnd: '2026-11-18T18:00' });
check('push the dentist back by 30 minutes', { intent: 'reschedule', target: 'den', newStart: '2026-11-24T15:30' });
check('reprogramează dentistul pe 2 decembrie', { intent: 'reschedule', target: 'den', newStart: '2026-12-02T15:00' });
check('postpone the dentist to next week', { intent: 'reschedule', target: 'den', newStart: '2026-11-23T15:00' });
check('dentist is now at 4', { intent: 'reschedule', target: 'den', newStart: '2026-11-24T16:00' });
check('move gym from thursday to friday', { intent: 'reschedule', target: 'gym', occ: '2026-11-19', newStart: '2026-11-20T18:00', scope: 'occurrence' });
check('move the meeting with john from 3 to 4', { intent: 'reschedule', target: 'john', newStart: '2026-11-18T16:00' });
check('am mutat ședința de vineri pe luni la 11', { intent: 'reschedule', target: 'sed', newStart: '2026-11-23T11:00' });
check('the dentist got moved an hour earlier', { intent: 'reschedule', target: 'den', newStart: '2026-11-24T14:00' });
check('reschedule yoga to 8pm from now on', { intent: 'reschedule', target: 'yoga', scope: 'series', newStart: '2026-11-19T20:00' });

// ---- edit
check('add note to dentist: bring x-rays', { intent: 'edit', target: 'den', notesAdd: 'Bring x-rays' });
check('adaugă la ședință: pregătește prezentarea', { intent: 'edit', target: 'sed', notesAdd: 'Pregătește prezentarea' });


// ---- regressions found while probing
check('standup at 10:00, remind me at start', { title: 'Standup', start: '2026-11-18T10:00', reminders: [0], notes: '' });
check('cafea cu Dan la 16, amintește-mi când începe', { title: 'Cafea cu Dan', start: '2026-11-18T16:00', reminders: [0], notes: '' });
check('dentist 24.11 ora 14',{ title: 'Dentist', start: '2026-11-24T14:00', end: null });
check('dentist at 24.11', { title: 'Dentist', start: '2026-11-24', allDay: true });
check('Meeting at 3 tomorrow with John', { title: 'Meeting with John', start: '2026-11-19T15:00' });
check('call Alex at 8:15 tomorrow morning and set an alarm 15 minutes before', { title: 'Call Alex', start: '2026-11-19T08:15', alarms: [15], notes: '' });
check('Mâine am dentist la 14:30', { title: 'Dentist', start: '2026-11-19T14:30' });
check('ziua lui Andrei 12 mai', { title: 'Ziua lui Andrei', start: '2027-05-12' });
check('Christmas party on 19 december from 8pm until midnight', { title: 'Christmas party', start: '2026-12-19T20:00', end: '2026-12-20T00:00' });
check('Plec la mare pe 1 august pentru o săptămână', { start: '2027-08-01', end: '2027-08-07', allDay: true });
check('take out the trash every tuesday evening', { title: 'Take out the trash', start: '2026-11-24T19:00' });
check('film 1.5 hours tonight at 9', { title: 'Film', start: '2026-11-18T21:00', end: '2026-11-18T22:30' });
check('nu mai pot ajunge la ședință vineri', { intent: 'cancel', target: 'sed' });
check('ședința de vineri s-a mutat la ora 12', { intent: 'reschedule', target: 'sed', newStart: '2026-11-20T12:00' });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
