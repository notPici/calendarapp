# Daybook

An offline calendar for iPhone, installed from Safari as a home-screen web app (PWA).
Type what you need to do and when, in English or Romanian, and it creates, moves or deletes events for you.

- **Smart text box**: works out the title, notes, date and time, and whether you mean create, cancel, reschedule or add a note. A preview card shows what will happen before you press return, and every change can be undone.
- **Dates and times**: a date only gives an all-day event, a start time marks just the start, and a start and end marks the whole block. Multi-day ranges, repeating events, durations and relative times ("in 2 hours", "peste 3 zile") also work.
- **Manual events**: tap **+**, or tap an empty slot in the Day or Week view.
- **Views**: Home (agenda), Day, Week and Month, all 24-hour with weeks starting Monday.
- **Look**: dark theme by default, with light and auto options.
- **Colors**: pick one per event, or use color rules (keywords → color) so typed events are colored automatically.
- **Notifications and alarms**: handed to iOS Reminders and the Clock app through two Shortcuts, so they work with the app closed and offline. While the app is open it also shows its own banners and a full-screen alarm.
- **Your data**: stays only on your phone. You can export and import a backup file.

---

## 1. Put it online once (needed to install)

iOS only installs web apps from an `https://` address. After it is installed, the app runs fully offline and your events never leave your phone. Pick one of these:

**A. GitHub Pages, from this repository (free; recommended)**
1. Free GitHub accounts can only publish Pages from **public** repositories. If this one is private, go to **Settings → General → Danger Zone → Change visibility** and make it public. The code holds no personal data; your events stay on your phone.
2. Go to **Settings → Pages** and set **Source: Deploy from a branch**, branch **main**, folder **/ (root)**, then press Save.
3. After about a minute your app is at `https://<your-username>.github.io/<repository-name>/`.

The files must stay at the top level of the repository, as they are now. `.nojekyll` tells GitHub to serve them as they are.

**B. Netlify Drop (from a computer)**: download the repository as a zip (**Code → Download ZIP**), unzip it, open app.netlify.com/drop, sign in, and drag the folder onto the page.

## 2. Install on the iPhone

1. Open your app's address in **Safari**.
2. Tap **Share → Add to Home Screen → Add**.
3. Open **Daybook** from the home screen. From now on it works with no internet.

> Keep using the home-screen icon, not a Safari tab. Data saved in Safari and data saved in the installed app are separate. Deleting the icon deletes the app's data, so use **Settings → Export backup** now and then.

## 3. Turn on notifications and alarms (about 5 minutes)

Apple doesn't let web apps schedule alerts by themselves. Daybook passes them to two shortcuts you build once:

- **Notifications** become reminders in a Reminders list called "Daybook", which alert at the right time.
- **Alarms** become real alarms in the Clock app, so they ring even on silent and offline.

The full step-by-step guide is in the app under **Settings → Setup guide**; the same steps are below.

**Prepare**
1. In **Reminders**, add a list named `Daybook`.
2. In **Settings → Apps → Shortcuts → Advanced**, turn on **Allow Deleting Without Confirmation**.

**Shortcut "Calendar Bridge"** (the name must match the one in Daybook's Settings)
1. **Save File**: input *Shortcut Input*. Turn off *Ask Where to Save*, path `daybook.json`, turn on *Overwrite If File Exists*.
2. **Get Dictionary from Input**: input *Shortcut Input*.
3. **Get Dictionary Value**: key `ops` in *Dictionary*.
4. **Repeat with Each** item in that value:
   - **Get Dictionary Value** `id` in *Repeat Item*, then **Set Variable** `EventID`.
   - **Find Reminders** where *Notes* contains *EventID*, then **Remove Reminders**.
   - **Get Dictionary Value** `n` in *Repeat Item*, then **Repeat with Each** item in it:
     - **Get Dictionary Value** `d` in *Repeat Item 2*, then **Get Dates from Input**.
     - **Get Dictionary Value** `t` in *Repeat Item 2*.
     - **Add New Reminder**: title `t`, list `Daybook`, alert or due time = *Dates*, notes = *EventID*.
5. After the loop: **Run Shortcut**, choosing `Calendar Arm`.

**Shortcut "Calendar Arm"** (turns the next 24 hours of alarms into Clock alarms)
1. **Get File**: Shortcuts folder, path `daybook.json`, *Error If Not Found* off.
2. **Get Dictionary from Input**, then **Get Dictionary Value** `alarms`, then **Set Variable** `Alarms`.
3. **Get All Alarms**, then **Repeat with Each**, then **If** *Repeat Item → Label* (may be called *Name*) begins with `📅`, then **Delete Alarms** *Repeat Item*.
4. **Repeat with Each** item in *Alarms*:
   - **Get Dictionary Value** `d`, then **Get Dates from Input**, then **Set Variable** `When`.
   - **Get Time Between Dates**: *Current Date* to *When*, in minutes.
   - **If** the result is between `0` and `1440`: **Get Dictionary Value** `t`, then **Add Alarm** (also called *Create Alarm*) at *When* with label `t`.

**Daily automation**: Shortcuts → Automation → **+** → **Time of Day** `00:05`, Daily, **Run Immediately** → **Run Shortcut** `Calendar Arm`.
Clock alarms only have a time, not a date, so this sets each day's alarms just after midnight.

**Switch it on**: in Daybook go to **Settings**, turn on **I've set up the shortcuts**, then tap **Send a test notification**. Shortcuts opens briefly; tap **◀ Daybook** at the top-left to return. A "Daybook test ✓" reminder should arrive about 2 minutes later.

After that, every change to an event with an alert opens Shortcuts for a second to update iOS. If you turn off *Send automatically*, a **Send** banner appears on Home instead.

**Payload** (for reference):
```json
{"v":1,
 "ops":[{"id":"daybook:<event id>","n":[{"t":"Dentist · 15:00 (in 15 min)","d":"2026-11-24 14:45"}]}],
 "alarms":[{"t":"📅 Gym","d":"2026-11-19 06:00"}]}
```

## What you can type

| You type | Result |
|---|---|
| `dentist next tuesday at 15, bring ID` | **Dentist** on Tue 24 Nov at 15:00, notes "Bring ID" |
| `team offsite dec 5` | All-day event on 5 Dec |
| `gym tomorrow 7-8:30, set an alarm` | 07:00–08:30, with an alarm at 07:00 |
| `mâine la 8 seara cină cu Ana` | **Cină cu Ana** tomorrow at 20:00 |
| `concediu 20-27 decembrie` | All-day, 20–27 Dec |
| `yoga every monday and wednesday at 18` | Repeating weekly on Mon and Wed |
| `presentation at 10, alarm at 8` | Event at 10:00, alarm at 08:00 |
| `remind me to call the bank tomorrow at 9` | **Call the bank**, with a notification at 09:00 |
| `I'm not going to the dentist anymore` | Deletes the dentist event |
| `nu mai merg la sală mâine` | Removes only tomorrow's gym session |
| `dentist moved to thursday 17:00, bring x-rays` | Moves it and adds the note |
| `amână ședința cu o oră` | Pushes the meeting back one hour |
| `need to reschedule the dentist` | Flags it and asks you for the new time |
| `add note to dentist: bring x-rays` | Adds a note to the event |

Put each command on its own line to apply several at once.

**Rules of thumb**
- `5.12` and `5/12` mean 5 December (day/month).
- "at 3" means 15:00. You can switch that off in Settings, or write `03:00` for early morning.
- "next Friday" means the Friday of next week; "this Friday" or just "Friday" means the coming one. The preview always shows the exact date.

## Files

| File | Purpose |
|---|---|
| `index.html`, `styles.css` | App shell and styles |
| `app.js` | User interface |
| `parser.js` | Offline English and Romanian sentence understanding |
| `dates.js` | Date helpers and repeating-event expansion |
| `store.js` | Storage, settings and color rules |
| `alerts.js` | In-app alerts and the Shortcuts bridge |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | Offline support and install metadata |
| `tests/parser.test.mjs` | 102 parser tests (`node tests/parser.test.mjs`); not needed on the phone |

When you change files later, also bump `VERSION` in `sw.js` so installed copies pick up the update.
