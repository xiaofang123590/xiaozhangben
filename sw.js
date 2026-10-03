/**
 * sw.js —— 小账本 · Service Worker（离线缓存）
 *
 * 策略：网络优先（cache: 'no-cache' 协商缓存，内容未变时服务器返回 304 代价很小），
 *       成功后回填缓存；断网时回退缓存，导航请求最终退回 index.html。
 *       在线打开永远是最新版，离线照常可用，从根上避免「发版后手机读到旧代码」。
 * 注意：CACHE_VERSION 仅用于旧缓存清理；更新内容后习惯性 +1 即可，不再影响新旧。
 */
var CACHE_VERSION = 'xzb-v9';

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
  './js/diet-nlp.js',
  './js/charts.js',
  './js/diet-ui.js',
  './js/liquid-glass.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // 逐条用 cache: 'reload' 预缓存：强制绕过 HTTP 缓存取最新文件。
      // 不能用 cache.addAll(PRECACHE)——它会走 HTTP 缓存，发版后一段
      // 时间内（如 GitHub Pages 的 max-age=600）可能把旧文件存进新版本
      // 缓存，导致「版本号升了、代码还是旧的」的隐蔽问题。
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' }));
      }));
    }).then(function () { return self.skipWaiting(); })
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
  var url;
  try { url = new URL(event.request.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;   // 只处理本站同源请求

  // 网络优先：拿到新响应就回填当前版本缓存；网络失败回退缓存（离线兜底）
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' }).then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(CACHE_VERSION).then(function (cache) { cache.put(event.request, copy); });
      }
      return response;
    }).catch(function () {
      return caches.match(event.request).then(function (cached) {
        if (cached) return cached;
        // 离线且未缓存：页面导航请求退回 index.html
        if (event.request.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});
