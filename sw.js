/**
 * sw.js —— 小账本 · Service Worker（离线缓存）
 *
 * 策略：缓存优先，未命中时请求网络并回填缓存；离线且未缓存时退回 index.html。
 * 注意：以后更新了 css/js/图标 内容，请把 CACHE_VERSION 号 +1，否则手机上
 *       可能一直读到旧缓存。
 */
var CACHE_VERSION = 'xzb-v3';

var PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/chart.umd.js',
  './js/auth.js',
  './js/nlp.js',
  './js/shopping.js',
  './js/core.js',
  './js/food-db.js',
  './js/diet.js',
  './js/charts.js',
  './js/diet-ui.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(function (cache) { return cache.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_VERSION) return caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        // 只缓存本站同源响应
        if (response && response.ok && new URL(event.request.url).origin === self.location.origin) {
          var copy = response.clone();
          caches.open(CACHE_VERSION).then(function (cache) { cache.put(event.request, copy); });
        }
        return response;
      }).catch(function () {
        // 离线且未缓存：页面导航请求退回 index.html
        if (event.request.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});
