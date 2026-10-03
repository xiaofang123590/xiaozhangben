/**
 * liquid-glass.js —— 底部导航「液态玻璃」交互层（iOS 26 风格）
 *
 * 一、随手指的纵向连续形变（全平台生效）
 *   形变量由滚动位置直接决定，与 iOS 大标题收起同一套模型——不是阈值开关：
 *   下滑越过起点后，滚多少就收多少（收窄、变矮、文字淡出同步进行）；上滑即反向
 *   展开，回到顶部完全归位。手指停住，玻璃就停在当前档位；指头一动立刻跟着变。
 *   目标值每帧向自身靠拢一层（追帧平滑），带出液体的滞后与回弹感；最终以 CSS
 *   变量 --mini(0~1) 写入底栏，样式表里各部件尺寸都是它的连续函数。
 *
 * 二、玻璃块随手指横向拖动（全平台生效）
 *   按住底栏左右滑（或在页面内容上横向滑），选中的玻璃块 1:1 跟着手指走；
 *   松手回弹到最近页签并切换页面。点按行为不变，仍走原有 click 切换。
 *   拖动期间写入小数 --tab-pos 并关闭回弹过渡，松手清除后由 --tab-index 接管。
 *
 * 三、真折射（仅 Chromium：backdrop-filter 支持引用 SVG 滤镜）
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

  /* ==================== 二、玻璃块随手指横向拖动 ==================== */

  (function initScrub() {
    if (!window.PointerEvent) return;              // 无指针事件的内核只保留点按切换
    var tabs = bar.querySelectorAll('.tab');
    if (tabs.length < 2) return;
    var main = document.getElementById('app-main');

    var ENGAGE_BAR = 6;    // 底栏内：横向位移超过此值即接管（要跟手，阈值小）
    var ENGAGE_PAGE = 44;  // 内容区：滑动须明确是横向意图，阈值大一些
    var MAX = tabs.length - 1;

    var source = '';       // 'bar' | 'page'：本次手势的起点区域
    var pointerId = -1;
    var startX = 0, startY = 0;
    var baseIdx = 0, engageX = 0;   // 内容区滑动：以接管瞬间为基准，避免起手跳变
    var dragging = false, pos = 0;
    var programmatic = false, suppressClick = false, suppressTimer = 0;

    function currentIdx() {
      return Number(bar.style.getPropertyValue('--tab-index')) || 0;
    }
    /* 以页签中心为刻度的横向坐标系：手指落在某页签中心 = 整数档 */
    function geometry() {
      var a = tabs[0].getBoundingClientRect();
      var b = tabs[MAX].getBoundingClientRect();
      var x0 = a.left + a.width / 2;
      return { x0: x0, step: (b.left + b.width / 2 - x0) / MAX };
    }
    function clampPos(p) { return p < 0 ? 0 : (p > MAX ? MAX : p); }
    function posFromX(clientX) {
      var g = geometry();
      return g.step > 0 ? clampPos((clientX - g.x0) / g.step) : currentIdx();
    }

    /* 内容区起点落在输入框或可横向滚动的元素上时不接管（避免抢走该有的手势） */
    function blocked(el) {
      if (!el || !el.closest) return false;
      if (el.closest('input, textarea, select, [contenteditable]')) return true;
      for (var n = el; n && n !== main; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth + 4) return true;
      }
      return false;
    }

    function begin(e, from) {
      if (source) return;                            // 已有指针在手，忽略后续手指
      source = from;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      dragging = false;
    }

    function move(e) {
      if (!source || e.pointerId !== pointerId) return;
      var dx = e.clientX - startX, dy = e.clientY - startY;
      if (!dragging) {
        var need = source === 'bar' ? ENGAGE_BAR : ENGAGE_PAGE;
        if (Math.abs(dx) < need || Math.abs(dx) <= Math.abs(dy)) return;  // 纵向意图留给滚动
        dragging = true;                             // 明确横向：接管本次手势
        baseIdx = currentIdx();                      // 基准 = 当前页签
        engageX = e.clientX;                         // 从接管处起算，不累计阈值前位移
        bar.classList.add('tab-dragging');
      }
      if (source === 'bar') {
        pos = posFromX(e.clientX);                   // 底栏内：直接按手指位置对准
      } else {
        // 轮播语义：手指左滑（向右负）= 下一页从右侧进来，玻璃块右移一档
        var step = geometry().step;
        pos = step > 0 ? clampPos(baseIdx - (e.clientX - engageX) / step) : baseIdx;
      }
      bar.style.setProperty('--tab-pos', pos.toFixed(4));
    }

    function end(e, cancelled) {
      if (!source || e.pointerId !== pointerId) return;
      var wasDragging = dragging;
      source = '';
      dragging = false;
      if (!wasDragging) return;                      // 只是点按：放行原生 click
      bar.classList.remove('tab-dragging');
      bar.style.removeProperty('--tab-pos');         // 交还给 --tab-index 驱动
      if (cancelled) return;                         // 手势被系统接管（拿去滚动）：回弹，不切页
      var idx = Math.round(pos);
      if (idx === currentIdx()) return;              // 回弹到原页签
      suppressClick = true;                          // 吞掉手势尾随的原生 click，避免二次切换
      clearTimeout(suppressTimer);
      suppressTimer = setTimeout(function () { suppressClick = false; }, 400);
      programmatic = true;
      tabs[idx].click();                             // 复用 app.js 既有的点击切换逻辑
      programmatic = false;
    }

    bar.addEventListener('pointerdown', function (e) {
      if (e.isPrimary === false || (e.pointerType === 'mouse' && e.button !== 0)) return;
      begin(e, 'bar');
    });
    main.addEventListener('pointerdown', function (e) {
      if (e.isPrimary === false || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (blocked(e.target)) return;
      begin(e, 'page');
    });
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', function (e) { end(e, false); });
    window.addEventListener('pointercancel', function (e) { end(e, true); });

    // 拖动结束后尾随的那次原生 click 需要吞掉（程序性 click 放行，
    // 否则原生 click 会落在起手页签上造成「切了又切回去」）
    document.addEventListener('click', function (e) {
      if (programmatic) return;
      if (suppressClick) {
        suppressClick = false;
        e.stopPropagation();
      }
    }, true);
  })();

  /* ==================== 三、真折射（仅 Chromium） ==================== */

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
