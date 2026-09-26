/*
 * サービスワーカー：一度開けば、電波が無くても遊べるようにする（オフライン対応）
 *
 * ▼ ファイルを更新して公開し直したら、CACHE_VERSION の数字を1つ上げてください。
 *   そうしないと、スマホに古い版が残り続けます。
 */
const CACHE_VERSION = 'v1';
const CACHE_NAME = `doubutsu-sengoku-${CACHE_VERSION}`;

const APP_FILES = [
  './',
  './index.html',
  './screens.css',
  './sound.js',
  './hex.js',
  './terrain.js',
  './generals.js',
  './skills.js',
  './screens.js',
  './game.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting()),
  );
});

// 古い版のキャッシュを掃除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('doubutsu-sengoku-') && k !== CACHE_NAME).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

// まずキャッシュから返す。無ければネットから取ってキャッシュに足す（後から追加した画像・音声も対象）
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
