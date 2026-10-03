/**
 * liquid-glass.js —— 底部导航「液态玻璃」交互层（iOS 26 风格）
 *
 * 一、滚动收缩 / 展开（全平台生效，纯类切换，形变交给 CSS 过渡）
 *   与 iOS 26 的滚动边缘效果一致：内容连续下滑超过阈值，底栏收窄变矮、隐去文字
 *   只留图标；上滑或回到顶部再展开。点按底栏（切换页面）时也会展开。
 *
 * 二、真折射（仅 Chromium：backdrop-filter 支持引用 SVG 滤镜）
 *   用 canvas 按底栏实际尺寸生成「边缘位移贴图」：把玻璃边缘建模成微凸曲面，
 *   R/G 通道编码 X/Y 位移（128 = 不动），经 feImage + feDisplacementMap 弯折玻璃
 *   背后的内容，边缘因此呈现真玻璃的折射。贴图以 100% 铺满滤镜区域，收缩动画中
 *   由浏览器自动拉伸、不逐帧重建；尺寸收敛后（防抖 160ms）再按新尺寸重建保证清晰。
 *   其余内核（iOS 全系 / Firefox）检测不通过自动跳过，走 style.css 的毛玻璃 + 流光高光。
 */
(function () {
  'use strict';

  var bar = document.getElementById('tab-bar');
  if (!bar) return;

  /* ==================== 一、滚动收缩 / 展开 ==================== */

  (function initMinimize() {
    var main = document.getElementById('app-main');
    if (!main) return;

    var MINI_AFTER = 46;    // 连续下滑累计超过此值 → 收缩
    var EXPAND_AFTER = 18;  // 连续上滑累计超过此值 → 展开
    var JUMP = 240;         // 单次跳变超过此值视为程序性定位（切页恢复滚动位置），忽略
    var TOP_ZONE = 8;       // 滚动到顶部附近必展开
    var suppressUntil = 0;  // 点按底栏后的静默截止时间戳

    var lastY = main.scrollTop;
    var acc = 0;
    var mini = false;

    function setMini(on) {
      if (mini === on) return;
      mini = on;
      bar.classList.toggle('tab-mini', on);
    }

    main.addEventListener('scroll', function () {
      var y = main.scrollTop;
      var dy = y - lastY;
      lastY = y;
      if (Date.now() < suppressUntil) return;        // 切页定位期间不响应
      if (Math.abs(dy) > JUMP) { acc = 0; return; }  // 程序性跳变
      if (dy === 0) return;
      if (y <= TOP_ZONE) { acc = 0; setMini(false); return; }
      if ((dy > 0) !== (acc > 0)) acc = 0;           // 方向反转：重新累计
      acc += dy;
      if (!mini && acc > MINI_AFTER) setMini(true);
      else if (mini && acc < -EXPAND_AFTER) setMini(false);
    }, { passive: true });

    // 点按底栏是一次明确的导航动作：展开，并短暂静默滚动事件（避免切页定位被误判）
    bar.addEventListener('click', function () {
      suppressUntil = Date.now() + 600;
      acc = 0;
      setMini(false);
    });

    // 视口尺寸变化（手机地址栏收展 / 旋转屏幕）会引发重排与惯性滚动事件，
    // 其间不改变收缩状态，并重置累计基准，避免把重排误判成用户滑动。
    window.addEventListener('resize', function () {
      suppressUntil = Math.max(suppressUntil, Date.now() + 250);
      acc = 0;
      lastY = main.scrollTop;
    });
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
    timer = setTimeout(build, 160);   // 等收缩/展开动画收敛再重建，避免动画中逐帧生成
  }

  build();
  if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(bar);
  else window.addEventListener('resize', schedule);
})();
