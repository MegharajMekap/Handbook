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
