// 앱 껍데기는 오프라인에서도 열리고, 썸네일은 한 번 본 건 바로 뜨도록 캐시
const SHELL = 'fa-shell-v1';
const THUMBS = 'fa-thumbs-v1';
const SHELL_FILES = ['./', 'index.html', 'app.js', 'style.css', 'icons/icon.svg', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, THUMBS].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trimThumbs() {
  const c = await caches.open(THUMBS);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - 3000; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const p = url.pathname;

  // 썸네일: 캐시 우선
  if (/\/media\/[^/]+\/thumb$/.test(p)) {
    e.respondWith(caches.open(THUMBS).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { c.put(req, res.clone()); if (Math.random() < 0.02) trimThumbs(); }
      return res;
    }));
    return;
  }
  // API·원본·아바타는 항상 네트워크
  if (p.includes('/api/') || p.includes('/media/') || p.includes('/avatar/') || p.endsWith('manifest.webmanifest')) return;

  // 화면 이동: 네트워크 우선, 안 되면 캐시된 앱
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('index.html')));
    return;
  }
  // 정적 파일: 캐시 먼저 보여주고 뒤에서 갱신
  e.respondWith(caches.open(SHELL).then(async (c) => {
    const hit = await c.match(req);
    const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
