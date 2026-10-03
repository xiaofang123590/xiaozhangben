/**
 * liquid-glass.js —— 底部导航「液态玻璃」交互层（iOS 26 风格）
 *
 * 一、随手指滑动的连续形变（全平台生效）
 *   形变量由滚动位置直接决定，与 iOS 大标题收起同一套模型——不是阈值开关：
 *   下滑越过起点后，滚多少就收多少（收窄、变矮、文字淡出同步进行）；上滑即反向
 *   展开，回到顶部完全归位。手指停住，玻璃就停在当前档位；指头一动立刻跟着变。
 *   目标值每帧向自身靠拢一层（追帧平滑），带出液体的滞后与回弹感；最终以 CSS
 *   变量 --mini(0~1) 写入底栏，样式表里各部件尺寸都是它的连续函数。
 *
 * 二、真折射（仅 Chromium：backdrop-filter 支持引用 SVG 滤镜）
 *   用 canvas 按底栏实际尺寸生成「边缘位移贴图」：把玻璃边缘建模成微凸曲面，
 *   R/G 通道编码 X/Y 位移（128 = 不动），经 feImage + feDisplacementMap 弯折玻璃
 *   背后的内容，边缘因此呈现真玻璃的折射。贴图以 100% 铺满滤镜区域，形变过程中
 *   由浏览器自动拉伸、不逐帧重建；尺寸收敛后（防抖 160ms）再按新尺寸重建保证清晰。
 *   其余内核（iOS 全系 / Firefox）检测不通过自动跳过，走 style.css 的毛玻璃 + 流光高光。
 */
(function () {
  'use strict';

  var bar = document.getElementById('tab-bar');
  if (!bar) return;

  /* ==================== 一、随手指的连续形变 ==================== */

  (function initScrollMorph() {
    var main = document.getElementById('app-main');
    if (!main) return;

    var START = 36;    // 滚动超过该位置开始收缩（顶部留一小段缓冲，完整展示）
    var RANGE = 100;   // 再滚动这么多像素收缩到底
    var EASE = 0.22;   // 每帧向目标靠拢的比例：越大越跟手，越小越「液」
    var reduce = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) EASE = 1;   // 减弱动态效果：去掉平滑，仍随滚动位置实时变化

    var cur = 0, raf = 0, lastT = 0;

    function target() {
      var t = (main.scrollTop - START) / RANGE;
      return t < 0 ? 0 : (t > 1 ? 1 : t);
    }

    function apply(v) { bar.style.setProperty('--mini', v.toFixed(4)); }

    function tick(now) {
      // 帧间隔补偿：60/120Hz 手感一致，低帧率设备也不会变迟钝
      var dt = lastT ? Math.min(64, now - lastT) : 16.7;
      lastT = now;
      var k = 1 - Math.pow(1 - EASE, dt / 16.7);

      var t = target();
      cur += (t - cur) * k;
      if (Math.abs(t - cur) < 0.002) { cur = t; raf = 0; lastT = 0; }  // 追平后停帧，省电
      apply(cur);
      if (raf) raf = requestAnimationFrame(tick);
    }

    function kick() { if (!raf) raf = requestAnimationFrame(tick); }

    cur = target();
    apply(cur);
    main.addEventListener('scroll', kick, { passive: true });
    window.addEventListener('resize', kick);   // 地址栏收展 / 旋转屏幕后重新对齐
  })();

  /* ==================== 二、真折射（仅 Chromium） ==================== */

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

  var feImage = document.getElementById('lg-feimage');
  var feDisp = document.getElementById('lg-displace');
  if (!canRefract || !feImage || !feDisp) return;

  /* 折射参数：按手机底栏尺寸调的克制数值 */
  var BEZEL = 11;      // 折射带宽（px）：从边缘往内多宽开始弯
  var MAX_DISP = 7;    // 最大位移（px）：边缘最多把背景「拉」进来多少
  var PROFILE = 2.1;   // 位移曲线指数：越大越集中在最边缘

  var lastW = 0, lastH = 0, timer = 0, first = true;

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

  function build() {
    var w = Math.max(2, Math.round(bar.offsetWidth));
    var h = Math.max(2, Math.round(bar.offsetHeight));
    if (!first && Math.abs(w - lastW) <= 3 && Math.abs(h - lastH) <= 3) return;
    first = false;
    lastW = w; lastH = h;
    var url = buildDisplacementMap(w, h, h / 2);    // 胶囊：圆角 = 高度一半
    feImage.setAttribute('href', url);
    feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
    feDisp.setAttribute('scale', String(MAX_DISP));
    // 首个贴图就绪后再开折射，避免首帧拿到空贴图出现整块错位
    if (w > 4 && !bar.classList.contains('lg-refract')) {
      var probe = new Image();
      probe.onload = function () { bar.classList.add('lg-refract'); };
      probe.src = url;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(build, 160);   // 等形变收敛再重建，避免拖动中逐帧生成
  }

  build();
  if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(bar);
  else window.addEventListener('resize', schedule);
})();
