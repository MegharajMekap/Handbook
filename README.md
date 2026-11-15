# IIM-EMBA-Class-Recording-and-Notes

## Where the data lives

The class schedule is stored in Firebase Realtime Database, not in the code.

| Node | Contents | Who can read |
| --- | --- | --- |
| `classes` | every class session: date, time, subject, faculty, lecture, term, break, thumbnail | everyone |
| `recordingUrls` | recording / join link and passcode per class (same key as in `classes`) | admins |
| `recordingSubjects` | subject name, code and colour overrides | everyone |
| `calendarEvents`, `announcements` | calendar events and notices | everyone |
| `classSummaries` | text summary for each finished class (the **Class summary** tab) | signed-in users |

The rules are in `database.rules.json`. Publish them in the Firebase console
(Realtime Database → Rules) whenever that file changes.

## Adding or editing classes and links

Use the admin page (`admin.html`) → **Recordings**:

- **Recording links**: paste a link for a class.
- **Add class session**: add, edit or delete a class.
- **Subjects**: add a subject or change its code and colour.

Changes show on the site straight away; no deploy is needed.

## Validating data

Checks that every class in `classes` has a valid date, subject, lecture and term,
that no link or passcode leaked into the public node, and that every `thumb` path
exists on disk:

```
npm run validate
```

This also runs automatically in CI on every push/PR to `main` and weekly on a schedule.

## Push notifications (phone PWA)

Users tap the menu → **Turn on notifications**. Tokens are saved in `fcmTokens`.
A GitHub Action (`.github/workflows/send-push.yml`, every 5 min) runs `scripts/send-push.mjs`, which sends:

- a push for each new announcement / calendar event;
- class reminders: **15 min before**, **5 min before** (opens the Zoom join link), **at the start**
  and **5 min after** (each only once).

GitHub schedules are best-effort, so reminders can come a few minutes late; the text always reflects
the real time left. If a run is late and several reminders are due, only the latest is sent.

On the site, the top banner flashes from 15 min before a class with a countdown, shows the join link
from 5 min before, and switches to "Live now" at the start.

One-time setup:

1. Firebase console → Project settings → Cloud Messaging → Web configuration →
   generate a key pair, paste the public key into `VAPID_KEY` in `index.html`.
2. Firebase console → Project settings → Service accounts → generate a private key;
   save the JSON as the GitHub secret `FIREBASE_SERVICE_ACCOUNT`.
3. Optional: set the repo variable `SITE_URL` to the site's full URL (used when a notification is tapped).
4. Publish the updated `database.rules.json` (adds `fcmTokens`).

On iPhone, push only works once the site is added to the Home Screen (iOS 16.4+).

## Breaks (live banner)

A class can have a scheduled break (e.g. 2:15 PM – 2:30 PM). Admins and the Super Admin can change it
from the live banner, and everyone sees the change:

- **Start break now** — a 15-minute break from this moment (replaces the scheduled one); **End break** finishes it early.
- **Cancel break** — shown while a *scheduled* break is running; suspends it and the class carries on.

The banner shows the break that applies (manual time if one was set, otherwise the scheduled time) with a
countdown, and the calendar table's Time column shows the same: the new time in blue, or "Break cancelled"
with the scheduled time struck through. State is in `liveBreak/<class>` (public read, admin write):
`{from, to}` for a manual break, `{from, to, off: true}` for a cancelled one. Publish `database.rules.json`
after pulling this change.

## Class summary tab

Signed-in users (any account) get a **Class summary** tab: the same date-grouped cards as Recordings, but with
no video, just a written summary for each finished class ("Summary will be added soon" until one is written).
Signed-out visitors don't see the tab, and the database rule (`classSummaries`: `auth != null`) keeps the text
private too. Admins write the summaries in the admin page → **Recordings → Class summaries**.
