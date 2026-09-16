'use strict';

/**
 * App-shell service worker. See spec.md §19 and §7.3.
 *
 * This file exists for one functional reason, not for offline polish:
 * Safari deletes all script-writable storage — IndexedDB included — after
 * seven days without a visit, and only an app installed to the Home
 * Screen is exempt (§7.3). Phase 9's "already backed up" index lives in
 * that IndexedDB, so being installable is what stops the history
 * evaporating. A manifest plus a service worker is the price of entry.
 *
 * ── The rule that matters more than anything else in here ──────────────
 *
 * This worker MUST NOT get between the browser and a video upload.
 *
 * Uploads are multi-gigabyte PUTs streamed straight from a `File` to
 * googleapis.com. A service worker that calls `respondWith` on one of
 * those puts the whole body through the worker: memory that an iPhone
 * does not have, and a failure mode that looks like a corrupt upload
 * rather than a crash. Sign-in has the same problem for different
 * reasons — accounts.google.com is loading Google Identity Services, and
 * a cached or reshaped response there breaks authorization silently.
 *
 * So `decide()` below refuses, in order, anything that is:
 *
 *   1. not a GET            — every upload PUT/POST leaves here
 *   2. not same-origin      — googleapis.com and accounts.google.com are
 *                             cross-origin, so they leave here too
 *   3. on the blocked list  — stated explicitly, because "it is already
 *                             excluded by rule 2" is exactly the kind of
 *                             reasoning that stops being true after an
 *                             innocent-looking edit
 *
 * Only then does anything get cached, and only the shell: HTML, JS, CSS,
 * fonts, icons. Never a video, never a blob, never an API response.
 *
 * Hand-written rather than @angular/service-worker on purpose: ngsw has
 * no way to express "never see these origins" — its only escape hatch is
 * an `ngsw-bypass` header on each request, which would have to be added
 * to the upload transport — and its fetch handler queues requests behind
 * its own initialization. Forty lines of routing we control beats a
 * generated worker we would have to work around.
 */

const CACHE = 'yt-backup-shell-v2';

/**
 * Cached at install so a cold start works offline (§19: part of the UI
 * opens offline; an upload still needs the network). Hashed bundles are
 * not listed — their names are only known to the build — so they are
 * cached the first time they are fetched instead.
 */
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon-180.png',
];

/** Hosts this worker must never handle a request for. */
const NEVER_HANDLE = [
  'googleapis.com', // uploads, and every Data API call
  'accounts.google.com', // Google Identity Services
  'google.com',
  'gstatic.com',
  'youtube.com',
  'ytimg.com',
];

/** Shell file types worth keeping. Deliberately no video extensions. */
const CACHEABLE_PATH = /\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|svg|ico|webmanifest)$/i;

function isBlockedHost(hostname) {
  return NEVER_HANDLE.some(
    (host) => hostname === host || hostname.endsWith('.' + host),
  );
}

/**
 * What to do with one request: 'ignore' means this worker calls no
 * `respondWith` at all, and the browser fetches it exactly as it would
 * with no service worker installed.
 */
function decide(request, scopeOrigin) {
  if (!request || (request.method !== 'GET' && request.method !== 'HEAD')) {
    return 'ignore';
  }

  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return 'ignore';
  }

  if (isBlockedHost(url.hostname)) return 'ignore';
  if (url.origin !== scopeOrigin) return 'ignore';

  // An SPA navigation to any route is answered by the one shell document.
  if (request.mode === 'navigate') return 'shell';

  if (CACHEABLE_PATH.test(url.pathname)) return 'asset';

  // Anything else same-origin — an API the app grows later, a range
  // request — is none of this worker's business.
  return 'ignore';
}

/** Exposed so the routing rules can be tested as the shipped file. */
self.swPolicy = { decide, isBlockedHost, CACHE, NEVER_HANDLE, PRECACHE };

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await self.caches.open(CACHE);
      // One at a time: a single missing file must not fail the install
      // and leave the app with no worker at all.
      await Promise.all(
        PRECACHE.map((path) => cache.add(path).catch(() => undefined)),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await self.caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE).map((name) => self.caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const decision = decide(event.request, self.location.origin);

  // No respondWith: the request never enters this worker's control.
  if (decision === 'ignore') return;

  event.respondWith(
    decision === 'shell' ? shellFirst(event.request) : cacheFirst(event.request),
  );
});

/**
 * Network first for the document, so a deploy is picked up on the next
 * load rather than after a cache expiry nobody can explain.
 */
async function shellFirst(request) {
  try {
    const response = await self.fetch(request);
    if (response && response.ok) {
      const cache = await self.caches.open(CACHE);
      await cache.put('/index.html', response.clone());
    }
    return response;
  } catch (error) {
    const cache = await self.caches.open(CACHE);
    const cached = (await cache.match(request)) || (await cache.match('/index.html'));
    if (cached) return cached;
    throw error;
  }
}

/** Cache first for everything hashed: the name changes when the bytes do. */
async function cacheFirst(request) {
  const cache = await self.caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await self.fetch(request);
  // `basic` only: an opaque cross-origin response is unreadable and
  // caching it would fill the quota with things we cannot serve.
  if (response && response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
  }
  return response;
}
