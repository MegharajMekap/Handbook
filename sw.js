// Minimal service worker. Its only job is to exist, which is one of the
// browser's requirements before it will offer "Add to Home Screen".
// It does not cache anything, so the page always loads fresh online.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {}); // pass everything straight to the network

// ── Web push (sent by scripts/send-push.mjs via Firebase Cloud Messaging) ──
// Messages are data-only: { title, body, url }.
self.addEventListener("push", (e) => {
  let d = {};
  try {
    const p = e.data && e.data.json();
    d = (p && p.data) || p || {};
  } catch (err) {}
  const title = d.title || "IIM Handbook";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    icon: "logo.jpg",
    badge: "logo.jpg",
    tag: d.tag || undefined,          // a reminder replaces an earlier one for the same class
    renotify: !!d.tag,
    data: { url: d.url || "./index.html" }
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./index.html", self.registration.scope).href;
  const inSite = url.startsWith(self.registration.scope);   // a Zoom link must open Zoom, not just focus the site
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    if (inSite) {
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope) && "focus" in c) return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
