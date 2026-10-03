/**
 * app.js —— 界面逻辑与模块集成层
 * 依赖：core.js（Store）、charts.js（Charts）、auth.js（Auth）、nlp.js（NLP）、
 *       food-db.js（FOOD_DB）、diet.js（Diet）、diet-ui.js（DietUI）
 */
(function () {
'use strict';

var $ = function (id) { return document.getElementById(id); };

var VIEW_TITLES = { record: '记账', stats: '统计', budget: '预算', diet: '饮食', manage: '管理' };
var WEEKS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

var data = null;              // Store 数据缓存
var currentYm = null;         // 当前浏览的月份 'YYYY-MM'
var currentView = 'record';
var quickType = 'expense';    // 记账页当前类型 'expense' | 'income'
var quickCat = null;          // 记账页选中的分类
var editType = 'expense';     // 编辑弹窗当前类型
var editCat = null;           // 编辑弹窗选中的分类
var editingRecordId = null;   // 正在编辑的记录 id
var editingCategoryId = null; // 正在编辑的分类 id（null = 新增）
var editingCategoryKind = 'expense'; // 分类弹窗当前组别
var pieKind = 'expense';      // 统计页饼图类型
var searchTimer = null;       // 搜索防抖
var toastTimer = null;

/** 展示用金额：两位小数 + 千分位（写入输入框请改用 Store.formatAmount） */
function f(n) { return Store.formatMoney(n); }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * 分类图标标签：内置分类用线性图标（icons.js），用户自建/改过图标的分类继续用 emoji。
 * 图标的颜色与淡底取分类自己的 color，做成内联变量供 CSS 读取。
 */
function catIconHTML(cat, cls, size) {
  var style = '';
  var name = cat && cat.color ? String(cat.color) : '';
  var m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(name);
  if (m) {
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var rgb = parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16);
    style = ' style="--cat-rgb:' + rgb + ';--cat-color:#' + h + '"';
  }
  var iconName = Store.categoryIconName(cat);
  if (iconName && window.Icons && Icons.has(iconName)) {
    return '<span class="' + cls + '"' + style + '>' + Icons.svg(iconName, size || 'ic-cat') + '</span>';
  }
  return '<span class="' + cls + '"' + style + '><span class="cat-emoji">' +
    esc(cat && cat.icon ? cat.icon : '🏷️') + '</span></span>';
}

function toast(msg) {
  var t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 1800);
}

/**
 * 保存成功反馈：打勾描线 + 一句结果 +（支持时）一次轻微振动。
 * 记账 / 记餐 / 导入这类"东西已经存下来了"的动作走这里，比一行 toast 更有落点。
 */
var successTimer = null;
function successFlash(msg) {
  var el = $('success-flash');
  if (!el) return;
  $('success-text').textContent = msg || '已保存';
  el.classList.remove('hidden', 'out');
  void el.offsetWidth;                       // 强制重排，让入场动画重新播放
  if (navigator.vibrate) {
    try { navigator.vibrate(12); } catch (e) { /* 部分浏览器需用户手势，失败忽略 */ }
  }
  clearTimeout(successTimer);
  successTimer = setTimeout(function () {
    el.classList.add('out');
    setTimeout(function () {
      el.classList.add('hidden');
      el.classList.remove('out');
    }, 260);
  }, 1150);
}
window.successFlash = successFlash;          // diet-ui.js 也要用

function downloadFile(filename, content, mime) {
  var blob = new Blob([content], { type: mime });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

/** 年月加减：shiftYm('2026-10', -1) → '2026-09' */
function shiftYm(ym, delta) {
  var parts = ym.split('-');
  var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1 + delta, 1);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}

/* ================= 视图切换 ================= */

var VIEW_ORDER = ['record', 'stats', 'budget', 'diet', 'manage'];
var viewScrollTop = {};        // 每个页签记住自己的滚动位置，切回时恢复

function switchView(view) {
  if (currentView === 'stats' && view !== 'stats') Charts.destroyAll();

  var main = $('app-main');
  if (main) viewScrollTop[currentView] = main.scrollTop;   // 记住离开时的位置

  var prevIdx = VIEW_ORDER.indexOf(currentView);
  var nextIdx = VIEW_ORDER.indexOf(view);
  currentView = view;

  var views = document.querySelectorAll('.view');
  for (var i = 0; i < views.length; i++) views[i].classList.add('hidden');
  var incoming = $('view-' + view);
  incoming.classList.remove('hidden');
  // 方向感过渡：沿页签顺序前进 / 后退（先清类再强制重排，保证动画重新触发）
  incoming.classList.remove('view-fwd', 'view-back');
  if (nextIdx !== prevIdx) {
    void incoming.offsetWidth;
    incoming.classList.add(nextIdx > prevIdx ? 'view-fwd' : 'view-back');
  }

  var tabs = document.querySelectorAll('#tab-bar .tab');
  for (var j = 0; j < tabs.length; j++) {
    tabs[j].classList.toggle('active', tabs[j].getAttribute('data-view') === view);
  }
  // 滑动胶囊指示器跟随激活页签
  var bar = $('tab-bar');
  if (bar && nextIdx >= 0) bar.style.setProperty('--tab-index', String(nextIdx));

  $('page-title').textContent = VIEW_TITLES[view];
  $('month-nav').classList.toggle('hidden', view === 'manage' || view === 'diet');

  if (view === 'record') { renderQuickCategories(); renderRecordList(); }
  else if (view === 'stats') renderStats();
  else if (view === 'budget') renderBudget();
  else if (view === 'diet') DietUI.render();
  else if (view === 'manage') { renderThemeToggle(); renderAccentToggle(); renderEncRow(); renderCategoryManage(); renderBackupHint(); }

  if (main) main.scrollTop = viewScrollTop[view] || 0;     // 恢复该页上次滚动位置
}

/* ================= 月份导航 ================= */

function shiftMonth(delta) {
  var ym = shiftYm(currentYm, delta);
  if (ym > Store.currentYm()) return; // 不允许翻到未来
  currentYm = ym;
  updateMonthLabel();
  flashNumbers();
  if (currentView === 'record') renderRecordList();
  else if (currentView === 'stats') renderStats();
  else if (currentView === 'budget') renderBudget();
}

function updateMonthLabel() {
  var parts = currentYm.split('-');
  $('month-label').textContent = parseInt(parts[0], 10) + '年' + parseInt(parts[1], 10) + '月';
}

/** 月份切换时让数字"换一口气"：轻淡入一次，比整页重绘更有连续性 */
function flashNumbers() {
  var ids = ['hero-card', 'stat-summary', 'record-sum'];
  for (var i = 0; i < ids.length; i++) {
    var el = $(ids[i]);
    if (!el) continue;
    el.classList.remove('num-in');
    void el.offsetWidth;                     // 重排以重启动画
    el.classList.add('num-in');
  }
}

/* ================= 主题（明暗 data-mode × 风格 data-accent 双维度） ================= */

var ACCENTS = ['mint', 'ocean', 'sunset', 'dusk', 'ink', 'celadon', 'graphite', 'sakura'];
var ACCENT_NAMES = {
  mint: '薄荷绿', ocean: '深海蓝', sunset: '落日橙', dusk: '暮山紫', ink: '墨玉黑金',
  celadon: '青瓷', graphite: '石墨', sakura: '樱花'
};
var ACCENT_DESC = {
  mint: '清透薄荷 · 轻盈日常', ocean: '深海静蓝 · 专注理性', sunset: '落日暖橙 · 热烈有温度',
  dusk: '暮山雾紫 · 浪漫温柔', ink: '玄黑鎏金 · 沉稳贵气', celadon: '釉色青瓷 · 温润清雅',
  graphite: '极简石墨 · 冷静克制', sakura: '樱花柔粉 · 轻盈治愈'
};

var PREF = { mode: 'auto', accent: 'mint' };   // 用户偏好：mode = auto | light | dark
var mqDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function themeKey() { return 'jz_theme::' + (Store.storageUser() || ''); }

/** 读取偏好：兼容旧版纯字符串（'auto'/'light'/'dark'）与新版 JSON {mode, accent} */
function loadThemePref() {
  try {
    var raw = localStorage.getItem(themeKey());
    if (!raw) return { mode: 'auto', accent: 'mint' };
    if (raw === 'auto' || raw === 'light' || raw === 'dark') return { mode: raw, accent: 'mint' };
    var o = JSON.parse(raw);
    return {
      mode: (o && ['auto', 'light', 'dark'].indexOf(o.mode) >= 0) ? o.mode : 'auto',
      accent: (o && ACCENTS.indexOf(o.accent) >= 0) ? o.accent : 'mint'
    };
  } catch (e) { return { mode: 'auto', accent: 'mint' }; }
}

function saveThemePref() {
  try { localStorage.setItem(themeKey(), JSON.stringify(PREF)); } catch (e) { /* 忽略 */ }
}

/** auto → 按系统深色解析成实际 mode */
function resolveMode() {
  return PREF.mode === 'auto' ? (mqDark && mqDark.matches ? 'dark' : 'light') : PREF.mode;
}

/** 把解析结果应用到 body：data-theme 留给按钮态，data-mode / data-accent 驱动 CSS */
function applyResolvedTheme(silent) {
  document.body.setAttribute('data-theme', PREF.mode);
  document.body.setAttribute('data-mode', resolveMode());
  document.body.setAttribute('data-accent', PREF.accent);
  syncMetaColor();
  renderThemeToggle();
  renderAccentToggle();
  if (!silent) refreshThemeView();
}

/** 设置明暗偏好（'auto' | 'light' | 'dark'） */
function applyTheme(mode, silent) {
  PREF.mode = ['auto', 'light', 'dark'].indexOf(mode) >= 0 ? mode : 'auto';
  saveThemePref();
  applyResolvedTheme(silent);
}

/** 设置风格色板（ACCENTS 之一），与明暗维度自由组合 */
function applyAccent(accent, silent) {
  PREF.accent = ACCENTS.indexOf(accent) >= 0 ? accent : 'mint';
  saveThemePref();
  applyResolvedTheme(silent);
}

/** 状态栏 / 浏览器 UI 颜色跟随当前主题主色 */
function syncMetaColor() {
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  var c = '';
  try { c = getComputedStyle(document.body).getPropertyValue('--primary').trim(); } catch (e) { /* 忽略 */ }
  if (c) meta.setAttribute('content', c);
}

function renderThemeToggle() {
  var btns = document.querySelectorAll('#theme-toggle .type-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].getAttribute('data-theme') === PREF.mode);
  }
}

/** 生成风格色板预览卡（迷你手机屏样式，预览色见 style.css 第 38 节的 --pv-* 表）
 *  只生成一次；预览的明暗版本由 CSS 按 body[data-mode] 自动切换 */
function buildAccentGrid() {
  var box = $('accent-toggle');
  if (!box || box.children.length) return;
  var html = '';
  for (var i = 0; i < ACCENTS.length; i++) {
    var a = ACCENTS[i], n = ACCENT_NAMES[a];
    html += '<button type="button" class="accent-card" data-accent="' + a + '"' +
            ' aria-label="' + n + '" title="' + n + '">' +
              '<span class="accent-preview" aria-hidden="true">' +
                '<span class="pv-card"></span><span class="pv-dot"></span>' +
                '<span class="pv-line"></span><span class="pv-pill"></span>' +
              '</span>' +
              '<span class="accent-name">' + n + '</span>' +
            '</button>';
  }
  box.innerHTML = html;
}

function renderAccentToggle() {
  buildAccentGrid();
  var btns = document.querySelectorAll('#accent-toggle .accent-card');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].getAttribute('data-accent') === PREF.accent);
  }
  var name = $('accent-name');
  if (name) name.textContent = ACCENT_NAMES[PREF.accent] || ACCENT_NAMES.mint;
  var desc = $('accent-desc');
  if (desc) desc.textContent = ACCENT_DESC[PREF.accent] || '';
}

/* ================= 账本加密（管理页账户卡片 + 设置弹窗） ================= */

/** 刷新账户卡片里的加密状态行 */
function renderEncRow() {
  var stateEl = $('enc-state');
  var btn = $('enc-toggle-btn');
  if (!stateEl || !btn) return;
  var on = Auth.isEncEnabled();
  stateEl.textContent = on ? '已开启 · 打开需解锁' : '未开启 · 明文存本机';
  stateEl.classList.toggle('on', on);
  btn.textContent = on ? '关闭' : '开启';
}

/** 打开加密设置弹窗（按当前状态决定是「开启」还是「关闭」） */
function openEncModal() {
  var on = Auth.isEncEnabled();
  $('enc-modal-title').textContent = on ? '关闭账本加密' : '开启账本加密';
  $('enc-modal-desc').textContent = on
    ? '关闭后数据恢复为本机明文存储，打开应用不再需要解锁。请输入当前密码确认。'
    : '开启后每次打开小账本都需输入密码解锁；忘记密码将无法恢复数据，建议先在管理页导出备份。';
  $('enc-modal-warn').textContent = on ? '' : '请确认你已记住当前密码，并已做好备份。';
  $('enc-confirm-btn').textContent = on ? '关闭加密' : '开启加密';
  $('enc-pw-input').value = '';
  $('modal-enc').classList.remove('hidden');
  $('enc-pw-input').focus();
}

/** 弹窗确认：开启 / 关闭账本加密（成功后把整份数据按新形态回写） */
function encConfirm() {
  var pw = $('enc-pw-input').value;
  if (!pw) { toast('请输入当前密码'); return; }
  var btn = $('enc-confirm-btn');
  if (btn.disabled) return;
  btn.disabled = true;
  var wasOn = Auth.isEncEnabled();
  var action = wasOn ? Auth.disableEncryption(pw) : Auth.enableEncryption(pw);
  action
    .then(function () { return Store.flush(); })     // 先让先前的写入落定
    .then(function () {
      Store.repersist();                             // 以新的存储形态（密文/明文）回写整份数据
      return Store.flush();
    })
    .then(function () {
      btn.disabled = false;
      $('modal-enc').classList.add('hidden');
      renderEncRow();
      toast(wasOn ? '已关闭加密，数据恢复明文 ✓' : '已开启加密 ✓ 下次打开需解锁');
    })
    .catch(function (e) {
      btn.disabled = false;
      renderEncRow();
      toast(e.message || '操作失败，请重试');
    });
}

/** 主题变化后刷新当前页里吃主题色的渲染（图表等） */
function refreshThemeView() {
  if (currentView === 'stats') renderStats();
  else if (currentView === 'diet') DietUI.render();
}

// 「跟随系统」时，系统深浅切换实时生效
if (mqDark && mqDark.addEventListener) {
  mqDark.addEventListener('change', function () {
    if (PREF.mode === 'auto') applyResolvedTheme(false);
  });
}

/* ================= 记账页 ================= */

function setQuickType(type) {
  quickType = type === 'income' ? 'income' : 'expense';
  var btns = document.querySelectorAll('#quick-type-toggle .type-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].getAttribute('data-type') === quickType);
  }
  var cats = Store.getCategories(quickType);
  quickCat = cats.length ? cats[0].id : null;
  renderQuickCategories();
}

function renderCategoryGrid(container, kind, selectedId) {
  var cats = Store.getCategories(kind);
  var html = '';
  for (var i = 0; i < cats.length; i++) {
    var c = cats[i];
    html += '<button type="button" class="cat-item' + (c.id === selectedId ? ' selected' : '') +
      '" data-id="' + esc(c.id) + '">' + catIconHTML(c, 'cat-icon') +
      '<span class="cat-name">' + esc(c.name) + '</span></button>';
  }
  container.innerHTML = html;
}

function renderQuickCategories() {
  renderCategoryGrid($('quick-categories'), quickType, quickCat);
}

function quickSave() {
  var cats = Store.getCategories(quickType);
  if (!cats.length) { toast('请先到「管理」页添加分类'); return; }
  var amount = parseFloat($('quick-amount').value);
  if (!isFinite(amount) || amount <= 0) { toast('请输入正确的金额'); return; }
  var date = $('quick-date').value || Store.todayStr();
  var note = $('quick-note').value;
  try {
    Store.addRecord({ type: quickType, amount: amount, categoryId: quickCat || cats[0].id, date: date, note: note });
  } catch (e) { toast(e.message); return; }
  $('quick-amount').value = '';
  $('quick-note').value = '';
  successFlash(quickType === 'income' ? '收入已记录' : '已记一笔');
  renderRecordList();
  refreshBanner();
  checkReminders();
}

/* ---------- 智能记账 ---------- */

function smartParse() {
  var text = $('smart-input').value;
  var res = NLP.parse(text, Store.getCategories());
  if (!res.ok) { toast('没认出金额，试试「打车23块」'); return; }

  // 语义指向收入/支出时自动切换类型
  if (res.suggestedType === 'income' && quickType !== 'income') setQuickType('income');
  else if (res.suggestedType === 'expense' && quickType !== 'expense') setQuickType('expense');

  // 分类：解析结果属于当前类型时才采用
  if (res.categoryId) {
    var cats = Store.getCategories(quickType);
    var found = false;
    for (var i = 0; i < cats.length; i++) if (cats[i].id === res.categoryId) { found = true; break; }
    if (found) { quickCat = res.categoryId; renderQuickCategories(); }
  }
  if (res.date) $('quick-date').value = res.date;
  $('quick-amount').value = String(res.amount);
  if (res.note) $('quick-note').value = res.note;
  $('smart-input').value = '';
  toast('已识别 ¥' + f(res.amount) + '，确认后点「记一笔」');
}

/* ---------- 英雄卡：本月支出一眼可见 ---------- *//* 结构：大数字（含环比）+ 收入/结余/笔数 + 近 7 天迷你柱 + 预算进度
   数据全部来自 Store，不缓存；内容没变时跳过重绘，避免搜索输入时数字反复滚动 */

var heroKey = '';      // 上次渲染的数据指纹
var heroShown = null;  // 上次显示的大数字（用于滚动动画的起点）

/** 本地日期 → 'YYYY-MM-DD' */
function dayStr(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

/** 金额滚动：from → to（减弱动态效果时直接落定） */
function tweenMoney(el, from, to) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = f(to);
    return;
  }
  var t0 = null;
  var DUR = 460;
  function frame(ts) {
    if (t0 === null) t0 = ts;
    var p = Math.min((ts - t0) / DUR, 1);
    var eased = 1 - Math.pow(1 - p, 3);            // easeOutCubic
    el.textContent = f(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function renderHero() {
  var card = $('hero-card');
  if (!card) return;

  var s = Store.getMonthSummary(currentYm);
  var y = parseInt(currentYm.slice(0, 4), 10);
  var m = parseInt(currentYm.slice(5, 7), 10);

  // 近 7 天窗口：看当月 = 今天往前 7 天；看往月 = 该月月末往前 7 天
  var end = currentYm === Store.currentYm()
    ? new Date()
    : new Date(y, m, 0);                            // new Date(y, m, 0) = 该月最后一天
  var todayStr = Store.todayStr();
  var days = [];
  for (var i = 6; i >= 0; i--) {
    days.push(dayStr(new Date(end.getFullYear(), end.getMonth(), end.getDate() - i)));
  }

  // 这 7 天各自的支出（窗口可能跨月，所以从全量记录里筛，而不是只取当月）
  var daily = {};
  for (var k = 0; k < days.length; k++) daily[days[k]] = 0;
  var all = Store.getRecords();
  for (var j = 0; j < all.length; j++) {
    var rec = all[j];
    if (rec.type === 'expense' && daily[rec.date] !== undefined) daily[rec.date] += rec.amount;
  }

  var budget = Store.getBudget();
  var key = [currentYm, s.expense, s.income, s.balance, s.count, budget,
    days.map(function (d) { return daily[d]; }).join('/')].join('|');
  if (key === heroKey) return;                      // 内容没变，不重绘
  heroKey = key;

  $('hero-label').textContent = m + '月支出';

  // 大数字：首次直接显示，之后的变化滚动过去（数字"长上去"的反馈）
  var expEl = $('hero-expense');
  if (heroShown !== null && heroShown !== s.expense) tweenMoney(expEl, heroShown, s.expense);
  else expEl.textContent = f(s.expense);
  heroShown = s.expense;

  // 环比上月：花得更多用警示红、更少用固定绿（与品牌色解耦）
  var prev = Store.getMonthSummary(shiftYm(currentYm, -1));
  var deltaEl = $('hero-delta');
  if (prev.expense > 0 && s.expense > 0) {
    var diff = s.expense - prev.expense;
    var pct = Math.round(Math.abs(diff) / prev.expense * 100);
    deltaEl.className = 'hero-delta' + (diff > 0 ? ' up' : (diff < 0 ? ' down' : ''));
    deltaEl.innerHTML = (diff === 0 ? '' : Icons.svg(diff > 0 ? 'up-right' : 'down-right', 'ic-xs')) +
      '<span>' + (diff === 0 ? '与上月持平' : '比上月' + (diff > 0 ? '多花 ' : '少花 ') + pct + '%') + '</span>';
  } else {
    deltaEl.className = 'hero-delta hidden';
  }

  // 右侧三行：收入 / 结余 / 笔数
  $('hero-income').textContent = '¥' + f(s.income);
  var balEl = $('hero-balance');
  balEl.textContent = (s.balance < 0 ? '-' : '') + '¥' + f(Math.abs(s.balance));
  balEl.className = 'hero-side-value' + (s.balance < 0 ? ' negative' : (s.balance > 0 ? ' positive' : ''));
  $('hero-count').textContent = String(s.count);

  // 近 7 天迷你柱：最高的一天撑满，零值留一个底点
  var max = 0;
  for (k = 0; k < days.length; k++) max = Math.max(max, daily[days[k]]);
  var spark = '';
  for (k = 0; k < days.length; k++) {
    var v = daily[days[k]];
    var h = max > 0 ? Math.max(Math.round(v / max * 100), 6) : 6;
    var wd = WEEKS[new Date(days[k].slice(0, 4), days[k].slice(5, 7) - 1, days[k].slice(8, 10)).getDay()].slice(1);
    spark += '<div class="spark-col' + (days[k] === todayStr ? ' today' : '') + '" title="' +
      days[k] + ' ¥' + f(v) + '">' +
      '<div class="spark-bar-wrap"><div class="spark-bar" style="height:' + h + '%"></div></div>' +
      '<span class="spark-day">' + wd + '</span></div>';
  }
  $('hero-spark').innerHTML = spark;

  // 预算进度：没设预算时整块隐藏
  var bEl = $('hero-budget');
  if (budget == null) {
    bEl.className = 'hero-budget hidden';
  } else {
    var st = Store.getBudgetStatus(currentYm);
    bEl.className = 'hero-budget';
    bEl.innerHTML = '<div class="hero-budget-head">' +
      '<span>预算 ¥' + f(st.budget) + ' · 已用 ' + st.usedPct + '%</span>' +
      '<span>' + (st.level === 'over'
        ? '<span class="over-text">已超支 ¥' + f(Math.abs(st.remaining)) + '</span>'
        : '剩余 <b>¥' + f(st.remaining) + '</b>') + '</span></div>' +
      '<div class="progress-track"><div class="hero-fill' +
      (st.level === 'warn' ? ' progress-warn' : (st.level === 'over' ? ' progress-over' : '')) +
      '" style="width:' + Math.min(st.usedPct, 100) + '%"></div></div>';
  }
}

/* ---------- 流水列表（含搜索） ---------- */

function renderRecordList() {
  renderHero();                                   // 英雄卡与明细同源，一起刷新
  var list = $('record-list');
  var q = $('search-input').value.trim();
  var scope = $('search-scope').value;
  var searchMode = q !== '';
  var records = searchMode
    ? Store.searchRecords({ q: q, scope: scope, ym: currentYm })
    : Store.getMonthRecords(currentYm);

  var cats = {};
  var allCats = Store.getCategories();
  for (var k = 0; k < allCats.length; k++) cats[allCats[k].id] = allCats[k];

  $('record-empty').classList.toggle('hidden', searchMode || records.length > 0);
  $('search-empty').classList.toggle('hidden', !searchMode || records.length > 0);

  // 明细章节头的汇总：当前筛选结果的支出 / 收入合计（无记录时留空）
  var sumExp = 0, sumInc = 0;
  for (var s = 0; s < records.length; s++) {
    if (records[s].type === 'income') sumInc += records[s].amount;
    else sumExp += records[s].amount;
  }
  var sumEl = $('record-sum');
  if (sumEl) {
    sumEl.textContent = records.length
      ? '支出 ¥' + f(sumExp) + ' · 收入 ¥' + f(sumInc) : '';
  }

  if (!records.length) { list.innerHTML = ''; return; }

  // 逐日聚合
  var byDate = {};
  for (var m = 0; m < records.length; m++) {
    var d = records[m].date;
    if (!byDate[d]) byDate[d] = { expense: 0, income: 0 };
    if (records[m].type === 'income') byDate[d].income += records[m].amount;
    else byDate[d].expense += records[m].amount;
  }

  var html = '';
  var dayKey = '';
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    var cat = cats[r.categoryId] || null;
    // 分类被删掉时（导入数据可能指向不存在的分类）用兜底图标，不显示破图
    var iconHTML = cat ? catIconHTML(cat, 'record-icon')
      : '<span class="record-icon" style="--cat-rgb:144,164,174;--cat-color:#90A4AE">' +
        Icons.svg('fallback', 'ic-cat') + '</span>';
    if (r.date !== dayKey) {
      if (dayKey) html += '</div></div>';
      dayKey = r.date;
      var p = r.date.split('-');
      // 搜索跨月时标题带年份
      var title = (searchMode && scope !== 'month' ? p[0] + '年' : '') +
        parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日 ' +
        WEEKS[new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)).getDay()];
      html += '<div class="day-group" data-date="' + esc(r.date) + '"><div class="day-head"><span class="day-title">' +
        title + '</span><span class="day-total"></span></div><div class="day-body">';
    }
    var isIncome = r.type === 'income';
    html += '<div class="record-item" data-id="' + esc(r.id) + '">' +
      iconHTML +
      '<div class="record-info"><span class="record-cat">' + esc(cat ? cat.name : '未知分类') +
      (r.items && r.items.length ? '<span class="items-badge">' + Icons.svg('receipt', 'ic-xs') +
        r.items.length + '件</span>' : '') +
      '</span>' +
      (r.note ? '<span class="record-note">' + esc(r.note) + '</span>' : '') +
      '</div><span class="' + (isIncome ? 'record-amount income' : 'record-amount') + '">' +
      (isIncome ? '+' + f(r.amount) : '-' + f(r.amount)) + '</span></div>';
  }
  html += '</div></div>';

  // 回填每日小计（净额：收入-支出）
  var wrap = document.createElement('div');
  wrap.innerHTML = html;
  var groups = wrap.querySelectorAll('.day-group');
  for (var n = 0; n < groups.length; n++) {
    var agg = byDate[groups[n].getAttribute('data-date')] || { expense: 0, income: 0 };
    var net = agg.income - agg.expense;
    var el = groups[n].querySelector('.day-total');
    if (net > 0) { el.textContent = '+' + f(net); el.classList.add('positive'); }
    else if (net < 0) { el.textContent = '-' + f(Math.abs(net)); }
    else { el.textContent = '¥0.00'; }
  }
  list.innerHTML = '';
  while (wrap.firstChild) list.appendChild(wrap.firstChild);
}

/* ================= 统计页 ================= */

/** 汇总数字滚动动画：从 0 计数到目标值（"减弱动态效果"开启时跳过） */
function animateCountUps(container) {
  var els = container.querySelectorAll('[data-cu]');
  for (var i = 0; i < els.length; i++) {
    (function (el) {
      var target = parseFloat(el.getAttribute('data-cu'));
      if (!isFinite(target)) return;
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      var isInt = el.getAttribute('data-int') === '1';
      var prefix = el.getAttribute('data-prefix') || '';
      var neg = target < 0;
      var abs = Math.abs(target);
      var t0 = null, DUR = 480;
      function fmt(v) {
        if (isInt) return String(Math.round(v));
        return (neg ? '-' : '') + prefix + f(v);
      }
      function frame(ts) {
        if (t0 === null) t0 = ts;
        var p = Math.min((ts - t0) / DUR, 1);
        var eased = 1 - Math.pow(1 - p, 3);              // easeOutCubic
        el.textContent = fmt(abs * eased);
        if (p < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    })(els[i]);
  }
}

/**
 * 分类占比图例：图标 + 名称 + 占比 + 占比条 + 金额
 * （替代 Chart.js 内置图例：内置图例既没有分类色，也放不下金额与占比）
 * @param {Array<{id:string,name:string,icon:string,color:string,total:number}>} items
 * @param {number} total 合计金额（算占比用）
 */
function renderPieLegend(items, total) {
  var el = $('pie-legend');
  if (!el) return;
  if (!items.length) { el.innerHTML = ''; return; }
  var html = '';
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var pct = total > 0 ? (it.total / total) * 100 : 0;
    var pctText = pct > 0 && pct < 1 ? '&lt;1' : String(Math.round(pct));
    html += '<div class="pl-row">' +
      '<div class="pl-head">' +
        catIconHTML(it, 'pl-icon', 'ic-sm') +
        '<span class="pl-name">' + esc(it.name) + '</span>' +
        '<span class="pl-pct">' + pctText + '%</span>' +
        '<span class="pl-amount">¥' + f(it.total) + '</span>' +
      '</div>' +
      '<span class="pl-track"><span class="pl-bar" style="width:' +
        Math.max(pct, 1.5) + '%;background:' + esc(it.color) + '"></span></span>' +
      '</div>';
  }
  el.innerHTML = html;
}

function renderStats() {
  try { Insights.render(currentYm); }   // 顶部智能洞察卡（失败不影响报表主体）
  catch (e) { console.warn('[app.js] 洞察卡渲染失败：', e); }
  var s = Store.getMonthSummary(currentYm);

  $('stat-summary').innerHTML =
    '<div class="summary-item"><span class="summary-label">收入</span><span class="summary-value" data-cu="' + s.income + '" data-prefix="¥">¥' + f(s.income) + '</span></div>' +
    '<div class="summary-item"><span class="summary-label">支出</span><span class="summary-value" data-cu="' + s.expense + '" data-prefix="¥">¥' + f(s.expense) + '</span></div>' +
    '<div class="summary-item"><span class="summary-label">结余</span><span class="summary-value' + (s.balance < 0 ? ' negative' : '') + '" data-cu="' + s.balance + '" data-prefix="¥">' +
    (s.balance < 0 ? '-' : '') + '¥' + f(Math.abs(s.balance)) + '</span></div>' +
    '<div class="summary-item"><span class="summary-label">笔数</span><span class="summary-value" data-cu="' + s.count + '" data-int="1">' + s.count + '</span></div>';
  animateCountUps($('stat-summary'));

  // 分类占比（支出/收入切换）：环形图 + 下方的图例列表
  var src = pieKind === 'income' ? s.incomeByCategory : s.byCategory;
  var pieItems = [];
  var pieTotal = 0;
  for (var i = 0; i < src.length; i++) {
    pieItems.push({ name: src[i].name, value: src[i].total, color: src[i].color });
    pieTotal += src[i].total;
  }
  $('pie-empty').textContent = pieKind === 'income' ? '本月暂无收入数据' : '本月暂无支出数据';
  $('pie-empty').classList.toggle('hidden', pieItems.length > 0);
  Charts.renderCategoryPie($('pie-chart'), pieItems, {
    title: pieKind === 'income' ? '本月收入' : '本月支出',
    count: pieItems.length ? pieItems.length + ' 笔' : ''
  });
  renderPieLegend(src, pieTotal);

  // 每日趋势（支出/收入双系列）
  var days = [];
  for (var j = 0; j < s.daily.length; j++) {
    days.push({ label: s.daily[j].date.slice(5), expense: s.daily[j].expense, income: s.daily[j].income });
  }
  $('trend-empty').textContent = '本月暂无数据';
  $('trend-empty').classList.toggle('hidden', days.length > 0);
  Charts.renderDailyTrend($('trend-chart'), days);

  // 近 30 天走势折线
  var lineRows = buildLast30Days();
  var hasLineData = false;
  for (var li = 0; li < lineRows.length; li++) {
    if (lineRows[li].expense > 0 || lineRows[li].income > 0) { hasLineData = true; break; }
  }
  $('line-empty').classList.toggle('hidden', hasLineData);
  Charts.renderLineTrend($('line-chart'), lineRows);

  // 近 6 个月
  var trend = Store.getMonthlyTrend(6);
  var months = [];
  var hasMonthData = false;
  for (var t = 0; t < trend.length; t++) {
    if (trend[t].expense > 0 || trend[t].income > 0) hasMonthData = true;
    months.push({ ym: trend[t].ym, label: parseInt(trend[t].ym.slice(5), 10) + '月', expense: trend[t].expense, income: trend[t].income });
  }
  $('month-empty').classList.toggle('hidden', hasMonthData);
  Charts.renderMonthlyTrend($('month-chart'), months);

  // 本月 vs 上月
  renderCompare(s);
}

/** 最近 30 天（含今天）每日收支，无记录的日期补 0 */
function buildLast30Days() {
  var byDay = {};
  var records = Store.getRecords();
  var start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 29);
  var startStr = start.getFullYear() + '-' + ('0' + (start.getMonth() + 1)).slice(-2) + '-' + ('0' + start.getDate()).slice(-2);
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (r.date < startStr) continue;
    if (!byDay[r.date]) byDay[r.date] = { expense: 0, income: 0 };
    if (r.type === 'income') byDay[r.date].income += r.amount;
    else byDay[r.date].expense += r.amount;
  }
  var rows = [];
  for (var d = 0; d < 30; d++) {
    var day = new Date(start);
    day.setDate(start.getDate() + d);
    var key = day.getFullYear() + '-' + ('0' + (day.getMonth() + 1)).slice(-2) + '-' + ('0' + day.getDate()).slice(-2);
    var agg = byDay[key] || { expense: 0, income: 0 };
    rows.push({ label: key.slice(5), expense: agg.expense, income: agg.income });
  }
  return rows;
}

function renderCompare(s) {
  var last = Store.getMonthSummary(shiftYm(currentYm, -1));
  var lastMap = {};
  for (var i = 0; i < last.byCategory.length; i++) lastMap[last.byCategory[i].id] = last.byCategory[i].total;

  var rows = s.byCategory.slice(0, 6);
  var listEl = $('compare-list');
  if (!rows.length) {
    listEl.innerHTML = '';
    $('compare-empty').classList.remove('hidden');
    return;
  }
  $('compare-empty').classList.add('hidden');

  var max = 1;
  for (var j = 0; j < rows.length; j++) if (rows[j].total > max) max = rows[j].total;

  var html = '';
  for (var k = 0; k < rows.length; k++) {
    var c = rows[k];
    var lastTotal = lastMap[c.id] || 0;
    var pct = lastTotal > 0 ? Math.round((c.total - lastTotal) / lastTotal * 100) : null;
    var pctHtml;
    if (pct === null) pctHtml = '<span class="cmp-pct">新增</span>';
    else if (pct > 0) pctHtml = '<span class="cmp-pct up">↑' + pct + '%</span>';
    else if (pct < 0) pctHtml = '<span class="cmp-pct down">↓' + Math.abs(pct) + '%</span>';
    else pctHtml = '<span class="cmp-pct">持平</span>';
    html += '<div class="compare-row">' + catIconHTML(c, 'cmp-icon', 'ic-sm') +
      '<span class="cmp-name">' + esc(c.name) +
      '</span><div class="cmp-track"><div class="cmp-bar" style="width:' +
      Math.round(c.total / max * 100) + '%;background:' + esc(c.color) + '"></div></div>' +
      '<span class="cmp-amount">¥' + f(c.total) + '</span>' + pctHtml + '</div>';
  }
  listEl.innerHTML = html;
}

/* ================= 预算页 ================= */

function renderBudget() {
  var budget = Store.getBudget();
  $('budget-input').value = budget == null ? '' : budget;

  var status = Store.getBudgetStatus(currentYm);
  var box = $('budget-progress-box');
  if (status.budget == null) { box.classList.add('hidden'); }
  else {
    box.classList.remove('hidden');
    var bar = $('budget-progress-bar');
    bar.style.width = Math.min(status.usedPct, 100) + '%';
    bar.classList.toggle('progress-warn', status.level === 'warn');
    bar.classList.toggle('progress-over', status.level === 'over');
    var stats = $('budget-stats');
    if (status.level === 'over') {
      stats.innerHTML = '已用 <b>¥' + f(status.spent) + '</b> / ¥' + f(status.budget) +
        ' · <span class="over-text">已超支 ¥' + f(Math.abs(status.remaining)) + '</span>';
    } else {
      stats.innerHTML = '已用 <b>¥' + f(status.spent) + '</b> / ¥' + f(status.budget) +
        ' · 剩余 ¥' + f(status.remaining) + '（已用 ' + status.usedPct + '%）' +
        (status.level === 'warn' ? ' · 快到预算上限了' : '');
    }
  }

  var s = Store.getMonthSummary(currentYm);
  var listEl = $('budget-category-list');
  if (!s.byCategory.length) {
    listEl.innerHTML = '';
    $('budget-cat-empty').classList.remove('hidden');
  } else {
    $('budget-cat-empty').classList.add('hidden');
    var max = s.byCategory[0].total || 1;
    var html = '';
    for (var i = 0; i < s.byCategory.length; i++) {
      var c = s.byCategory[i];
      html += '<div class="bcat-row">' + catIconHTML(c, 'bcat-icon', 'ic-sm') +
        '<span class="bcat-name">' + esc(c.name) +
        '</span><div class="bcat-bar-track"><div class="bcat-bar" style="width:' +
        Math.round(c.total / max * 100) + '%;background:' + esc(c.color) + '"></div></div>' +
        '<span class="bcat-amount">¥' + f(c.total) + '</span></div>';
    }
    listEl.innerHTML = html;
  }

  renderCategoryBudgets();
}

/* ---------- 分类预算（预算页「分类预算」卡 + 设置弹窗） ---------- */

var editingCatBudgetId = null;   // 弹窗里当前选中的分类 id

/** 渲染分类预算列表：图标 + 名称 + 已用/上限 + 进度条 + 剩余/超支说明 */
function renderCategoryBudgets() {
  var items = Store.getCategoryBudgetStatus(currentYm);
  $('catbudget-empty').classList.toggle('hidden', items.length > 0);
  var html = '';
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var levelCls = it.level === 'warn' ? ' warn' : (it.level === 'over' ? ' over' : '');
    var note = it.level === 'over'
      ? '<span class="over-text">已超支 ¥' + f(it.spent - it.budget) + '</span>'
      : '剩余 ¥' + f(it.remaining) + '（已用 ' + it.usedPct + '%）' +
        (it.level === 'warn' ? ' · 快到上限了' : '');
    html += '<div class="cbud-row" data-id="' + esc(it.categoryId) + '">' +
      catIconHTML({ id: it.categoryId, name: it.name, icon: it.icon, color: it.color }, 'cbud-icon') +
      '<div class="cbud-main">' +
        '<div class="cbud-head"><span class="cbud-name">' + esc(it.name) + '</span>' +
        '<span class="cbud-amount">¥' + f(it.spent) + ' / ¥' + f(it.budget) + '</span></div>' +
        '<div class="cbud-track"><div class="cbud-bar' + levelCls + '" style="width:' +
          Math.min(it.usedPct, 100) + '%"></div></div>' +
        '<div class="cbud-note">' + note + '</div>' +
      '</div></div>';
  }
  $('catbudget-list').innerHTML = html;
}

/** 弹窗内的分类选择九宫格（只列支出分类） */
function renderCatBudgetPicker(cats, selectedId) {
  var html = '';
  for (var i = 0; i < cats.length; i++) {
    html += '<button type="button" class="cat-item' + (cats[i].id === selectedId ? ' selected' : '') +
      '" data-id="' + esc(cats[i].id) + '">' + catIconHTML(cats[i], 'cat-icon') +
      '<span class="cat-name">' + esc(cats[i].name) + '</span></button>';
  }
  $('catbudget-categories').innerHTML = html;
}

/** 打开分类预算弹窗；catId 为空时默认选中第一个尚未设预算的分类（都没有则第一个） */
function openCatBudgetModal(catId) {
  var cats = Store.getCategories('expense');
  if (!cats.length) { toast('请先在管理页添加支出分类'); return; }
  var map = Store.getCategoryBudgets();
  if (!catId || !cats.some(function (c) { return c.id === catId; })) {
    catId = null;
    for (var i = 0; i < cats.length; i++) {
      if (map[cats[i].id] == null) { catId = cats[i].id; break; }
    }
    if (!catId) catId = cats[0].id;
  }
  editingCatBudgetId = catId;
  renderCatBudgetPicker(cats, catId);
  $('catbudget-input').value = map[catId] != null ? String(map[catId]) : '';
  $('catbudget-clear-btn').classList.toggle('hidden', map[catId] == null);
  $('modal-catbudget').classList.remove('hidden');
}

/** 弹窗里切换分类：同步预填该分类已有的预算 */
function pickCatBudgetCategory(catId) {
  var cats = Store.getCategories('expense');
  if (!cats.some(function (c) { return c.id === catId; })) return;
  editingCatBudgetId = catId;
  renderCatBudgetPicker(cats, catId);
  var map = Store.getCategoryBudgets();
  $('catbudget-input').value = map[catId] != null ? String(map[catId]) : '';
  $('catbudget-clear-btn').classList.toggle('hidden', map[catId] == null);
}

/** 保存弹窗中的分类预算；金额留空视为清除 */
function catBudgetSave() {
  if (!editingCatBudgetId) return;
  var raw = $('catbudget-input').value.trim();
  try {
    if (raw === '') {
      Store.setCategoryBudget(editingCatBudgetId, null);
      toast('已清除该分类预算');
    } else {
      var v = parseFloat(raw);
      if (!isFinite(v) || v <= 0) { toast('请输入正确的预算金额'); return; }
      Store.setCategoryBudget(editingCatBudgetId, v);
      toast('分类预算已保存 ✓');
    }
  } catch (e) { toast(e.message); return; }
  $('modal-catbudget').classList.add('hidden');
  renderCategoryBudgets();
}

function budgetSave() {
  var raw = $('budget-input').value.trim();
  try {
    if (raw === '') {
      Store.setBudget(null);
      toast('已清除预算');
    } else {
      var v = parseFloat(raw);
      if (!isFinite(v) || v <= 0) { toast('请输入正确的预算金额'); return; }
      Store.setBudget(v);
      toast('预算已保存 ✓');
    }
  } catch (e) { toast(e.message); return; }
  renderBudget();
  renderHero();                                  // 英雄卡里的预算进度同步
  refreshBanner();
}

/* ================= 提醒横幅 ================= */

/** 横幅内容：图标 + 文案（情绪靠图标与底色表达，不用 emoji） */
function bannerHTML(icon, text) {
  return Icons.svg(icon, 'banner-ic') + '<span>' + esc(text) + '</span>';
}

function refreshBanner() {
  var banner = $('budget-banner');
  var status = Store.getBudgetStatus(Store.currentYm());
  if (status.level === 'warn') {
    banner.className = 'banner banner-warn';
    banner.innerHTML = bannerHTML('warn', '本月预算已用 ' + status.usedPct + '%，剩余 ¥' +
      f(status.remaining) + '，省着点花~');
  } else if (status.level === 'over') {
    banner.className = 'banner banner-over';
    banner.innerHTML = bannerHTML('warn', '本月已超支 ¥' + f(Math.abs(status.remaining)) + '，注意控制开销！');
  } else {
    banner.className = 'banner hidden';
  }
}

/** 晚间未记账提醒（本地应用无推送通道，打开页面时提示） */
function checkReminders() {
  var info = $('info-banner');
  var today = Store.todayStr();
  var records = Store.getRecords();
  var hasToday = false;
  for (var i = 0; i < records.length; i++) {
    if (records[i].date === today) { hasToday = true; break; }
  }
  var hour = new Date().getHours();
  if (hour >= 20 && !hasToday) {
    info.className = 'banner banner-info';
    info.innerHTML = bannerHTML('calendar', '今天还没有记账哦，花销别忘啦~');
  } else {
    info.className = 'banner hidden';
  }
}

/** 备份超期提醒（管理页） */
function renderBackupHint() {
  var el = $('backup-hint');
  var records = Store.getRecords();
  var b = data ? data.lastBackupAt : null;
  var days = b ? Math.floor((Date.now() - b) / 86400000) : null;
  if (records.length && (days === null || days >= 7)) {
    el.innerHTML = bannerHTML('warn', days === null
      ? '还没有导出过备份，建议立即导出一份'
      : '已 ' + days + ' 天未备份，建议导出一份完整备份');
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

/* ================= 管理页 ================= */

function renderCategoryManage() {
  var groups = [
    { title: '支出分类', kind: 'expense' },
    { title: '收入分类', kind: 'income' }
  ];
  var html = '';
  for (var g = 0; g < groups.length; g++) {
    var cats = Store.getCategories(groups[g].kind);
    if (!cats.length) continue;
    html += '<div class="mcat-group-title">' + groups[g].title + '</div>';
    for (var i = 0; i < cats.length; i++) {
      var c = cats[i];
      html += '<div class="mcat-row">' + catIconHTML(c, 'mcat-icon') +
        '<span class="mcat-name">' + esc(c.name) +
        '</span><span class="mcat-actions">' +
        '<button type="button" class="btn-icon" title="编辑" data-act="edit" data-id="' + esc(c.id) + '">' +
        Icons.svg('edit', 'ic-sm') + '</button>' +
        '<button type="button" class="btn-icon" title="删除" data-act="del" data-id="' + esc(c.id) + '">' +
        Icons.svg('del', 'ic-sm') + '</button>' +
        '</span></div>';
    }
  }
  $('category-manage-list').innerHTML = html || '<div class="empty-tip">还没有分类，点右上角新增</div>';
}

function openCategoryModal(cat) {
  editingCategoryId = cat ? cat.id : null;
  editingCategoryKind = cat ? (cat.kind || 'expense') : 'expense';
  $('modal-category-title').textContent = cat ? '编辑分类' : '新增分类';
  // 编辑时组别不可改（避免已有账单的分类改变归属）
  $('category-kind-toggle').classList.toggle('hidden', !!cat);
  var btns = document.querySelectorAll('#category-kind-toggle .type-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].getAttribute('data-kind') === editingCategoryKind);
  }
  $('category-name-input').value = cat ? cat.name : '';
  $('category-icon-input').value = cat ? cat.icon : '';
  $('modal-category').classList.remove('hidden');
  $('category-name-input').focus();
}

function categorySave() {
  var name = $('category-name-input').value;
  var icon = $('category-icon-input').value;
  try {
    if (editingCategoryId) Store.updateCategory(editingCategoryId, { name: name, icon: icon });
    else {
      var c = Store.addCategory({ name: name, icon: icon, kind: editingCategoryKind });
      if (!quickCat) {
        var first = Store.getCategories(quickType);
        quickCat = first.length ? first[0].id : c.id;
      }
    }
  } catch (e) { toast(e.message); return; }
  $('modal-category').classList.add('hidden');
  data = Store.load();
  renderCategoryManage();
  renderQuickCategories();
  toast('已保存 ✓');
}

/* ================= 记录编辑弹窗 ================= */

function setEditType(type) {
  editType = type === 'income' ? 'income' : 'expense';
  var btns = document.querySelectorAll('#edit-type-toggle .type-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].getAttribute('data-type') === editType);
  }
  var cats = Store.getCategories(editType);
  var ids = {};
  for (var j = 0; j < cats.length; j++) ids[cats[j].id] = true;
  if (!editCat || !ids[editCat]) editCat = cats.length ? cats[0].id : null;
  renderCategoryGrid($('edit-categories'), editType, editCat);
}

function openRecordModal(id) {
  var r = Store.getRecord(id);
  if (!r) return;
  editingRecordId = id;
  editCat = r.categoryId;
  $('edit-amount').value = Store.formatAmount(r.amount);   // 输入框要纯数字，不能用带千分位的 f()
  $('edit-date').value = r.date;
  $('edit-note').value = r.note || '';
  setEditType(r.type || 'expense');
  renderEditItems(r.items || []);
  setItemsExpanded(false);                 // 明细默认收起成一行摘要，避免弹窗一开就占满屏
  $('modal-record').classList.remove('hidden');
}

/* ---------- 商品明细编辑（编辑弹窗内） ---------- */

/** 渲染商品明细行；items 为 [{name,qty,price}] */
function renderEditItems(items) {
  var list = $('edit-items-list');
  list.innerHTML = '';
  for (var i = 0; i < items.length; i++) addItemRow(items[i]);
  updateItemsSum();
}

function addItemRow(item) {
  var row = document.createElement('div');
  row.className = 'item-row';
  var it = item || {};
  row.innerHTML =
    '<input type="text" maxlength="30" placeholder="商品名" value="' + esc(it.name || '') + '">' +
    '<input type="text" inputmode="decimal" placeholder="数量" value="' + (it.qty != null ? it.qty : 1) + '">' +
    '<input type="text" inputmode="decimal" placeholder="单价" value="' + (it.price != null ? it.price : '') + '">' +
    '<button type="button" class="btn-icon" title="删除">' + Icons.svg('del', 'ic-sm') + '</button>';
  $('edit-items-list').appendChild(row);
  updateItemsSum();
}

/** 从编辑器读取商品行；name 为空的行丢弃，qty 非法回落 1，price 非法记 0 */
function collectItems() {
  var rows = $('edit-items-list').querySelectorAll('.item-row');
  var items = [];
  for (var i = 0; i < rows.length; i++) {
    var inputs = rows[i].querySelectorAll('input');
    var name = inputs[0].value.trim();
    if (!name) continue;
    var qty = parseFloat(inputs[1].value);
    if (!isFinite(qty) || qty <= 0) qty = 1;
    var price = parseFloat(inputs[2].value);
    if (!isFinite(price) || price < 0) price = 0;
    items.push({ name: name, qty: qty, price: price });
  }
  return items;
}

function updateItemsSum() {
  var items = collectItems();
  var sumEl = $('items-sum');
  var label = $('items-toggle-text');
  if (!items.length) {
    sumEl.classList.add('hidden');
    if (label) label.textContent = '添加商品明细';
    return;
  }
  var total = 0;
  for (var i = 0; i < items.length; i++) total += items[i].qty * items[i].price;
  var sum = Math.round(total * 100) / 100;
  sumEl.textContent = '明细合计 ¥' + f(sum) + '（点金额栏可手动改成一致）';
  sumEl.classList.remove('hidden');
  if (label) label.textContent = items.length + ' 件 · 合计 ¥' + f(sum);   // 折叠时的那行摘要
}

/** 商品明细：折叠成一行摘要 / 展开编辑 */
function setItemsExpanded(open) {
  var box = $('items-editor');
  var btn = $('items-toggle-btn');
  if (!box || !btn) return;
  box.classList.toggle('collapsed', !open);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

/* ---------- 购物清单导入 ---------- */

function toggleShoppingCard(show) {
  var card = $('shopping-card');
  var willShow = show === undefined ? card.classList.contains('hidden') : show;
  card.classList.toggle('hidden', !willShow);
  if (willShow) {
    updateShoppingPreview();
    $('shopping-text').focus();
  }
}

function updateShoppingPreview() {
  var res = Shopping.parse($('shopping-text').value);
  var el = $('shopping-preview');
  if (!res.ok) { el.textContent = ''; return; }
  el.textContent = '共 ' + res.items.length + ' 件 · 合计 ¥' + f(res.total) +
    (res.skipped > 0 ? '（' + res.skipped + ' 行未识别）' : '');
}

function saveShopping() {
  var res = Shopping.parse($('shopping-text').value);
  if (!res.ok) { toast('没有解析到商品，检查一下格式'); return; }
  if (res.total <= 0) { toast('合计金额为 0，请给商品填上价格'); return; }
  var cats = Store.getCategories('expense');
  var catId = 'gouwu';
  var hasGouwu = false;
  for (var i = 0; i < cats.length; i++) if (cats[i].id === 'gouwu') { hasGouwu = true; break; }
  if (!hasGouwu) catId = cats.length ? cats[0].id : null;
  if (!catId) { toast('请先到「管理」页添加分类'); return; }
  try {
    Store.addRecord({
      type: 'expense',
      amount: res.total,
      categoryId: catId,
      date: Store.todayStr(),
      note: '购物清单',
      items: res.items
    });
  } catch (e) { toast(e.message); return; }
  $('shopping-text').value = '';
  updateShoppingPreview();
  toggleShoppingCard(false);
  successFlash('已记 ' + res.items.length + ' 件 · 合计 ¥' + f(res.total));
  renderRecordList();
  refreshBanner();
  checkReminders();
}

function editSave() {
  if (!editingRecordId) return;
  var amount = parseFloat($('edit-amount').value);
  if (!isFinite(amount) || amount <= 0) { toast('请输入正确的金额'); return; }
  try {
    Store.updateRecord(editingRecordId, {
      type: editType,
      amount: amount,
      categoryId: editCat,
      date: $('edit-date').value || Store.todayStr(),
      note: $('edit-note').value,
      items: collectItems()
    });
  } catch (e) { toast(e.message); return; }
  $('modal-record').classList.add('hidden');
  toast('已保存 ✓');
  renderRecordList();
  refreshBanner();
  checkReminders();
}

function editDelete() {
  if (!editingRecordId) return;
  if (!confirm('确定删除这条记录吗？')) return;
  Store.deleteRecord(editingRecordId);
  $('modal-record').classList.add('hidden');
  toast('已删除');
  renderRecordList();
  refreshBanner();
  checkReminders();
}

/* ================= 导入导出 ================= */

function exportCSV() {
  var records = Store.getMonthRecords(currentYm);
  if (!records.length) { toast('本月没有账单可导出'); return; }
  downloadFile('账单_' + currentYm + '.csv', Store.exportCSV(currentYm), 'text/csv;charset=utf-8');
  toast('已导出 CSV ✓');
}

function exportJSON() {
  downloadFile('记账备份_' + Store.todayStr().replace(/-/g, '') + '.json', Store.exportJSON(), 'application/json');
  data = Store.load(); // lastBackupAt 已更新
  renderBackupHint();
  toast('已导出备份 ✓');
}

function importJSON(file) {
  var reader = new FileReader();
  reader.onload = function () {
    var res = Store.importJSON(reader.result);
    if (!res.ok) { toast(res.error); return; }
    data = Store.load();
    var cats = Store.getCategories(quickType);
    quickCat = cats.length ? cats[0].id : null;
    toast('恢复成功 ✓');
    renderCategoryManage();
    renderBackupHint();
    renderRecordList();                       // 恢复后明细与英雄卡同步刷新
    refreshBanner();
  };
  reader.readAsText(file, 'utf-8');
}

/* ================= 事件绑定与启动 ================= */

/**
 * 抽屉把手下拉关闭：按住把手往下拖，超过 80px 松手即关闭，否则弹回原位。
 * 只挂在把手上（不劫持弹窗内容），所以不影响内部滚动与输入。
 */
function bindModalDrag(modal) {
  var body = modal.querySelector('.modal-body');
  var handle = modal.querySelector('.modal-handle');
  if (!body || !handle) return;
  var startY = 0;
  var dy = 0;
  var dragging = false;

  handle.addEventListener('pointerdown', function (e) {
    dragging = true;
    startY = e.clientY;
    dy = 0;
    body.style.transition = 'none';
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
  });
  handle.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - startY);
    body.style.transform = 'translateY(' + dy + 'px)';
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    body.style.transition = '';              // 交还给 CSS 的过渡（弹回）
    body.style.transform = '';
    if (dy > 80) modal.classList.add('hidden');
    dy = 0;
  }
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
}

function bindEvents() {
  // 底部导航
  var tabs = document.querySelectorAll('#tab-bar .tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener('click', function () { switchView(this.getAttribute('data-view')); });
  }

  // 月份切换
  $('month-prev').addEventListener('click', function () { shiftMonth(-1); });
  $('month-next').addEventListener('click', function () { shiftMonth(1); });

  // 记一笔
  $('quick-save-btn').addEventListener('click', quickSave);
  $('quick-amount').addEventListener('keydown', function (e) { if (e.key === 'Enter') quickSave(); });
  $('quick-note').addEventListener('keydown', function (e) { if (e.key === 'Enter') quickSave(); });
  $('quick-categories').addEventListener('click', function (e) {
    var btn = e.target.closest('.cat-item');
    if (!btn) return;
    quickCat = btn.getAttribute('data-id');
    renderQuickCategories();
  });
  $('quick-type-toggle').addEventListener('click', function (e) {
    var btn = e.target.closest('.type-btn');
    if (btn) setQuickType(btn.getAttribute('data-type'));
  });

  // 智能记账
  $('smart-parse-btn').addEventListener('click', smartParse);
  $('smart-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') smartParse(); });

  // 购物清单导入
  $('toggle-shopping-btn').addEventListener('click', function () { toggleShoppingCard(); });
  $('shopping-cancel-btn').addEventListener('click', function () { toggleShoppingCard(false); });
  $('shopping-save-btn').addEventListener('click', saveShopping);
  $('shopping-text').addEventListener('input', updateShoppingPreview);

  // 搜索
  $('search-input').addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderRecordList, 200);
  });
  $('search-scope').addEventListener('change', renderRecordList);

  // 流水列表（事件委托 → 编辑弹窗）
  $('record-list').addEventListener('click', function (e) {
    var item = e.target.closest('.record-item');
    if (item) openRecordModal(item.getAttribute('data-id'));
  });

  // 统计页饼图切换
  $('pie-toggle').addEventListener('click', function (e) {
    var btn = e.target.closest('.type-btn');
    if (!btn) return;
    pieKind = btn.getAttribute('data-kind') === 'income' ? 'income' : 'expense';
    var btns = document.querySelectorAll('#pie-toggle .type-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-kind') === pieKind);
    }
    renderStats();
  });

  // 预算
  $('budget-save-btn').addEventListener('click', budgetSave);
  $('budget-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') budgetSave(); });

  // 分类预算：列表点行编辑 / 「+ 设置分类预算」新增
  $('add-catbudget-btn').addEventListener('click', function () { openCatBudgetModal(null); });
  $('catbudget-list').addEventListener('click', function (e) {
    var row = e.target.closest('.cbud-row');
    if (row) openCatBudgetModal(row.getAttribute('data-id'));
  });
  $('catbudget-categories').addEventListener('click', function (e) {
    var btn = e.target.closest('.cat-item');
    if (btn) pickCatBudgetCategory(btn.getAttribute('data-id'));
  });
  $('catbudget-save-btn').addEventListener('click', catBudgetSave);
  $('catbudget-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') catBudgetSave(); });
  $('catbudget-clear-btn').addEventListener('click', function () {
    if (!editingCatBudgetId) return;
    try { Store.setCategoryBudget(editingCatBudgetId, null); } catch (err) { toast(err.message); return; }
    $('modal-catbudget').classList.add('hidden');
    toast('已清除该分类预算');
    renderCategoryBudgets();
  });
  $('catbudget-cancel-btn').addEventListener('click', function () {
    $('modal-catbudget').classList.add('hidden');
  });

  // 账本加密：开关按钮 + 设置弹窗
  $('enc-toggle-btn').addEventListener('click', openEncModal);
  $('enc-confirm-btn').addEventListener('click', encConfirm);
  $('enc-pw-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') encConfirm(); });
  $('enc-cancel-btn').addEventListener('click', function () {
    $('modal-enc').classList.add('hidden');
  });

  // 主题：明暗
  $('theme-toggle').addEventListener('click', function (e) {
    var btn = e.target.closest('.type-btn');
    if (btn) applyTheme(btn.getAttribute('data-theme'));
  });

  // 主题：风格色板（预览卡网格）
  $('accent-toggle').addEventListener('click', function (e) {
    var btn = e.target.closest('.accent-card');
    if (btn) applyAccent(btn.getAttribute('data-accent'));
  });

  // 管理页
  $('add-category-btn').addEventListener('click', function () { openCategoryModal(null); });
  $('category-kind-toggle').addEventListener('click', function (e) {
    var btn = e.target.closest('.type-btn');
    if (!btn) return;
    editingCategoryKind = btn.getAttribute('data-kind') === 'income' ? 'income' : 'expense';
    var btns = document.querySelectorAll('#category-kind-toggle .type-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-kind') === editingCategoryKind);
    }
  });
  $('category-manage-list').addEventListener('click', function (e) {
    var btn = e.target.closest('.btn-icon');
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    var act = btn.getAttribute('data-act');
    if (act === 'edit') {
      var cat = null;
      var cats = Store.getCategories();
      for (var i = 0; i < cats.length; i++) if (cats[i].id === id) cat = cats[i];
      if (cat) openCategoryModal(cat);
    } else if (act === 'del') {
      var target = null, name = '';
      var list = Store.getCategories();
      for (var j = 0; j < list.length; j++) if (list[j].id === id) { target = list[j]; name = list[j].name; }
      if (!target) return;
      if (!confirm('确定删除分类「' + name + '」吗？')) return;
      try { Store.deleteCategory(id); } catch (err) { toast(err.message); return; }
      if (quickCat === id) {
        var rest = Store.getCategories(quickType);
        quickCat = rest.length ? rest[0].id : null;
      }
      data = Store.load();
      renderCategoryManage();
      renderQuickCategories();
      toast('已删除');
    }
  });

  // 导入导出
  $('export-csv-btn').addEventListener('click', exportCSV);
  $('export-json-btn').addEventListener('click', exportJSON);
  $('import-json-btn').addEventListener('click', function () { $('import-file-input').click(); });
  $('import-file-input').addEventListener('change', function () {
    if (this.files && this.files[0]) importJSON(this.files[0]);
    this.value = '';
  });

  // 编辑记录弹窗
  $('edit-save-btn').addEventListener('click', editSave);
  $('edit-cancel-btn').addEventListener('click', function () { $('modal-record').classList.add('hidden'); });
  $('edit-delete-btn').addEventListener('click', editDelete);
  $('edit-type-toggle').addEventListener('click', function (e) {
    var btn = e.target.closest('.type-btn');
    if (btn) setEditType(btn.getAttribute('data-type'));
  });
  $('edit-categories').addEventListener('click', function (e) {
    var btn = e.target.closest('.cat-item');
    if (!btn) return;
    editCat = btn.getAttribute('data-id');
    renderCategoryGrid($('edit-categories'), editType, editCat);
  });

  // 商品明细编辑器（默认折叠，点摘要行展开）
  $('items-toggle-btn').addEventListener('click', function () {
    setItemsExpanded($('items-editor').classList.contains('collapsed'));
  });
  $('add-item-btn').addEventListener('click', function () { addItemRow(null); });
  $('edit-items-list').addEventListener('click', function (e) {
    var btn = e.target.closest('.btn-icon');
    if (!btn) return;
    btn.parentNode.remove();
    updateItemsSum();
  });
  $('edit-items-list').addEventListener('input', updateItemsSum);

  // 空状态里的行动按钮（记一笔 / 清空搜索）
  $('view-record').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-empty-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-empty-act');
    if (act === 'focus-amount') {
      $('quick-amount').focus();
    } else if (act === 'clear-search') {
      $('search-input').value = '';
      renderRecordList();
    }
  });

  // 抽屉把手：下拉关闭
  var modals = document.querySelectorAll('.modal');
  for (var mi = 0; mi < modals.length; mi++) bindModalDrag(modals[mi]);

  // 分类弹窗
  $('category-save-btn').addEventListener('click', categorySave);  $('category-cancel-btn').addEventListener('click', function () { $('modal-category').classList.add('hidden'); });

  // 修改密码弹窗
  $('pw-cancel-btn').addEventListener('click', function () { $('modal-password').classList.add('hidden'); });
  $('pw-save-btn').addEventListener('click', function () {
    var newPw = $('pw-new').value;
    if (newPw !== $('pw-new2').value) { toast('两次输入的新密码不一致'); return; }
    $('pw-save-btn').disabled = true;
    var rekeyed = false;   // 加密账户：数据是否已用新钥匙重写（失败回滚用）
    Auth.verifyPassword($('pw-old').value)
      .then(function (ok) {
        if (!ok) throw new Error('旧密码不正确');
        return Auth.rekeyData(newPw);          // 未加密账户返回 false，直接跳过
      })
      .then(function (did) {
        rekeyed = did;
        if (!did) return null;
        Store.repersist();                     // 先用新钥匙把整份数据回写落盘
        return Store.flush();
      })
      .then(function () { return Auth.replacePassword(newPw); })
      .then(function () {
        $('pw-save-btn').disabled = false;
        $('modal-password').classList.add('hidden');
        toast('密码已修改 ✓');
      })
      .catch(function (e) {
        if (rekeyed) {                         // 回滚：数据写回旧钥匙，保证旧密码仍可解锁
          Auth.restoreDataKey();
          Store.repersist();
        }
        $('pw-save-btn').disabled = false;
        toast(e.message || '修改失败');
      });
  });

  // 点击遮罩关闭所有弹窗
  var masks = document.querySelectorAll('.modal-mask');
  for (var k = 0; k < masks.length; k++) {
    masks[k].addEventListener('click', function () {
      this.parentNode.classList.add('hidden');
    });
  }

  // 登录 / 注册界面
  $('auth-tab-login').addEventListener('click', function () { setAuthMode('login'); });
  $('auth-tab-register').addEventListener('click', function () { setAuthMode('register'); });
  $('auth-submit-btn').addEventListener('click', authSubmit);
  var authInputs = ['auth-username', 'auth-password', 'auth-password2'];
  for (var a = 0; a < authInputs.length; a++) {
    $(authInputs[a]).addEventListener('keydown', function (e) { if (e.key === 'Enter') authSubmit(); });
  }

  // 账户：退出登录
  $('logout-btn').addEventListener('click', function () {
    Auth.logout();
    location.reload();
  });
  $('change-pw-btn').addEventListener('click', function () {
    $('pw-old').value = '';
    $('pw-new').value = '';
    $('pw-new2').value = '';
    $('modal-password').classList.remove('hidden');
  });
}

/* ================= 登录 / 注册 ================= */

function setAuthMode(mode) {
  authMode = mode;
  $('auth-tab-login').classList.toggle('active', mode === 'login');
  $('auth-tab-register').classList.toggle('active', mode === 'register');
  $('auth-password2-row').classList.toggle('hidden', mode !== 'register');
  $('auth-submit-btn').textContent = mode === 'login' ? '登 录' : '注 册';
}

function showAuth(mode) {
  $('app').classList.add('hidden');
  $('auth-screen').classList.remove('hidden');
  $('auth-password').value = '';
  $('auth-password2').value = '';
  if (mode === 'unlock') {
    // 加密账本解锁：锁死用户名、隐藏注册页签与确认密码，只留密码框
    authMode = 'unlock';
    $('auth-username').value = Auth.currentUser() || '';
    $('auth-username').setAttribute('readonly', 'readonly');
    $('auth-tabs').classList.add('hidden');
    $('auth-hint').classList.add('hidden');
    $('auth-unlock-hint').classList.remove('hidden');
    $('auth-password2-row').classList.add('hidden');
    $('auth-submit-btn').textContent = '解 锁';
    return;
  }
  $('auth-username').removeAttribute('readonly');
  $('auth-username').value = '';
  $('auth-tabs').classList.remove('hidden');
  $('auth-hint').classList.remove('hidden');
  $('auth-unlock-hint').classList.add('hidden');
  setAuthMode(mode || 'login');
}

function authSubmit() {
  try {
    var u = $('auth-username').value;
    var p = $('auth-password').value;
    if (authMode === 'register' && p !== $('auth-password2').value) {
      toast('两次输入的密码不一致');
      return;
    }
    var btn = $('auth-submit-btn');
    btn.disabled = true;
    var action = authMode === 'register' ? Auth.register(u, p) : Auth.login(u, p);
    action.then(function (res) {
      btn.disabled = false;
      // 本机第一个注册的账户：接管旧版单用户数据（如有）
      if (authMode === 'register' && Auth.users().length === 1) migrateLegacyData(res.username);
      $('auth-screen').classList.add('hidden');
      $('app').classList.remove('hidden');
      startApp(res.username);
    }).catch(function (e) {
      btn.disabled = false;
      toast(e.message);
    });
  } catch (e) {
    $('auth-submit-btn').disabled = false;
    toast(e.message || '操作失败，请重试');
  }
}

/** 首个注册账户继承升级前的旧账本数据 */
function migrateLegacyData(username) {
  try {
    var legacy = localStorage.getItem('jz_data_v1');
    if (legacy && !localStorage.getItem('jz_data_v1::' + username)) {
      localStorage.setItem('jz_data_v1::' + username, legacy);
      localStorage.removeItem('jz_data_v1');
    }
  } catch (e) {
    console.warn('旧数据迁移失败：', e);
  }
}

/* ================= PWA ================= */

function detectStandalone() {
  var standalone = (navigator.standalone === true) ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  if (standalone) document.body.classList.add('standalone-ios');
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Service Worker 只在 https 或 localhost 下可用；双击 file:// 打开时跳过（功能不受影响）
  var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (location.protocol !== 'https:' && !local) return;

  // 新 SW 接管（skipWaiting + claim）时自动刷新一次，让更新立即生效，无需手动刷新两次。
  // 首次安装例外：页面本来就是最新加载的，接管无需刷新。
  var firstInstall = !navigator.serviceWorker.controller;
  var reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (firstInstall || reloaded) return;
    reloaded = true;
    location.reload();
  });

  var swReg = null;
  navigator.serviceWorker.register('sw.js').then(function (reg) {
    console.log('[PWA] 离线缓存就绪', reg.scope);
    swReg = reg;
    // 打开页面时主动查一次更新（配合 sw.js 网络优先，在线即最新）
    try { reg.update().catch(function () { /* 忽略 */ }); } catch (e) { /* 忽略 */ }
  }).catch(function (e) {
    console.warn('[PWA] Service Worker 注册失败：', e);
  });

  // 切回前台时也查一次更新：后台放了几天的 PWA，一打开就自动升级
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && swReg) {
      try { swReg.update().catch(function () { /* 忽略 */ }); } catch (e) { /* 忽略 */ }
    }
  });
}

/* ================= 启动入口 ================= */

/**
 * 处理启动参数（PWA 快捷方式 / 分享目标，只在登录后执行）：
 *   ?action=add    桌面长按「记一笔」→ 记账页并聚焦金额输入
 *   ?action=meal   桌面长按「记一餐」→ 饮食页并聚焦智能记餐输入
 *   ?view=stats    桌面长按「看统计」→ 直达统计页
 *   ?text=...      从微信/支付宝等「分享」进来的文本 → 自动跑智能记账解析
 * 参数处理完即用 replaceState 抹掉，刷新或切换账户不会重复触发。
 */
function handleLaunchParams() {
  var q = null;
  try { q = new URLSearchParams(location.search); } catch (e) { return; }  // 老内核静默跳过
  if (!q) return;

  var action = q.get('action') || '';
  var view = q.get('view') || '';
  var shared = q.get('text') || q.get('title') || '';
  if (!action && !view && !shared) return;

  function clearQuery() {
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* 忽略 */ }
  }

  if (shared) {
    // 分享文本：塞进智能记账，解析成功即回填表单，用户确认后点「记一笔」
    switchView('record');
    clearQuery();
    $('smart-input').value = shared.slice(0, 60);
    smartParse();
    return;
  }
  if (action === 'add') {
    switchView('record');
    clearQuery();
    $('quick-amount').focus();
    return;
  }
  if (action === 'meal') {
    switchView('diet');
    clearQuery();
    var mealInput = $('diet-nlp-input');
    if (mealInput) mealInput.focus();
    return;
  }
  if (['record', 'stats', 'budget', 'diet', 'manage'].indexOf(view) >= 0) {
    switchView(view);
    clearQuery();
  } else {
    clearQuery();   // 未知参数同样清掉，保持地址栏干净
  }
}

/** 登录成功后：绑定该账户的数据空间并初始化各视图 */
function startApp(username) {
  Store.setUser(username);
  data = Store.load();
  currentYm = Store.currentYm();
  quickType = 'expense';
  pieKind = 'expense';
  var btns = document.querySelectorAll('#quick-type-toggle .type-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].getAttribute('data-type') === 'expense');
  }
  var cats = Store.getCategories(quickType);
  quickCat = cats.length ? cats[0].id : null;
  $('account-name').textContent = username;
  $('quick-date').value = Store.todayStr();
  $('search-input').value = '';
  $('search-scope').value = 'month';
  DietUI.reset(); // 重置饮食页浏览状态（日期/选中食物等归位到新账户）
  updateMonthLabel();
  var saved = loadThemePref();          // 应用该账户的主题偏好（mode × accent）
  PREF.mode = saved.mode;
  PREF.accent = saved.accent;
  saveThemePref();
  applyResolvedTheme(true);
  switchView('record');
  refreshBanner();
  checkReminders();
  handleLaunchParams();                 // 快捷方式 / 分享进来的启动参数
}

function boot() {
  detectStandalone();
  applyResolvedTheme(true);   // 登录前先按系统深浅上主题，避免深色用户白闪
  bindEvents();
  DietUI.init(); // 饮食页事件只绑一次（元素为静态 HTML，与登录状态无关）
  Insights.init(); // 统计页洞察轮播只绑一次
  registerServiceWorker();
  var user = Auth.currentUser();
  if (user) {
    if (Auth.isLocked(user)) {           // 账本已加密：先解锁再进入
      showAuth('unlock');
      return;
    }
    $('auth-screen').classList.add('hidden');
    $('app').classList.remove('hidden');
    startApp(user);
  } else {
    // 还没有任何账户时默认展示注册页
    showAuth(Auth.isEmpty() ? 'register' : 'login');
  }
}

var authMode = 'login';

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
