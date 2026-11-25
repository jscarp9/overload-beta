/* Overload offline helper. © 2026 Jake Scarpa. All rights reserved. */
const BETA = /overload-beta/i.test(self.registration.scope);
const CACHE = (BETA ? 'overload-beta' : 'overload') + '-v6d';
const DBN = BETA ? 'overload-beta' : 'overload';
const SHELL = ['./', './index.html', './icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isPage = req.mode === 'navigate' || (url.origin === location.origin && /\/(index\.html)?$/.test(url.pathname));

  if (isPage) {
    // Newest version first when online, saved copy when offline or slow
    e.respondWith(
      Promise.race([fetch(req, { cache: 'no-cache' }), timeout(4000)])
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // Icon and fonts: saved copy first, refresh in the background
  if (url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(
      caches.match(req).then(hit => {
        const net = fetch(req)
          .then(res => {
            if (res && (res.ok || res.type === 'opaque')) {
              const copy = res.clone();
              caches.open(CACHE).then(c => c.put(req, copy));
            }
            return res;
          })
          .catch(() => hit);
        return hit || net;
      })
    );
  }
});

/* Lock-screen rest alerts */
function idbGet(key) {
  return new Promise(res => {
    try {
      const q = indexedDB.open(DBN, 1);
      q.onupgradeneeded = () => { if (!q.result.objectStoreNames.contains('kv')) q.result.createObjectStore('kv'); };
      q.onsuccess = () => {
        try {
          const g = q.result.transaction('kv').objectStore('kv').get(key);
          g.onsuccess = () => res(g.result || null);
          g.onerror = () => res(null);
        } catch (e) { res(null); }
      };
      q.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}

async function pushMsg() {
  const m = await idbGet('pushmsg');
  if (m && m.at && Math.abs(Date.now() - m.at) < 120000) return m;
  const c = await idbGet('crewid');
  if (c && c.code) {
    try {
      const r = await fetch(c.url + '/crew/latest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: c.code, id: c.id, key: c.key }) });
      if (r.ok) { const j = await r.json(); return { title: j.title, body: j.body, tag: 'overload-crew' }; }
    } catch (e) {}
    return { title: 'Overload', body: 'New activity in your crew', tag: 'overload-crew' };
  }
  return m;
}

self.addEventListener('push', e => {
  e.waitUntil(pushMsg().then(m => self.registration.showNotification((m && m.title) || 'Rest is over ⏱️', {
    body: (m && m.body) || 'Time for your next set 💪',
    icon: './icon.png',
    badge: './icon.png',
    tag: (m && m.tag) || 'overload-rest',
    renotify: true,
    vibrate: [200, 100, 200],
  })));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const w = list.find(c => 'focus' in c);
    return w ? w.focus() : self.clients.openWindow('./');
  }));
});
