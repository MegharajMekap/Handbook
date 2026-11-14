// Sends web-push notifications. Run by .github/workflows/send-push.yml.
//
//  1. New announcements / calendar events created since the last run.
//  2. Class reminders: 15 min before, 5 min before, at the start, and 5 min after.
//
// Needs env FIREBASE_SERVICE_ACCOUNT (service-account JSON). State lives in the Realtime
// Database under pushState/ (lastTs for announcements, sent/<class>_<offset> for reminders),
// so each notification is sent once.
//
// Timing: this runs from a GitHub schedule, which is best-effort (see the workflow). A reminder
// is sent on the first run at or after its time, within REMINDER_GRACE_MS; wording follows the
// real time left, so a late run never says something untrue.
import admin from "firebase-admin";

const DB_URL = "https://iim-emba-handbook-default-rtdb.firebaseio.com";
const SITE_URL = process.env.SITE_URL || "https://megharajmekap.github.io/Handbook/index.html#calendar";
const REMINDER_OFFSETS_MIN = [-15, -5, 0, 5];     // relative to the class start
const REMINDER_GRACE_MS = 9 * 60000;              // how late a reminder may still be sent
const JOIN_RE = /^https:\/\/([a-z0-9-]+\.)*zoom\.us\/j\/[0-9]/;

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  databaseURL: DB_URL,
});
const db = admin.database();

const val = async (path) => (await db.ref(path).get()).val();
const now = Date.now();
const messages = [];   // { title, body, url, tag }

/* ---------- 1. announcements / calendar events ---------- */
const lastTs = await val("pushState/lastTs");
if (lastTs == null) {
  // First run: don't blast the backlog, just start from now.
  await db.ref("pushState/lastTs").set(now);
  console.log("Initialised pushState/lastTs; no announcements sent.");
} else {
  const [anns, events] = await Promise.all([val("announcements"), val("calendarEvents")]);
  const fresh = (o) => Object.entries(o || {}).filter(([, v]) => v && typeof v.ts === "number" && v.ts > lastTs);
  const announcedEvents = new Set(Object.values(anns || {}).map((a) => a && a.fromEvent).filter(Boolean));
  for (const [, a] of fresh(anns)) {
    messages.push({ title: a.fromEvent ? "New calendar event" : "New announcement", body: a.text, url: SITE_URL });
  }
  for (const [key, e] of fresh(events)) {
    if (e.annKey || announcedEvents.has(key)) continue; // already covered by its announcement
    messages.push({ title: "New calendar event", body: `${e.title} — ${e.date}${e.time ? " " + e.time : ""}`, url: SITE_URL });
  }
}

/* ---------- 2. class reminders ---------- */
// "9:00 AM" -> "09:00"; class times are India time (UTC+05:30)
function to24(t) {
  const m = String(t || "").match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "PM") h += 12;
  return String(h).padStart(2, "0") + ":" + m[2];
}
const istMs = (date, t) => {
  const hm = to24(t);
  return hm ? new Date(`${date}T${hm}:00+05:30`).getTime() : NaN;
};

const sentUpdates = {};
{
  const [classes, sent, adminUrls, joinLinks] = await Promise.all([
    val("classes"), val("pushState/sent"), val("recordingUrls"), val("joinLinks"),
  ]);
  const done = sent || {};
  for (const [key, c] of Object.entries(classes || {})) {
    if (!c || !c.date || !c.time) continue;
    const start = istMs(c.date, c.time);
    if (!isFinite(start)) continue;
    const endRaw = istMs(c.date, c.ends);
    const end = isFinite(endRaw) ? endRaw : start + 60 * 60000;
    if (now >= end) continue;                                         // already over

    // join link: admin-only link first, else the public join link; only Zoom *join* links
    const cand = [adminUrls && adminUrls[key] && adminUrls[key].url, joinLinks && joinLinks[key] && joinLinks[key].url];
    const joinUrl = cand.find((u) => u && JOIN_RE.test(u)) || null;

    // every reminder that is due and unsent; if a run was late and several are due at once,
    // only the latest is sent (an older "starts in 5 min" after the start would be wrong)
    const due = REMINDER_OFFSETS_MIN.filter((off) => {
      const target = start + off * 60000;
      return !done[`${key}_${off}`] && now >= target && now < target + REMINDER_GRACE_MS;
    });
    if (!due.length) continue;
    for (const off of due) sentUpdates[`pushState/sent/${key}_${off}`] = now;
    const off = due[due.length - 1];
    const id = `${key}_${off}`;

    const left = Math.ceil((start - now) / 60000);                   // minutes to the start (<= 0 once started)
    let title;
    if (off === 0) title = "Class is live now";
    else if (off > 0) title = `Started ${Math.max(1, Math.round((now - start) / 60000))} min ago`;
    else title = left > 0 ? `Starts in ${left} min` : "Starting now";
    const body = `${c.subject}${c.lecture ? " — " + c.lecture : ""}${c.campus ? " (on campus)" : ""}`;
    // the join link goes in from 5 minutes before; the 15-minute heads-up opens the site
    const url = !c.campus && off >= -5 && joinUrl ? joinUrl : SITE_URL;
    messages.push({ title, body, url, tag: id });
  }
  // tidy up: forget reminders sent more than 2 days ago
  for (const [id, ts] of Object.entries(done)) {
    if (typeof ts === "number" && now - ts > 2 * 86400000) sentUpdates[`pushState/sent/${id}`] = null;
  }
}

/* ---------- send ---------- */
if (messages.length) {
  const tokenSnap = (await val("fcmTokens")) || {};
  const tokens = Object.entries(tokenSnap).map(([k, v]) => [k, v.token]).filter(([, t]) => t);
  console.log(`${messages.length} message(s) → ${tokens.length} device(s)`);
  for (const m of messages) {
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      const res = await admin.messaging().sendEachForMulticast({
        tokens: batch.map(([, t]) => t),
        data: { title: m.title, body: String(m.body).slice(0, 200), url: m.url, tag: m.tag || "" },
        webpush: { headers: { Urgency: "high", TTL: "900" } },   // a stale reminder is worse than none
      });
      // prune tokens that are no longer valid
      await Promise.all(res.responses.map((r, j) => {
        const code = r.error && r.error.code;
        if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
          return db.ref("fcmTokens/" + batch[j][0]).remove();
        }
      }));
    }
  }
} else {
  console.log("Nothing to send.");
}

if (lastTs != null) sentUpdates["pushState/lastTs"] = now;
if (Object.keys(sentUpdates).length) await db.ref().update(sentUpdates);
