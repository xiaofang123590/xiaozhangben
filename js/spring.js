/**
 * spring.js —— 全站弹簧动画内核
 *
 * 参数制沿用 Apple（WWDC 2018《Designing Fluid Interfaces》）：
 *   damping  阻尼比——1.0 精准不越界，0.8 轻微回弹（只有手势带动量时才该回弹）
 *   response 响应时间（秒）——越小越快。注意它**不是 duration**：
 *            弹簧没有固定时长，收敛时间由参数涌现。
 *
 * 与 CSS 过渡的本质差别：弹簧可以从「当前呈现值」出发、并继承「当前速度」，
 * 所以随时可以被抓住、改目标、反向，而不会出现跳变或速度突变。
 *
 * 被 liquid-glass.js（底栏玻璃块）与 app.js（抽屉 / 页面切换）共用。
 */
(function (global) {
  'use strict';

  var reduce = false;
  try {
    reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { /* 忽略 */ }

  /* Apple 参数 → 物理参数（质量归一为 1）
     ω₀ = 2π/response 为固有角频率；k = ω₀²，c = 2ζω₀ */
  function physics(damping, response) {
    var w0 = (2 * Math.PI) / response;
    return { k: w0 * w0, c: 2 * damping * w0 };
  }

  /* 动量投射：松手后物体「本来会滑到哪」。
     用的是 Apple 的指数衰减式，不是物理课本的 v²/(2·decel)。
     系数无量纲：喂 px/s 得 px，喂「档/s」得「档」。 */
  function project(v, d) {
    if (d == null) d = 0.998;                 // 0.998 常规滚动手感 / 0.99 更干脆
    return ((v / 1000) * d) / (1 - d);
  }

  /* 边界阻尼：越过边界越远，跟手越少 —— 连续「顶住」，而不是硬停。
     硬停读作「卡住了」，连续阻尼读作「有响应，但这边没有了」。 */
  function rubberband(overshoot, dim, constant) {
    if (constant == null) constant = 0.55;
    var abs = Math.abs(overshoot);
    return (overshoot * dim * constant) / (dim + constant * abs);
  }

  /* 速度记录：只留最近一小段采样，取末段平均速度（比「最后两点」抗抖） */
  var V_WINDOW = 100;   // 求平均的时间窗（ms）
  var V_STALE = 70;     // 超过这么久没有新采样 = 手指已经停住，动量归零

  function Tracker() { this.samples = []; }

  Tracker.prototype.push = function (pos, t) {
    this.samples.push({ p: pos, t: t });
    while (this.samples.length > 2 && t - this.samples[0].t > V_WINDOW * 2) this.samples.shift();
  };

  /**
   * 取速度（单位/秒）。now 省略时取当前时刻。
   *
   * 「手指停住」必须单独判定，不能只靠滑动时间窗：只在 push 时淘汰样本的话，
   * 停住不动时样本不会被清掉，松手算出的仍是停住之前那段的速度——
   * 一记「拖过去再停住」会被误判成甩动。这里用 V_STALE 判停，
   * 平均窗口则锚在最后一个采样上（而不是松手时刻），以兼容 pointerup 的正常延迟
   * ——否则真实快甩会因为在抬手前有几十毫秒没有新采样而被判成静止。
   */
  Tracker.prototype.velocity = function (now) {
    if (now == null) now = performance.now();
    var s = this.samples;
    if (s.length < 2) return 0;
    var last = s[s.length - 1];
    if (now - last.t > V_STALE) return 0;              // 手指已停住
    var first = s[0];
    for (var i = s.length - 2; i >= 0; i--) {          // 窗口锚在 last，往前取 V_WINDOW
      if (last.t - s[i].t > V_WINDOW) break;
      first = s[i];
    }
    var dt = (last.t - first.t) / 1000;
    return dt > 0 ? (last.p - first.p) / dt : 0;       // 单位/秒
  };

  Tracker.prototype.reset = function () { this.samples.length = 0; };

  /**
   * 单轴弹簧控制器。
   * 随时 set() 改目标（打断），随时可注入速度（手势交接）。
   */
  function Axis(opts) {
    this.value = opts.from;
    this.target = opts.from;
    this.velocity = opts.velocity || 0;       // 初始速度 = 松手瞬间的手指速度
    this.p = physics(opts.damping, opts.response);
    this.onUpdate = opts.onUpdate;
    this.onSettle = opts.onSettle || null;
    this.raf = 0;
    this.last = 0;
  }

  /* 改目标；给了 velocity 就同时注入速度（速度交接） */
  Axis.prototype.set = function (target, velocity) {
    this.target = target;
    if (velocity != null) this.velocity = velocity;
    this.start();
  };

  /* 打断：停帧并返回当前呈现值，供新的动画从这里接续 */
  Axis.prototype.kill = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = 0;
    return this.value;
  };

  Axis.prototype.start = function () {
    if (this.raf) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.tick.bind(this));
  };

  Axis.prototype.tick = function (now) {
    // 帧间隔补偿：60/120Hz 手感一致，低帧率设备也不会变迟钝
    var dt = this.last ? Math.min(64, now - this.last) : 16.7;
    this.last = now;

    if (reduce) {
      // 减弱动态效果：直接到位。状态变化依然可见，只是不再位移
      this.value = this.target;
      this.velocity = 0;
    } else {
      // 定步长双子步积分：刚度大时也不发散，且与刷新率解耦
      var steps = Math.max(1, Math.ceil(dt / 4));
      var h = (dt / 1000) / steps;
      for (var i = 0; i < steps; i++) {
        var a = -this.p.k * (this.value - this.target) - this.p.c * this.velocity;
        this.velocity += a * h;
        this.value += this.velocity * h;
      }
    }

    this.onUpdate(this.value, this.velocity);

    // 收敛判据：位移与速度都足够小
    if (Math.abs(this.value - this.target) < 0.01 && Math.abs(this.velocity) < 1) {
      this.value = this.target;
      this.velocity = 0;
      this.onUpdate(this.value, 0);
      this.raf = 0;
      this.last = 0;
      if (this.onSettle) this.onSettle();
      return;
    }
    this.raf = requestAnimationFrame(this.tick.bind(this));
  };

  /* 触感反馈：必须与视觉在同一帧触发，否则因果错觉断裂。
     navigator.vibrate 仅安卓 Chromium 生效，iOS 静默降级（不做嗅探提示）。
     只用在值得的时刻：提交、落定、报错——滥用会让人忽略全部反馈。 */
  function haptic(ms) {
    if (!navigator.vibrate) return;
    try { navigator.vibrate(ms || 10); } catch (e) { /* 部分浏览器需用户手势，失败忽略 */ }
  }

  global.Spring = {
    physics: physics,
    project: project,
    rubberband: rubberband,
    haptic: haptic,
    Tracker: Tracker,
    Axis: Axis,
    reduced: reduce,
    /* Apple 出厂值（WWDC 2018 参数表） */
    PRESET: {
      move:     { damping: 1.0, response: 0.4 },   // 位移 / 归位（不越界）
      drawer:   { damping: 0.8, response: 0.3 },   // 抽屉 / 面板
      momentum: { damping: 0.8, response: 0.4 }    // 手势带动量时的甩动
    }
  };
})(window);
