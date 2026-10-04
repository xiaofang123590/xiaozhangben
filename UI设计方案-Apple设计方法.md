# 小账本 · UI 重设计方案

> 依据：Apple WWDC《Designing Fluid Interfaces》《Principles of Great Design》《The Details of UI Typography》
> 对象：`index.html` / `css/style.css` / `js/liquid-glass.js` / `js/app.js` 现状
> 日期：2026-10-03

---

## 0. 一句话结论

**视觉底子已经是专业水准，缺的是"手感"这一层。**

配色体系、八套色板、明暗双模、线性图标、数字排版、液态玻璃底栏——这些是需要审美和自制力才能做出来的东西，已经在了。真正拉开差距的是**交互的物理性**：目前全站 43 处过渡**没有一处是弹簧**，一律是固定时长的 `cubic-bezier`；手势甩动**没有被投射**，松手速度**被丢掉**，越界**硬停**，抽屉退场**没有动画**。

这四件事改完，同样的像素会长出"活"的感觉——**这是投入产出比最高的方向，且不改动任何视觉设计。**

---

## 1. 现状评估

### 1.1 已经做对的（保留，不要动）

| 项 | 评价 |
|---|---|
| 语义化设计变量体系 | `css/style.css:12-105` 分品牌色族/文字灰阶/语义色/图表色四层解耦，换色板时"收入绿"不漂移——这是**正确的架构**，很多商业产品都做不到 |
| 八色板 × 明暗双模 | 每档文字对比度都标注了 WCAG 比值（4.5:1~12.6:1），且预览卡是真·迷你渲染而非色块 |
| 底栏滚动连续形变 | `liquid-glass.js:31-70` 用 `--mini` 把收缩量做成滚动位置的**连续函数**——正是 Apple "反馈必须贯穿交互全程，而不只在结束时"（§1）的教科书写法。带帧间隔补偿、收敛即停帧省电，实现质量很高 |
| 真折射 | `liquid-glass.js:216-249` 用 canvas 生成圆角矩形 SDF 位移贴图，`feImage` + `feDisplacementMap` 弯折真实背景——这是超出绝大多数 Web 应用的材质水平 |
| 手势意图判定 | `liquid-glass.js:80-81` 底栏 6px / 内容区 44px 双档阈值，横向位移须大于纵向才接管——§10"并行检测所有合理手势，意图明确后取消落选者" |
| 触感反馈 | `app.js:78-79` 保存时 12ms 振动，且明确标注"部分浏览器需用户手势，失败忽略" |
| 数字排版 | 33 处 `tabular-nums`，金额永不跳动；英雄数字 `-0.02em` 光学收紧（§15 尺寸相关字距） |
| 成功反馈 | `#success-flash` 打勾描线动画 + 文案，是 §13"只在值得的时刻给反馈"的正确用法 |

### 1.2 核心差距

一句话：**动效是"播"出来的，不是"演"出来的。**

Apple 的原话——"把动画当成你与物体之间的对话，而不是界面单方面规定的动作"。当前全站的过渡都是**单方面规定的**：给定起点终点，按时长走完，中途无法被抓住、也无法继承速度。这正是"能用"和"跟手"的分界线。

---

## 2. 核心诊断（六项，均附代码位置）

### D1 · 甩动没有被投射 ← 最高价值

`js/liquid-glass.js:156`

```js
var idx = Math.round(pos);          // 松手点的最近档位
```

玻璃块落在**松手点**的最近档位，而不是**按速度投射出的落点**的最近档位。

后果：从第 1 档快速右甩，手指在 150ms 内划过 1.8 档（≈12 档/秒），松手时 `pos = 1.8` → `Math.round` → **只前进 1 档**。而按 §6"取小输入、放大输出"，这一甩本来应该把玻璃扔到远端。

这是**感知差异最大的一处**：慢拖和快甩目前的落点完全相同，用户"用力"这个动作没有被界面承认。

### D2 · 松手瞬间速度断档

`js/liquid-glass.js:154-156` + `css/style.css:1990`

```js
bar.style.removeProperty('--tab-pos');   // 交还给 --tab-index 驱动
/* CSS: transition: transform 0.38s cubic-bezier(0.3, 1.36, 0.42, 1); */
```

松手后玻璃改由 CSS 过渡驱动。两个问题：

1. **速度丢失**——CSS 过渡重新指向时初始速度恒为 0，手指的速度无法交接（§5）。玻璃在松手处停顿一下，再按预设曲线重新起步，这就是"接缝感"的来源。
2. **过冲用错了场合**——`0.3, 1.36` 这条曲线自带回弹。但 §4 明确：**只有手势本身带了动量才该有回弹**。点按页签（无手势、无动量）也弹一下，是"菜单淡入却突然弹跳"式的错误。

### D3 · 越界硬停

`js/liquid-glass.js:101`

```js
function clampPos(p) { return p < 0 ? 0 : (p > MAX ? MAX : p); }
```

拖到第 1 档或第 5 档后再往同方向拖，玻璃**纹丝不动**。§9：硬停读作"卡住了"，连续阻尼读作"有响应，但这边没有了"。需要橡皮筋。

### D4 · 抽屉（底部弹窗）

`js/app.js:1329-1359` + `css/style.css:1278-1292`

四处问题：

**(a) 没有退场动画。** 入场有 `animation: slideUp 0.3s`，关闭却是 `modal.classList.add('hidden')` → `.hidden { display: none !important }` → **瞬间消失**。§7"若它从某处消失，就该从那里出现"，§12"材质化，而不只是淡出"。现在是有来无回。

**(b) 用位置判定而非速度。** `if (dy > 80)` —— 一记 40px 的快速下甩甩不掉（位置不够），一次 100px 的缓慢拖动却会误关。§5：**判定反向还是提交，用速度的符号，不用位置。**

**(c) 弹回依赖 CSS 过渡。** `body.style.transition = ''` 把控制权交还给固定的 0.24s 曲线，下拖过程累积的速度全部丢弃。

**(d) 只能抓把手，且无法反悔。** 手势只绑在 `.modal-handle` 上（`app.js:1337`），抽屉主体抓不动；关闭过程中也无法再抓住制止（§3 可打断性）。

此外，13 处关闭点散落在 `app.js` 各处（317/973/1107/1272/1283/1354/1441/1446/1454/1519/1563/1566/1586），需要统一收口才能加退场。

### D5 · 无障碍三信号只做了一个，且做法过猛

`css/style.css:1429-1437`

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: 0.01ms !important;
  }
}
```

两个问题：

- **缺 `prefers-reduced-transparency`**——对一个以玻璃为核心识别的应用，这个信号的缺失最要命：明确要求"减少透明度"的用户，依然会看到底栏毛玻璃、抽屉遮罩模糊、以及 Chromium 上完整的 SVG 折射。`liquid-glass.js:198-202` 的 `canRefract` 判定也应该并入这个查询。
- **缺 `prefers-contrast: more`。**
- **做法是"关掉一切"而不是"换个温和的等价物"**：§14 明确说减弱动态≠没有反馈，应该换成交叉淡入。现在 `0.01ms` 把所有状态变化压成硬切，反而丢掉了"状态变了"的感知线索。

### D6 · 顶栏与底栏的材质叙事不对称

`css/style.css` 中 `#app-header` 无背景、位于滚动容器之外（`#app-main` 是唯一滚动容器），而 `#tab-bar` 是 `position: absolute` 的浮层，内容从其下方穿过（`style.css:1966` 起）。

结果是**两端材质逻辑相反**：底端是"悬浮玻璃 + 内容下穿"，顶端是"静态色带 + 内容硬切"。全站也没有任何滚动边缘效果（`grep mask-image` 无结果）。§12：层级要用同一套材质语言表达。

### D7 · 布局全 px，用户字号设置无效

`grep -c "rem" css/style.css` → **0**。全站 3645 行没有一处 rem。

`body { font-size: 15px }` 固定，浏览器/系统"默认字号"设置完全不影响界面；部分安卓浏览器和国内套壳浏览器的"最小字号"限制还会直接撑破用 px 写死的卡片布局。§15：**字号要跟着用户设置缩放，间距用 rem/em 而非固定 px。**

### D8 · 页面切换只有入场，没有出场

`js/app.js:126-129`

```js
for (var i = 0; i < views.length; i++) views[i].classList.add('hidden');  // 全部瞬间隐藏
incoming.classList.remove('hidden');
// 只给 incoming 加 view-fwd / view-back → 关键帧动画
```

出场视图是**瞬间消失**的，入场视图滑入——半条路径。且基于 `@keyframes` 固定播完，快速连点页签会反复从头重播，无法打断（§3）。

**另外值得商榷的是方向隐喻本身**：5 个页签是**平级**的，不存在空间顺序，用横向位移暗示"有先后"是虚构的空间关系（§7）。而真正的横向方向性已经由底栏的随手拖动提供了——两套方向隐喻并存，反而不一致。

---

## 3. 改造方案

分三层。**P0 不改任何视觉，只改手感**——这是先做的。

---

### P0-1 · 弹簧内核（新增 `js/spring.js`）

全站动效的地基。约 130 行，无依赖，沿用 Apple 的 `damping` + `response` 参数制。

```js
/**
 * spring.js —— 全站弹簧动画内核
 * 参数制沿用 Apple：damping（1.0 精准不越界 / 0.8 轻微回弹）+ response（秒，越小越快）
 * 注意 response 不是 duration：弹簧没有固定时长，收敛时间由参数涌现。
 */
(function (global) {
  'use strict';

  var reduce = false;
  try {
    reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { /* 忽略 */ }

  /* Apple 参数 → 物理参数（质量归一为 1）
     ω₀ = 2π/response 为固有角频率；k = ω₀²，c = 2ζω₀ */
  function physics(damping, response) {
    var w0 = (2 * Math.PI) / response;
    return { k: w0 * w0, c: 2 * damping * w0 };
  }

  /* 动量投射：松手后物体本来会滑到哪。
     注意是 Apple 的指数衰减式，不是物理课本的 v²/(2·decel)。
     系数与单位无关：喂 px/s 得 px，喂"档/s"得"档"。 */
  function project(v, d) {
    if (d == null) d = 0.998;               // 0.998 常规滚动手感 / 0.99 更干脆
    return ((v / 1000) * d) / (1 - d);
  }

  /* 边界阻尼：越过边界越远，跟手越少 —— 连续"顶住"，而不是硬停 */
  function rubberband(overshoot, dim, constant) {
    if (constant == null) constant = 0.55;
    var abs = Math.abs(overshoot);
    return (overshoot * dim * constant) / (dim + constant * abs);
  }

  /* 速度记录：只留最近 100ms 采样并取末段平均，比"最后两点"抗抖 */
  function Tracker() { this.samples = []; }
  Tracker.prototype.push = function (pos, t) {
    this.samples.push({ p: pos, t: t });
    while (this.samples.length > 2 && t - this.samples[0].t > 100) this.samples.shift();
  };
  Tracker.prototype.velocity = function () {
    var s = this.samples;
    if (s.length < 2) return 0;
    var dt = (s[s.length - 1].t - s[0].t) / 1000;
    return dt > 0 ? (s[s.length - 1].p - s[0].p) / dt : 0;   // 单位/秒
  };
  Tracker.prototype.reset = function () { this.samples.length = 0; };

  /* 单轴弹簧控制器：随时可改目标（打断），随时可注入速度（交接） */
  function Axis(opts) {
    this.value = opts.from;
    this.target = opts.from;
    this.velocity = opts.velocity || 0;      // 初始速度 = 手指松手速度（§5）
    this.p = physics(opts.damping, opts.response);
    this.onUpdate = opts.onUpdate;
    this.onSettle = opts.onSettle;
    this.raf = 0;
    this.last = 0;
  }
  Axis.prototype.set = function (target, velocity) {
    this.target = target;
    if (velocity != null) this.velocity = velocity;
    if (velocity != null || !this.raf) this.start();
  };
  Axis.prototype.kill = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0; this.last = 0;
    return this.value;                       // 返回当前呈现值，供打断时接续（§3）
  };
  Axis.prototype.start = function () {
    if (this.raf) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.tick.bind(this));
  };
  Axis.prototype.tick = function (now) {
    var dt = this.last ? Math.min(64, now - this.last) : 16.7;
    this.last = now;

    if (reduce) {                            // 减弱动态：直接到位，状态变化仍可见
      this.value = this.target;
      this.velocity = 0;
    } else {
      // 定步长双子步积分：高刚度不发散，且与刷新率解耦（60/120Hz 手感一致）
      var steps = Math.max(1, Math.ceil(dt / 4));
      var h = (dt / 1000) / steps;
      for (var i = 0; i < steps; i++) {
        var a = -this.p.k * (this.value - this.target) - this.p.c * this.velocity;
        this.velocity += a * h;
        this.value += this.velocity * h;
      }
    }

    this.onUpdate(this.value, this.velocity);

    if (Math.abs(this.value - this.target) < 0.01 && Math.abs(this.velocity) < 1) {
      this.value = this.target; this.velocity = 0;
      this.onUpdate(this.value, 0);
      this.raf = 0; this.last = 0;
      if (this.onSettle) this.onSettle();
      return;
    }
    this.raf = requestAnimationFrame(this.tick.bind(this));
  };

  global.Spring = {
    physics: physics,
    project: project,
    rubberband: rubberband,
    Tracker: Tracker,
    Axis: Axis,
    reduced: reduce,
    /* Apple 出厂值（WWDC 2018 原表） */
    PRESET: {
      move:     { damping: 1.0, response: 0.4 },   // 位移 / 归位（不越界）
      drawer:   { damping: 0.8, response: 0.3 },   // 抽屉 / 面板
      momentum: { damping: 0.8, response: 0.4 }    // 手势带动量时的甩动
    }
  };
})(window);
```

在 `index.html` 的 `liquid-glass.js` **之前**引入：

```html
<script src="js/spring.js"></script>
<script src="js/liquid-glass.js"></script>
```

**验收**：控制台 `Spring.project(1000)` ≈ `499`（1000px/s 的甩动投射约 499px）；`Spring.rubberband(200, 300)` ≈ `86`（越界 200px 只跟手 86px）。

---

### P0-2 · 底栏玻璃块：投射 + 速度交接 + 橡皮筋

改三处，全在 `js/liquid-glass.js`。

**(a) 越界改为橡皮筋**——替换 `liquid-glass.js:101`

```js
/* 越界不再硬停：超出部分按橡皮筋衰减，连续"顶住"（§9） */
function resist(p) {
  if (p < 0) return Spring.rubberband(p, MAX);
  if (p > MAX) return MAX + Spring.rubberband(p - MAX, MAX);
  return p;
}
```

`move()` 里两处 `clampPos(...)` 改为 `resist(...)`，并把落屏值记下来供松手用：

```js
      var raw = (source === 'bar')
        ? posFromX(e.clientX)
        : (step > 0 ? baseIdx - (e.clientX - engageX) / step : baseIdx);
      pos = resist(raw);                       // pos 始终是"屏幕上真实的值"
      tracker.push(pos, e.timeStamp || performance.now());
      bar.style.setProperty('--tab-pos', pos.toFixed(4));
```

**(b) 记录速度**——`initScrub` 顶部加 `var tracker = new Spring.Tracker();`，`begin()` 里 `tracker.reset()`。

**(c) 松手：投射 → 选档 → 弹簧带速度接手**——替换 `liquid-glass.js:147-164`

```js
    function end(e, cancelled) {
      if (!source || e.pointerId !== pointerId) return;
      var wasDragging = dragging;
      source = '';
      dragging = false;
      if (!wasDragging) return;                      // 只是点按：放行原生 click

      bar.classList.remove('tab-dragging');
      var v = tracker.velocity();                    // 档/秒
      var g = geometry();

      if (cancelled) {                               // 手势被系统拿走：原地弹回，不切页
        scrubTo(Math.round(currentIdx()), pos, 0, g.step);
        return;
      }

      // ① 动量投射：用"本来会滑到哪"选目标，而不是松手点（§6）
      var landed = pos + Spring.project(v);
      var idx = Math.max(0, Math.min(MAX, Math.round(landed)));

      suppressClick = true;                          // 吞掉手势尾随的原生 click
      clearTimeout(suppressTimer);
      suppressTimer = setTimeout(function () { suppressClick = false; }, 400);
      programmatic = true;
      tabs[idx].click();                             // 切页 + 写 --tab-index
      programmatic = false;

      // ② 视觉仍由 --tab-pos 驱动，弹簧从当前呈现值出发并继承手指速度（§3 §5）
      scrubTo(idx, pos, v, g.step);
    }

    var axis = null;
    function scrubTo(idx, from, v, step) {
      if (axis) axis.kill();                         // 打断上一次，从当前值接续
      bar.classList.add('tab-springing');            // 关掉 CSS 过渡，避免与弹簧打架
      // 有动量 → 允许轻微回弹；纯点按 → 不越界（§4）
      var preset = Math.abs(v) > 0.35 ? Spring.PRESET.momentum : Spring.PRESET.move;
      axis = new Spring.Axis({
        from: from,
        damping: preset.damping,
        response: preset.response,
        velocity: v * step,                          // 档/秒 → px/秒，与弹簧位移同单位
        onUpdate: function (p) { bar.style.setProperty('--tab-pos', p.toFixed(4)); }
      });
      axis.onSettle = function () {
        bar.style.removeProperty('--tab-pos');       // 交还 --tab-index（此刻两者相等，无跳变）
        bar.classList.remove('tab-springing');
      };
      axis.set(idx);
    }
```

配套 CSS（加在 `style.css:1999` 附近）：

```css
/* 弹簧接管期间关闭 CSS 过渡：位置由 js/liquid-glass.js 逐帧写入 --tab-pos */
#tab-bar.tab-springing .tab-indicator { transition: none; }
```

同时**删掉 `.tab-indicator` 上的固定曲线**（`style.css:1990`），点按也走弹簧的 `move` 预设：

```css
.tab-indicator {
  ...
  transform: translateX(calc(var(--tab-pos, var(--tab-index, 0)) * 100%));
  /* 位置由 JS 弹簧驱动；这里只保留首次绘制前的兜底 */
  transition: none;
}
```

**这一个改动带来的差别**：从第 1 档向右快甩 → 玻璃一路冲到第 5 档；慢慢拖过 1.8 档松手 → 停在 2 档（与今天一致，无回归）；点按 → 0.3s 精准到位、不弹；拖到边缘继续拖 → 渐进顶住；松手瞬间 → 从手指速度无缝续上。

**验收**：慢拖与快甩的落点明显不同；慢动作录屏下，松手处无停顿、无速度突变。

---

### P0-3 · 抽屉：速度判定 + 真退场 + 可反悔

替换 `js/app.js:1329-1359`，并新增统一关闭入口。

```js
/**
 * 抽屉把手下拉关闭。
 * 判定用速度（§5）：一记轻快的下甩该关，慢慢拖很远也可以不关，还能中途甩回去。
 * 退场走同一条路径的弹簧（§7 §12），收敛后才真正 display:none。
 */
function bindModalDrag(modal) {
  var body = modal.querySelector('.modal-body');
  var mask = modal.querySelector('.modal-mask');
  var head = modal.querySelector('.modal-head') || modal.querySelector('.modal-handle');
  if (!body || !head) return;

  var tracker = new Spring.Tracker();
  var axis = null;
  var dragging = false, startY = 0, offset = 0, pid = -1, H = 1;

  /* 拖动中同步形变：位移 + 消解感（越拖越"化开"） + 遮罩同步变淡 */
  function render(y) {
    body.style.transform = 'translateY(' + y + 'px)';
    var t = Math.min(1, y / H);
    body.style.opacity = String(1 - t * 0.32);
    if (mask) mask.style.opacity = String(1 - t * 0.9);
  }

  head.addEventListener('pointerdown', function (e) {
    if (e.isPrimary === false || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (axis) { axis.kill(); axis = null; }         // 抓住一个正在关闭/弹回的抽屉（§3）
    dragging = true; pid = e.pointerId;
    startY = e.clientY; offset = 0;
    H = body.offsetHeight || 1;
    tracker.reset();
    tracker.push(0, performance.now());
    body.style.transition = 'none';
    try { head.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
  });

  head.addEventListener('pointermove', function (e) {
    if (!dragging || e.pointerId !== pid) return;
    offset = Math.max(0, e.clientY - startY);       // 上滑不响应：没有更大的状态
    tracker.push(offset, performance.now());
    render(offset);
  });

  function release(e) {
    if (!dragging || e.pointerId !== pid) return;
    dragging = false;
    var v = tracker.velocity();                     // px/s，向下为正

    // 速度与位置共同决定，速度优先（§5）
    var dismiss = v > 300 || (v > -300 && offset > H * 0.28);
    var target = dismiss ? H * 1.05 : 0;

    if (axis) axis.kill();
    body.style.transition = 'none';
    axis = new Spring.Axis({
      from: offset,
      damping: Spring.PRESET.drawer.damping,        // 0.8：抽屉是带惯性的，允许轻微越界
      response: Spring.PRESET.drawer.response,      // 0.3
      velocity: v,                                  // 速度交接（§5）
      onUpdate: render
    });
    axis.onSettle = function () {
      axis = null;
      if (dismiss) {
        modal.classList.add('hidden');
        body.style.transform = ''; body.style.opacity = '';
        if (mask) mask.style.opacity = '';
      }
    };
    axis.set(target);
  }

  head.addEventListener('pointerup', release);
  head.addEventListener('pointercancel', release);
}
```

**统一关闭入口**（新增，替换 13 处 `classList.add('hidden')` 调用点）：

```js
/**
 * 所有关闭点统一走这里，才有退场动画。
 * 入场用同一套弹簧的镜像 —— 进出同路径（§7），且材质"消解"而非凭空消失（§12）。
 */
function closeModal(modal) {
  if (!modal || modal.classList.contains('hidden')) return;
  var body = modal.querySelector('.modal-body');
  var mask = modal.querySelector('.modal-mask');
  if (!body) { modal.classList.add('hidden'); return; }

  var H = body.offsetHeight || 400;
  var axis = new Spring.Axis({
    from: 0,
    damping: Spring.PRESET.drawer.damping,
    response: Spring.PRESET.drawer.response,
    onUpdate: function (y) {
      body.style.transform = 'translateY(' + y + 'px)';
      var t = Math.min(1, y / H);
      body.style.opacity = String(1 - t * 0.32);
      if (mask) mask.style.opacity = String(1 - t * 0.9);
    }
  });
  axis.onSettle = function () {
    modal.classList.add('hidden');
    body.style.transform = ''; body.style.opacity = ''; body.style.transition = '';
    if (mask) mask.style.opacity = '';
  };
  axis.set(H);
}
```

调用点替换表（13 处）：

| 行 | 现在 | 改为 |
|---|---|---|
| 345 | `$('modal-enc').classList.add('hidden')` | `closeModal($('modal-enc'))` |
| 973 / 1441 / 1446 | `$('modal-catbudget')...` | `closeModal($('modal-catbudget'))` |
| 1107 / 1563 | `$('modal-category')...` | `closeModal($('modal-category'))` |
| 1272 / 1283 / 1354 / 1519 | `$('modal-record')...` | `closeModal($('modal-record'))` |
| 1454 | `$('modal-enc')...` | `closeModal($('modal-enc'))` |
| 1566 / 1586 | `$('modal-password')...` | `closeModal($('modal-password'))` |

同时**删掉 `css/style.css:1290` 的 `animation: slideUp ...`**，入场改由同一个弹簧反向驱动（在打开处调用 `axis.set(0)` from `H`），进出曲线自然镜像。

**验收**：40px 快速下甩 → 关闭；100px 缓慢下拖后停在原地 → 弹回不关；关闭进行到一半重新按住 → 抽屉跟手，不再继续下坠；关闭过程可见、有消解感，不是瞬间消失。

---

### P0-4 · 页面切换：双向 + 可打断

替换 `js/app.js:126-131` 的入场逻辑。推荐形态：**交叉淡入 + 极轻微缩放**，而非横向位移。

理由：5 个页签是平级关系，横向位移在暗示一条不存在的空间顺序（§7）；真正的横向方向性已经由底栏随手拖动提供，两套隐喻并存反而混乱。交叉淡入 + `scale(0.985→1)` 表达"换了一层"，且只用 opacity/transform，永远可打断（§3）。

```js
function switchView(view) {
  if (view === currentView) return;
  var main = $('app-main');
  if (main) viewScrollTop[currentView] = main.scrollTop;

  var outgoing = $('view-' + currentView);
  var incoming = $('view-' + view);
  var leaveStats = (currentView === 'stats' && view !== 'stats');

  currentView = view;
  incoming.classList.remove('hidden');
  incoming.style.willChange = 'opacity, transform';

  // 入场：从略小淡入（§8 朝结果稍微"长"一点，而不是单纯插值）
  if (!Spring.reduced) {
    incoming.style.opacity = '0';
    incoming.style.transform = 'scale(0.985)';
    requestAnimationFrame(function () {
      incoming.style.transition = 'opacity 180ms ease-out, transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';
      incoming.style.opacity = '1';
      incoming.style.transform = 'scale(1)';
    });
  }

  // 出场：与入场同时进行，走完再隐藏（§7 双向）
  if (outgoing && outgoing !== incoming) {
    outgoing.style.transition = 'opacity 140ms ease-in';
    outgoing.style.opacity = '0';
    setTimeout(function () {
      outgoing.classList.add('hidden');
      outgoing.style.transition = ''; outgoing.style.opacity = ''; outgoing.style.transform = '';
      incoming.style.transition = ''; incoming.style.willChange = '';
      // 图表销毁推迟到出场动画之后，否则会看到空白画布
      if (leaveStats) Charts.destroyAll();
    }, 200);
  } else if (leaveStats) {
    Charts.destroyAll();
  }
  ...
}
```

**注意**：`Charts.destroyAll()` 原本在切换开始时立即调用（`app.js:117`），现在必须推迟到出场结束，否则出场中的统计页会露出空白画布。这是本次改动唯一的时序风险点。

**验收**：连点页签中途不会闪回；切页时旧页可见地淡出而非瞬间消失。

---

### P0-5 · 滚动形变的两端加缓动

`js/liquid-glass.js:44-47`。现有实现质量已经很高（连续、帧率无关、收敛停帧），只有一处可精修：`target()` 在 `scrollTop = 36` 和 `136` 处**变化率突跳**，收缩启动/结束的瞬间会有一丝"咯"的感觉。

```js
    function target() {
      var t = (main.scrollTop - START) / RANGE;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      return t * t * (3 - 2 * t);      // smoothstep：两端变化率趋零，中段快
    }
```

**验收**：慢速滚动时，玻璃从静止到开始收缩之间没有可察觉的"启动点"。

---

### P1-1 · 材质：顶栏与底栏对称

让内容从**两侧**玻璃下方穿过，建立一致的层级叙事（§12）。新增主题变量（每个色板一套，与 `--tabbar-bg` 并列）：

```css
:root {
  --header-bg:   rgba(255, 255, 255, 0.55);
  --header-line: rgba(255, 255, 255, 0.60);
}
```

```css
#app-header {
  position: absolute;              /* 从 flex 行改为浮层 */
  top: 0; left: 0; right: 0;
  z-index: 40;
  padding: calc(14px + env(safe-area-inset-top, 0px)) 16px 12px;
  background: var(--header-bg);
  -webkit-backdrop-filter: blur(18px) saturate(180%);
  backdrop-filter: blur(18px) saturate(180%);
  /* 不用 1px 分割线：改用滚动边缘效果，内容在玻璃下淡出（§12） */
  border-bottom: none;
}

/* 滚动边缘：玻璃下沿再往下 22px 渐隐，避免卡片被硬切 */
#app-header::after {
  content: "";
  position: absolute;
  left: 0; right: 0; top: 100%;
  height: 22px;
  pointer-events: none;
  background: linear-gradient(180deg, var(--header-bg) 0%, transparent 100%);
}

#app-main {
  padding-top: calc(66px + env(safe-area-inset-top, 0px));   /* 避让浮起的顶栏 */
}
```

**验收**：滚动时卡片从顶栏玻璃下方滑过并被模糊，不是被一条直线切断。

---

### P1-2 · 无障碍：补齐三个信号

替换 `css/style.css:1429-1437` 的全局锤子。

```css
/* —— 减弱动态：换成温和的等价物，而不是硬切（§14） —— */
@media (prefers-reduced-motion: reduce) {
  /* 位移 / 缩放 / 弹簧一律改为交叉淡入：状态变化依然可见 */
  .view, .modal-body, .modal-mask, .type-btn, .cat-item, .tab-icon,
  .btn-primary, .btn-secondary, #toast, .banner {
    animation: none !important;
    transition-property: opacity, background-color, color, border-color, box-shadow !important;
    transition-duration: 150ms !important;
    transition-timing-function: ease !important;
    transform: none !important;
  }
  #tab-bar .tab-indicator { transition: none !important; }  /* 位置由 JS 弹簧直接到位 */
  .progress-track > *, .hero-spark * { transition: none !important; }
}

/* —— 减少透明度：玻璃全部转实心（§14）—— */
@media (prefers-reduced-transparency: reduce) {
  #tab-bar, #app-header {
    background: var(--surface);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    border-color: var(--card-border);
  }
  .tab-indicator::before { -webkit-backdrop-filter: none; backdrop-filter: none; }
  .modal-mask { -webkit-backdrop-filter: none; backdrop-filter: none; }
  #app-header::after { display: none; }
}

/* —— 提高对比度：加深文字与界线（§14）—— */
@media (prefers-contrast: more) {
  :root {
    --text-sub: #2A322E; --text-grey: #333B37; --text-faint: #333B37;
    --hint-text: #2A322E; --line: #B7C2BB; --card-border: #A8B5AD;
  }
  .card { box-shadow: none; border: 1px solid var(--card-border); }
  #tab-bar { background: var(--surface); border: 1.5px solid currentColor; }
}
```

配套：`liquid-glass.js` 的真折射也要尊重"减少透明度"。

```js
  /* 折射是纯装饰的透明度增强，用户明确要求减少透明度时应当关闭 */
  var reduceTransparency = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-transparency: reduce)').matches);

  var canRefract = false;
  try {
    canRefract = !reduceTransparency && chromium && window.CSS &&
      CSS.supports('backdrop-filter', 'url(#f)') &&
      CSS.supports('backdrop-filter', 'blur(1px)');
  } catch (e) { canRefract = false; }
```

**验收**：macOS/Windows 开启"减少透明度"后，底栏变实心、折射消失；开启"减弱动态"后，状态变化仍可见（淡入淡出），只是不再位移。

---

### P1-3 · 触感节拍

已有保存时的 12ms 振动（`app.js:78`）。补两处、只补两处（§13 utility：滥用会让人忽略全部反馈）：

```js
/* 底栏吸附：在弹簧启动的同一帧触发，视觉与触觉同帧（§13 harmony） */
function tapHaptic() {
  if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { /* 忽略 */ } }
}

/* 抽屉提交关闭：比吸附稍重，对应"更重的动作"（§13 causality） */
function dismissHaptic() {
  if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* 忽略 */ } }
}
```

调用点：`scrubTo()` 内弹簧启动处、`release()` 内 `dismiss === true` 时。注意必须与视觉**同一帧**，否则因果错觉断裂。

**说明**：`navigator.vibrate` 仅安卓 Chromium 与部分安卓浏览器生效，iOS Safari 不支持——静默降级即可，不要做嗅探提示。

---

### P2-1 · 记账页信息架构重做

这是本方案里唯一动"设计"而非"手感"的部分，也是**对日常使用影响最大**的一项。

**现状问题**（`index.html:76-143`）：一件核心动作被拆成两张竞争关系的卡片——

- `#quick-add-card`：支出/收入切换 → 金额 → 记一笔 → **10 个分类平铺 2×5** → 日期与备注
- `#smart-card`：智能记账输入 + 解析

用户要先决定"我用哪种方式"，才能开始输入。而 §6 说：**先展示常见路径，高级选项收进下一层。** 同时 10 个分类格是页面上视觉最重的元素，但它**极少被修改**——绝大多数人反复用那三四个分类。

**方案：合并为单入口，按频率收敛分类**

```
┌─ 本月支出 ¥2,340.00 ────────── 收入 / 结余 / 笔数 ─┐   ← 英雄卡保留
├───────────────────────────────────────────────┤
│  [ 说一句话，或直接打金额：昨天打车23块        ]  │   ← 唯一输入框
│  ⟳ 已识别：餐饮 · ¥23 · 昨天                    │   ← 解析结果就地回显
│  [餐饮 ▾]  [今天 ▾]  [备注…]            [记一笔] │   ← 一行细节，日期/备注默认收折
├───────────────────────────────────────────────┤
│  常用分类：餐饮 交通 购物 ▸ 全部                │   ← 按使用频率排序，不铺满
└───────────────────────────────────────────────┘
```

三个要点：

1. **一个输入框承担两种输入**。纯数字 → 金额；成句 → 走现有 `js/nlp.js` 解析。`nlp.js` 已经能同时处理，成本只在改渲染层。
2. **分类按使用频率排序，默认只显示 4~6 个**，末尾一个「全部」展开到全量九宫格。这是 §5 Flexibility 说的"当没有一种布局适合所有人，让人自己个性化"——但由数据自动完成，不用用户手动配置。
3. **日期默认「今天」做成一枚 chip**，点开才展开日期选择；备注同理。§6：常见路径一眼可见，其余一层之隔。

**风险**：这是交互模型的改变，会改变老用户的手感；且 `quickSave`、`renderQuickCategories`、分类选中态、`edit-*` 弹窗共用同一套分类渲染（`css/style.css:645-713`），改动面较大。建议在 P0/P1 全部验收通过、手感稳定之后再动。

**验收**：从打开应用到记完一笔（餐饮 ¥23），点击/输入步数从当前 5 步降到 3 步。

---

### P2-2 · 排版：接上用户的字号设置

`grep -c "rem" css/style.css` → **0**，全站 px。§15 要求"布局要跟着文字一起缩放"。

**分两步走，不必一次改完 3645 行：**

**第一步（低成本，覆盖主要风险）**——把字号收敛为变量，变量用 rem：

```css
:root {
  /* 类型阶梯：rem 基准 = 用户浏览器默认字号（16px），改设置即全站跟随 */
  --fs-hero:  2.125rem;   /* 34px 英雄数字 */
  --fs-title: 1.25rem;    /* 20px 卡片标题 */
  --fs-body:  0.9375rem;  /* 15px 正文 */
  --fs-sub:   0.875rem;   /* 14px 次要 */
  --fs-meta:  0.8125rem;  /* 13px 小字 */
  --fs-hint:  0.75rem;    /* 12px 说明 */
}
```

然后把 `font-size: 15px` 之类的字面量换成 `var(--fs-body)`（`--num-*` 阶梯已经在用变量了，沿用同一套写法）。

**第二步**——卡片内边距、行高等纵向间距改为 `em`，让大字号下的留白跟着增长，避免文字变大后挤在一起。

**注意**：不要把容器宽度、圆角、图标尺寸改成 rem，那些应当固定。只改**文字与跟随文字的纵向间距**。

---

## 4. 优先级与工作量

| 优先级 | 项 | 文件 | 预估 | 风险 |
|---|---|---|---|---|
| **P0-1** | 弹簧内核 `spring.js` | 新增 | 0.5d | 无（纯新增） |
| **P0-2** | 底栏投射 + 速度交接 + 橡皮筋 | `liquid-glass.js` `style.css` | 1d | 低（逻辑已在拖动手势内闭环） |
| **P0-3** | 抽屉速度判定 + 退场 + 可反悔 | `app.js` `style.css` | 1d | 中（13 处关闭点需统一收口） |
| **P0-4** | 页面切换双向 + 可打断 | `app.js` | 0.5d | 中（图表销毁时序） |
| **P0-5** | 滚动形变两端缓动 | `liquid-glass.js` | 0.1d | 无 |
| **P1-1** | 顶栏浮层 + 滚动边缘 | `style.css` × 8 色板 | 0.5d | 低 |
| **P1-2** | 三信号无障碍 | `style.css` `liquid-glass.js` | 0.5d | 低 |
| **P1-3** | 触感节拍 | `app.js` | 0.1d | 无 |
| **P2-1** | 记账页信息架构 | `app.js` `index.html` `style.css` | 2~3d | **高**（动交互模型） |
| **P2-2** | rem 化排版 | `style.css` | 1~2d | 中（面广但机械） |

**建议节奏**：P0 全部做完并真机验收后再动 P1；P2-1 单独排期、单独验收。

**P0 单独就很值**：三项改动（投射、速度交接、橡皮筋）加起来不到 100 行，却把应用最频繁的交互从"能用"变成"跟手"，且**零视觉风险**。

---

## 5. 验收标准

不只是"看起来对"，要能测。

### 手感（真机，建议用慢动作录屏逐帧看）

- [ ] 底栏：慢拖过 1.8 档松手 → 落第 2 档；同一位置快甩 → 冲到远端。**两者落点必须不同**
- [ ] 底栏：松手处无停顿、无速度突变（慢放逐帧确认）
- [ ] 底栏：拖到第 5 档继续右拖 → 玻璃渐进跟随、跟手量递减，不是纹丝不动
- [ ] 底栏：点按页签 → 0.3s 内精准到位，**不弹**
- [ ] 抽屉：40px 快速下甩 → 关闭；100px 缓慢下拖 → 弹回不关
- [ ] 抽屉：关闭进行中重新按住 → 跟手，不下坠
- [ ] 抽屉：关闭过程可见且与入场同路径，不是瞬间消失
- [ ] 切页：旧页可见淡出；连点页签不闪回
- [ ] 60Hz 与 120Hz 设备手感一致

### 无障碍

- [ ] macOS/Windows 开「减少透明度」→ 底栏与顶栏转实心、折射消失
- [ ] 开「减弱动态」→ 位移停止，但状态变化仍可感知（有淡入淡出），不是硬切
- [ ] 开「提高对比度」→ 辅助文字加深、卡片有实描边
- [ ] 键盘 Tab 可走完全部交互，焦点环可见
- [ ] 浏览器默认字号设为 20px → 布局不破、不溢出（P2-2 完成后）

### 回归（不能被手感改造弄坏）

- [ ] 8 套色板 × 明暗双模全部目视走查一遍
- [ ] 底栏拖动与页面纵向滚动不冲突；在输入框上起手不误触发拖动
- [ ] 统计页切走再切回，图表正常重建（P0-4 的时序风险点）
- [ ] 13 处弹窗关闭点全部有退场动画，且再次打开正常（无残留 inline 样式）
- [ ] 账本加密解锁流程不受影响

---

## 附：本方案不做什么

- **不重做视觉**。配色、色板、图标、卡片体系已经成立，动它们只会破坏已有的辨识度。
- **不加新功能**。§1 Purpose——每个功能都在索取用户的时间与注意力，这一轮只还债，不借款。
- **不加音效**。§13 utility：反馈只在值得处给。这个应用的"值得处"是保存成功与吸附落定，两者已有视觉反馈，再加声音是过度反馈。
- **不做全站 3D / 视差 / 大动效**。一个记账工具的情绪目标是"平静、可靠"（§8 Delight 是从前七条里长出来的，不是撒上去的彩纸），不是"炫"。
