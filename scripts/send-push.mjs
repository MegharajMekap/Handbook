// Sends web-push notifications for announcements / calendar events created
// since the last run. Run by .github/workflows/send-push.yml.
//
// Needs env FIREBASE_SERVICE_ACCOUNT (service-account JSON). State is kept in
// the Realtime Database at pushState/lastTs, so each item is sent once.
import admin from "firebase-admin";

const DB_URL = "https://iim-emba-handbook-default-rtdb.firebaseio.com";
const SITE_URL = process.env.SITE_URL || "./index.html";

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  databaseURL: DB_URL,
});
const db = admin.database();

const val = async (path) => (await db.ref(path).get()).val();
const now = Date.now();

const lastTs = await val("pushState/lastTs");
if (lastTs == null) {
  // First run: don't blast the backlog, just start from now.
  await db.ref("pushState/lastTs").set(now);
  console.log("Initialised pushState/lastTs; nothing sent.");
  process.exit(0);
}

const [anns, events] = await Promise.all([val("announcements"), val("calendarEvents")]);
const fresh = (o) => Object.entries(o || {}).filter(([, v]) => v && typeof v.ts === "number" && v.ts > lastTs);

const messages = [];
const announcedEvents = new Set(Object.values(anns || {}).map((a) => a && a.fromEvent).filter(Boolean));
for (const [, a] of fresh(anns)) {
  messages.push({ title: a.fromEvent ? "New calendar event" : "New announcement", body: a.text });
}
for (const [key, e] of fresh(events)) {
  if (e.annKey || announcedEvents.has(key)) continue; // already covered by its announcement
  messages.push({ title: "New calendar event", body: `${e.title} — ${e.date}${e.time ? " " + e.time : ""}` });
}

if (!messages.length) {
  await db.ref("pushState/lastTs").set(now);
  console.log("Nothing new.");
  process.exit(0);
}

const tokenSnap = (await val("fcmTokens")) || {};
const tokens = Object.entries(tokenSnap).map(([k, v]) => [k, v.token]).filter(([, t]) => t);
console.log(`${messages.length} message(s) → ${tokens.length} device(s)`);

for (const m of messages) {
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    const res = await admin.messaging().sendEachForMulticast({
      tokens: batch.map(([, t]) => t),
      data: { title: m.title, body: String(m.body).slice(0, 200), url: SITE_URL },
      webpush: { headers: { Urgency: "high", TTL: "86400" } },
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
await db.ref("pushState/lastTs").set(now);
