/**
 * liquid-glass.js —— 底部导航「液态玻璃」交互层（iOS 26 风格）
 *
 * 一、随手指的纵向连续形变（全平台生效）
 *   形变量由滚动位置直接决定，与 iOS 大标题收起同一套模型——不是阈值开关：
 *   下滑越过起点后，滚多少就收多少（收窄、变矮、文字淡出同步进行）；上滑即反向
 *   展开，回到顶部完全归位。手指停住，玻璃就停在当前档位；指头一动立刻跟着变。
 *   目标值每帧向自身靠拢一层（追帧平滑），带出液体的滞后与回弹感。
 *   同一条追帧循环还驱动顶栏的 --hdr：内容一顶上来，顶栏玻璃就显形（iOS 滚动
 *   边缘做法——顶部无内容经过时保持通透）。
 *
 * 二、玻璃块随手指横向拖动（全平台生效）
 *   按住底栏左右滑（或在页面内容上横向滑），选中的玻璃块 1:1 跟着手指走。
 *   松手时先做「动量投射」——按手指速度算出玻璃本来会滑到哪，再用那个落点选目标档位，
 *   快甩因此能一次跨过好几档；随后把手指速度交给弹簧继续跑，松手处既不停顿、
 *   也没有速度突变（这两件事是「跟手」与「不跟手」的分界）。越界拖动由橡皮筋
 *   渐进衰减，读作「有响应，但这边没有了」，而不是硬停的「卡住了」。
 *   点按走同一套弹簧，但没有动量、不越界。手势与弹簧期间写入小数 --tab-pos，
 *   收敛后原子式交还 --tab-index（此刻两者相等，无跳变）。
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
    var header = document.getElementById('app-header');

    /* 两条映射：底栏玻璃块的收缩（36px 起步、100px 收到底）
       和顶栏材质的显形（8px 就开始、42px 显完——内容一顶上来玻璃就要接住）。
       都用 smoothstep 让首尾变化率趋零，没有可察觉的「启动点」。 */
    function smooth(t) { return t * t * (3 - 2 * t); }
    function miniTarget() {
      return smooth(Math.min(1, Math.max(0, (main.scrollTop - 36) / 100)));
    }
    function hdrTarget() {
      return smooth(Math.min(1, Math.max(0, (main.scrollTop - 8) / 42)));
    }

    var EASE = 0.22;   // 每帧向目标靠拢的比例：越大越跟手，越小越「液」
    var reduce = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) EASE = 1;   // 减弱动态效果：去掉平滑，仍随滚动位置实时变化

    var curMini = 0, curHdr = 0, raf = 0, lastT = 0;

    function apply() {
      bar.style.setProperty('--mini', curMini.toFixed(4));
      if (header) header.style.setProperty('--hdr', curHdr.toFixed(4));
    }

    function tick(now) {
      // 帧间隔补偿：60/120Hz 手感一致，低帧率设备也不会变迟钝
      var dt = lastT ? Math.min(64, now - lastT) : 16.7;
      lastT = now;
      var k = 1 - Math.pow(1 - EASE, dt / 16.7);

      var tm = miniTarget(), th = hdrTarget();
      curMini += (tm - curMini) * k;
      curHdr += (th - curHdr) * k;
      // 追平后停帧，省电（两条都到位才算完）
      if (Math.abs(tm - curMini) < 0.002 && Math.abs(th - curHdr) < 0.002) {
        curMini = tm; curHdr = th;
        raf = 0; lastT = 0;
      }
      apply();
      if (raf) raf = requestAnimationFrame(tick);
    }

    function kick() { if (!raf) raf = requestAnimationFrame(tick); }

    curMini = miniTarget();
    curHdr = hdrTarget();
    apply();
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

    var tracker = new Spring.Tracker();   // 最近 100ms 的位置采样，松手时用来算速度
    var axis = null;                      // 松手后的归位弹簧
    var shown = 0;                        // 屏幕上真实呈现的位置（档，可为小数）

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
    /* 越界不再硬停：超出部分按橡皮筋衰减，连续「顶住」而不是「卡住」 */
    function resist(p) {
      if (p < 0) return Spring.rubberband(p, MAX);
      if (p > MAX) return MAX + Spring.rubberband(p - MAX, MAX);
      return p;
    }
    function posFromX(clientX) {
      var g = geometry();
      return g.step > 0 ? (clientX - g.x0) / g.step : currentIdx();   // 原始值，越界交给 resist
    }
    /* 当前呈现位置：弹簧在跑就取它的实时值，静止时取 --tab-index */
    function shownPos() {
      return axis ? shown : currentIdx();
    }
    function setPos(p) {
      shown = p;
      bar.style.setProperty('--tab-pos', p.toFixed(4));
    }
    /* 弹簧接管 --tab-pos：从当前呈现值出发、继承手指速度，收敛后再交还 --tab-index。
       期间挂 .tab-springing 关掉 CSS 过渡，避免两套曲线打架。 */
    function springTo(idx, from, v, step) {
      if (axis) axis.kill();                         // 打断上一次，从当前值接续（不跳变）
      bar.classList.add('tab-springing');
      setPos(from);                                  // 先钉住起点，避免首帧跳到 --tab-index
      // 有动量才允许轻微回弹；纯点按不越界（过冲只在手势本身带了动量时才对）
      var preset = Math.abs(v) > 0.35 ? Spring.PRESET.momentum : Spring.PRESET.move;
      axis = new Spring.Axis({
        from: from,
        damping: preset.damping,
        response: preset.response,
        velocity: v * step,                          // 档/秒 → px/秒，与弹簧位移同单位
        onUpdate: setPos
      });
      axis.onSettle = function () {
        axis = null;
        bar.style.removeProperty('--tab-pos');       // 交还 --tab-index（此刻两者相等，无跳变）
        bar.classList.remove('tab-springing');
      };
      axis.set(idx);
    }

    /* 内容区起点落在输入框、可横向滚动的元素或 .lg-noscrub 标记区上时不接管
       （避免抢走该有的手势；.lg-noscrub 用于生活页的日子卡片——它的横向手势是切换卡片） */
    function blocked(el) {
      if (!el || !el.closest) return false;
      if (el.closest('input, textarea, select, [contenteditable]')) return true;
      if (el.closest('.lg-noscrub')) return true;
      for (var n = el; n && n !== main; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth + 4) return true;
      }
      return false;
    }

    /* 只记起点，不动玻璃：按下后没变成拖动的（纯点按）不该干扰正在跑的弹簧 */
    function begin(e, from) {
      if (source) return;                            // 已有指针在手，忽略后续手指
      source = from;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      dragging = false;
      tracker.reset();
    }

    function move(e) {
      if (!source || e.pointerId !== pointerId) return;
      var dx = e.clientX - startX, dy = e.clientY - startY;
      if (!dragging) {
        var need = source === 'bar' ? ENGAGE_BAR : ENGAGE_PAGE;
        if (Math.abs(dx) < need || Math.abs(dx) <= Math.abs(dy)) return;  // 纵向意图留给滚动
        dragging = true;                             // 明确横向：接管本次手势
        if (axis) { axis.kill(); axis = null; }       // 抓住一个还在归位的玻璃块
        bar.classList.remove('tab-springing');        // 拖动直接写 --tab-pos，不需要过渡开关
        baseIdx = currentIdx();                      // 基准 = 当前页签
        engageX = e.clientX;                         // 从接管处起算，不累计阈值前位移
        bar.classList.add('tab-dragging');
      }
      var raw;
      if (source === 'bar') {
        raw = posFromX(e.clientX);                   // 底栏内：直接按手指位置对准
      } else {
        // 轮播语义：手指左滑（向右负）= 下一页从右侧进来，玻璃块右移一档
        var step = geometry().step;
        raw = step > 0 ? baseIdx - (e.clientX - engageX) / step : baseIdx;
      }
      pos = resist(raw);                             // pos 始终是屏幕上真实呈现的值
      tracker.push(pos, performance.now());
      setPos(pos);
    }

    function end(e, cancelled) {
      if (!source || e.pointerId !== pointerId) return;
      var wasDragging = dragging;
      source = '';
      dragging = false;
      if (!wasDragging) return;                      // 只是点按：放行原生 click

      bar.classList.remove('tab-dragging');
      var v = tracker.velocity();                    // 档/秒
      var step = geometry().step;

      // 手势被系统接管（拿去滚动）：原地弹回，不切页
      if (cancelled) { springTo(currentIdx(), pos, 0, step); return; }

      // ① 动量投射：用「本来会滑到哪」选目标，而不是松手点——甩一下就多走几档
      var landed = pos + Spring.project(v);
      var idx = Math.round(landed);
      if (idx < 0) idx = 0; else if (idx > MAX) idx = MAX;

      if (idx !== currentIdx()) {
        suppressClick = true;                        // 吞掉手势尾随的原生 click，避免二次切换
        clearTimeout(suppressTimer);
        suppressTimer = setTimeout(function () { suppressClick = false; }, 400);
        programmatic = true;
        tabs[idx].click();                           // 复用 app.js 既有的点击切换逻辑
        programmatic = false;
        Spring.haptic(8);                            // 与弹簧启动同帧，因果才成立
      }
      // ② 视觉仍由 --tab-pos 驱动，弹簧从当前值出发并继承手指速度
      springTo(idx, pos, v, step);
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

    /* 点按页签：app.js 的 click 处理器只改 --tab-index，位置动画由这里补弹簧。
       捕获阶段先记下起点，冒泡阶段（switchView 已改完 --tab-index）再起弹簧。 */
    var tapFrom = -1;
    bar.addEventListener('click', function () {
      if (!programmatic) tapFrom = shownPos();
    }, true);
    bar.addEventListener('click', function () {
      if (programmatic || tapFrom < 0) return;
      var from = tapFrom;
      tapFrom = -1;
      var to = currentIdx();
      if (to === from) return;                       // 点的是当前页签：本来就不动
      springTo(to, from, 0, geometry().step);        // 无动量的点按：精准到位、不弹
      Spring.haptic(8);
    });

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
  /* 折射是纯装饰的透明度增强：用户明确要求减少透明度时应当关闭 */
  var reduceTransparency = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-transparency: reduce)').matches);
  var canRefract = false;
  try {
    canRefract = !reduceTransparency && chromium && window.CSS &&
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
