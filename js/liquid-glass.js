/**
 * liquid-glass.js —— 底部导航「液态玻璃」真折射层（iOS 26 Liquid Glass 网页复刻）
 *
 * 原理（研究自 kube.io《Liquid Glass in the Browser》与 LogRocket 同名文章）：
 * 1. 用 canvas 生成一张「边缘位移贴图」：把玻璃表面建模成圆角矩形四周一圈微凸
 *    的曲面（squircle 剖面），越靠边缘坡度越陡，光穿过时被弯折得越多。
 *    贴图 R/G 通道分别编码 X/Y 位移（128 = 不动），边缘处方向朝外、强度最大，
 *    往内 BEZEL px 渐弱到 0 —— 于是 backdrop 在边缘被「掰弯」，像真玻璃一样
 *    把边缘外的背景折射进玻璃里。
 * 2. 贴图写入 <feImage>，喂给 <feDisplacementMap>，经
 *    backdrop-filter: url(#liquid-glass-filter) 作用到底栏背后的内容上。
 * 3. 兼容性：SVG 滤镜只有 Chromium 系（Chrome/Edge/三星浏览器等）能在
 *    backdrop-filter 里生效；iOS 全系与 Firefox 均不支持，检测不过就保持原样，
 *    由 style.css 的毛玻璃 + 流光高光兜底（降级观感同样成立）。
 */
(function () {
  'use strict';

  var bar = document.getElementById('tab-bar');
  if (!bar) return;

  /* ---- 能力检测：只有 Chromium 系支持在 backdrop-filter 里引用 SVG 滤镜 ---- */
  var ua = navigator.userAgent || '';
  var onIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var chromium = typeof window.chrome !== 'undefined' && !onIOS &&
    !/CriOS|FxiOS|EdgiOS/.test(ua);
  var canRefract = false;
  try {
    canRefract = chromium && window.CSS &&
      CSS.supports('backdrop-filter', 'url(#f)') &&
      CSS.supports('backdrop-filter', 'blur(1px)');
  } catch (e) { canRefract = false; }
  if (!canRefract) return;

  var feImage = document.getElementById('lg-feimage');
  var feDisp = document.getElementById('lg-displace');
  if (!feImage || !feDisp) return;

  /* ---- 折射参数：按手机底栏尺寸调的克制数值 ---- */
  var BEZEL = 11;      // 折射带宽（px）：从边缘往内多宽开始弯
  var MAX_DISP = 7;    // 最大位移（px）：边缘最多把背景「拉」进来多少
  var PROFILE = 2.1;   // 位移曲线指数：越大越集中在最边缘

  var lastW = 0, lastH = 0, rafId = 0;

  /* 生成圆角矩形位移贴图：R 通道 = X 位移，G 通道 = Y 位移，128 为不动 */
  function buildDisplacementMap(w, h, radius) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(w, h);
    var d = img.data;
    var bx = w / 2 - radius, by = h / 2 - radius;   // 核心矩形半尺寸（内缩 radius）
    var cx = w / 2, cy = h / 2;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        var px = x + 0.5 - cx, py = y + 0.5 - cy;
        var qx = Math.abs(px) - bx, qy = Math.abs(py) - by;
        // 圆角矩形有符号距离（内负外正），取负得到「到边缘的距离」
        var sd = Math.min(Math.max(qx, qy), 0) +
                 Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
        var bd = -sd;
        if (bd <= 0 || bd >= BEZEL) continue;       // 带外保持 128,128（不动）
        var u = 1 - bd / BEZEL;                     // 0 内沿 → 1 玻璃边缘
        var m = Math.pow(u, PROFILE);               // 位移强度：边缘最强
        // 位移方向：从核心矩形最近点指向当前像素 = 垂直于边缘朝外
        var nx = Math.max(-bx, Math.min(bx, px));
        var ny = Math.max(-by, Math.min(by, py));
        var dx = px - nx, dy = py - ny;
        var len = Math.hypot(dx, dy) || 1;
        d[i]     = Math.round(128 + (dx / len) * m * 127);
        d[i + 1] = Math.round(128 + (dy / len) * m * 127);
        d[i + 2] = 128;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL();
  }

  function apply() {
    rafId = 0;
    var r = bar.getBoundingClientRect();
    var w = Math.max(2, Math.round(r.width));
    var h = Math.max(2, Math.round(r.height));
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    var url = buildDisplacementMap(w, h, h / 2);    // 胶囊：圆角 = 高度一半
    feImage.setAttribute('href', url);
    feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
    feImage.setAttribute('width', String(w));       // feImage 需与元素实际尺寸对齐
    feImage.setAttribute('height', String(h));
    feDisp.setAttribute('scale', String(MAX_DISP));
    // 贴图就绪后再开折射，避免首帧拿到空贴图出现整块错位
    var probe = new Image();
    probe.onload = function () { bar.classList.add('lg-refract'); };
    probe.src = url;
  }

  function schedule() {
    if (!rafId) rafId = requestAnimationFrame(apply);
  }

  apply();
  if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(bar);
  else window.addEventListener('resize', schedule);
})();
