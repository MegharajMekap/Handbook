# IIM-EMBA-Class-Recording-and-Notes

## Where the data lives

The class schedule is stored in Firebase Realtime Database, not in the code.

| Node | Contents | Who can read |
| --- | --- | --- |
| `classes` | every class session: date, time, subject, faculty, lecture, term, break, thumbnail | everyone |
| `recordingUrls` | recording / join link and passcode per class (same key as in `classes`) | admins |
| `recordingSubjects` | subject name, code and colour overrides | everyone |
| `calendarEvents`, `announcements` | calendar events and notices | everyone |

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

## Manual break (live banner)

Admins and the Super Admin see a **Start break now** button on the live banner. It shows a 15-minute
break for every visitor (countdown to the resume time), then the banner goes back to "Live now".
**End break** ends it early. State is in `liveBreak/<class>` (public read, admin write) — publish
`database.rules.json` after pulling this change.
