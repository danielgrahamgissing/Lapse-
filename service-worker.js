/*
  Sleepy Lull — minimal service worker.

  This exists primarily so the app satisfies the browser's installability
  criteria (a registered, active service worker is required before Chrome/
  Edge will ever fire the "beforeinstallprompt" event used by the
  "Add to Home Screen" button). It intentionally does very little: it
  passes every network request straight through, so it won't interfere
  with anything or serve stale content.

  If you'd like real offline support later (caching the app shell so it
  opens even with no connection), this is the file to extend — cache
  index.html and the audio files in the "install" event, then serve from
  cache first in "fetch". Not implemented here to keep behaviour simple
  and predictable while the app is still under active development.
*/

const VERSION = "sleepy-lull-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Pass-through: no caching, just required for the browser to consider
  // this a valid, controlling service worker.
  event.respondWith(fetch(event.request));
});
