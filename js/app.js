/**
 * app.js —— 界面逻辑与模块集成层
 * 依赖：core.js（全局 Store）、charts.js（全局 Charts）
 */
(function () {
'use strict';

var $ = function (id) { return document.getElementById(id); };

var VIEW_TITLES = { record: '记账', stats: '统计', budget: '预算', manage: '管理' };
var WEEKS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

var data = null;              // Store 数据缓存
var currentYm = null;         // 当前浏览的月份 'YYYY-MM'
var currentView = 'record';
var quickCat = null;          // 记账页选中的分类
var editCat = null;           // 编辑弹窗选中的分类
var editingRecordId = null;   // 正在编辑的记录 id
var editingCategoryId = null; // 正在编辑的分类 id（null = 新增）
var authMode = 'login';       // 登录界面当前模式 'login' | 'register'
var toastTimer = null;

function f(n) { return Store.formatAmount(n); }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toast(msg) {
  var t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 1800);
}

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

/* ================= 视图切换 ================= */

function switchView(view) {
  if (currentView === 'stats' && view !== 'stats') Charts.destroyAll();
  currentView = view;

  var views = document.querySelectorAll('.view');
  for (var i = 0; i < views.length; i++) views[i].classList.add('hidden');
  $('view-' + view).classList.remove('hidden');

  var tabs = document.querySelectorAll('#tab-bar .tab');
  for (var j = 0; j < tabs.length; j++) {
    tabs[j].classList.toggle('active', tabs[j].getAttribute('data-view') === view);
  }

  $('page-title').textContent = VIEW_TITLES[view];
  $('month-nav').classList.toggle('hidden', view === 'manage');

  if (view === 'record') { renderQuickCategories(); renderRecordList(); }
  else if (view === 'stats') renderStats();
  else if (view === 'budget') renderBudget();
  else if (view === 'manage') renderCategoryManage();
}

/* ================= 月份导航 ================= */

function shiftMonth(delta) {
  var parts = currentYm.split('-');
  var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1 + delta, 1);
  var ym = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
  if (ym > Store.currentYm()) return; // 不允许翻到未来
  currentYm = ym;
  updateMonthLabel();
  if (currentView === 'record') renderRecordList();
  else if (currentView === 'stats') renderStats();
  else if (currentView === 'budget') renderBudget();
}

function updateMonthLabel() {
  var parts = currentYm.split('-');
  $('month-label').textContent = parseInt(parts[0], 10) + '年' + parseInt(parts[1], 10) + '月';
}

/* ================= 记账页 ================= */

function renderCategoryGrid(container, selectedId) {
  var cats = Store.getCategories();
  var html = '';
  for (var i = 0; i < cats.length; i++) {
    var c = cats[i];
    html += '<button type="button" class="cat-item' + (c.id === selectedId ? ' selected' : '') +
      '" data-id="' + esc(c.id) + '"><span class="cat-icon">' + esc(c.icon) +
      '</span><span class="cat-name">' + esc(c.name) + '</span></button>';
  }
  container.innerHTML = html;
}

function renderQuickCategories() {
  renderCategoryGrid($('quick-categories'), quickCat);
}

function quickSave() {
  var cats = Store.getCategories();
  if (!cats.length) { toast('请先到「管理」页添加分类'); return; }
  var amount = parseFloat($('quick-amount').value);
  if (!isFinite(amount) || amount <= 0) { toast('请输入正确的金额'); return; }
  var date = $('quick-date').value || Store.todayStr();
  var note = $('quick-note').value;
  try {
    Store.addRecord({ amount: amount, categoryId: quickCat || cats[0].id, date: date, note: note });
  } catch (e) { toast(e.message); return; }
  $('quick-amount').value = '';
  $('quick-note').value = '';
  toast('已记账 ✓');
  renderRecordList();
  refreshBanner();
}

function renderRecordList() {
  var list = $('record-list');
  var records = Store.getMonthRecords(currentYm);
  var cats = {};
  var allCats = Store.getCategories();
  for (var k = 0; k < allCats.length; k++) cats[allCats[k].id] = allCats[k];

  if (!records.length) {
    list.innerHTML = '';
    $('record-empty').classList.remove('hidden');
    return;
  }
  $('record-empty').classList.add('hidden');

  var html = '';
  var dayTotal = 0, dayKey = '';
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    var cat = cats[r.categoryId] || { name: '未知分类', icon: '🏷️' };
    if (r.date !== dayKey) {
      if (dayKey) html += '</div></div>';
      dayKey = r.date;
      dayTotal = 0;
      var p = r.date.split('-');
      var week = WEEKS[new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)).getDay()];
      html += '<div class="day-group" data-date="' + esc(r.date) + '"><div class="day-head"><span class="day-title">' +
        parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日 ' + week + '</span><span class="day-total"></span></div><div class="day-body">';
    }
    dayTotal += r.amount;
    html += '<div class="record-item" data-id="' + esc(r.id) + '">' +
      '<span class="record-icon">' + esc(cat.icon) + '</span>' +
      '<div class="record-info"><span class="record-cat">' + esc(cat.name) + '</span>' +
      (r.note ? '<span class="record-note">' + esc(r.note) + '</span>' : '') +
      '</div><span class="record-amount">-' + f(r.amount) + '</span></div>';
  }
  // 回填每天小计：先整体拼好再统一替换占位太绕，改为两遍法
  html += '</div></div>';

  // 第一遍拼出的 day-total 是空占位，用第二遍计算填入
  var wrap = document.createElement('div');
  wrap.innerHTML = html;
  var groups = wrap.querySelectorAll('.day-group');
  var byDate = {};
  for (var m = 0; m < records.length; m++) {
    byDate[records[m].date] = (byDate[records[m].date] || 0) + records[m].amount;
  }
  for (var n = 0; n < groups.length; n++) {
    var dateStr = groups[n].getAttribute('data-date');
    var total = byDate[dateStr] || 0;
    groups[n].querySelector('.day-total').textContent = '¥' + f(total);
  }
  list.innerHTML = '';
  while (wrap.firstChild) list.appendChild(wrap.firstChild);
}

/* ================= 统计页 ================= */

function renderStats() {
  var s = Store.getMonthSummary(currentYm);

  var avg = s.daily.length ? s.total / s.daily.length : 0;
  $('stat-summary').innerHTML =
    '<div class="summary-item"><span class="summary-label">总支出</span><span class="summary-value">¥' + f(s.total) + '</span></div>' +
    '<div class="summary-item"><span class="summary-label">笔数</span><span class="summary-value">' + s.count + '</span></div>' +
    '<div class="summary-item"><span class="summary-label">日均</span><span class="summary-value">¥' + f(avg) + '</span></div>';

  var pieItems = [];
  for (var i = 0; i < s.byCategory.length; i++) {
    var c = s.byCategory[i];
    pieItems.push({ name: c.name, value: c.total, color: c.color });
  }
  $('pie-empty').classList.toggle('hidden', pieItems.length > 0);
  Charts.renderCategoryPie($('pie-chart'), pieItems);

  var days = [];
  for (var j = 0; j < s.daily.length; j++) {
    days.push({ label: s.daily[j].date.slice(5), value: s.daily[j].total });
  }
  $('trend-empty').classList.toggle('hidden', days.length > 0);
  Charts.renderDailyTrend($('trend-chart'), days);
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
        (status.level === 'warn' ? ' · ⚠️ 快到预算上限了' : '');
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
      html += '<div class="bcat-row"><span class="bcat-icon">' + esc(c.icon) +
        '</span><span class="bcat-name">' + esc(c.name) +
        '</span><div class="bcat-bar-track"><div class="bcat-bar" style="width:' +
        Math.round(c.total / max * 100) + '%;background:' + esc(c.color) + '"></div></div>' +
        '<span class="bcat-amount">¥' + f(c.total) + '</span></div>';
    }
    listEl.innerHTML = html;
  }
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
  refreshBanner();
}

/* ================= 预算提醒横幅 ================= */

function refreshBanner() {
  var banner = $('budget-banner');
  var status = Store.getBudgetStatus(Store.currentYm());
  if (status.level === 'warn') {
    banner.className = 'banner banner-warn';
    banner.textContent = '⚠️ 本月预算已用 ' + status.usedPct + '%，剩余 ¥' + f(status.remaining) + '，省着点花~';
  } else if (status.level === 'over') {
    banner.className = 'banner banner-over';
    banner.textContent = '🚨 本月已超支 ¥' + f(Math.abs(status.remaining)) + '，注意控制开销！';
  } else {
    banner.className = 'banner hidden';
  }
}

/* ================= 管理页 ================= */

function renderCategoryManage() {
  var cats = Store.getCategories();
  var html = '';
  for (var i = 0; i < cats.length; i++) {
    var c = cats[i];
    html += '<div class="mcat-row"><span class="mcat-icon">' + esc(c.icon) +
      '</span><span class="mcat-name">' + esc(c.name) +
      '</span><span class="mcat-actions">' +
      '<button type="button" class="btn-icon" data-act="edit" data-id="' + esc(c.id) + '">✏️</button>' +
      '<button type="button" class="btn-icon" data-act="del" data-id="' + esc(c.id) + '">🗑️</button>' +
      '</span></div>';
  }
  $('category-manage-list').innerHTML = html || '<div class="empty-tip">还没有分类，点右上角新增</div>';
}

function openCategoryModal(cat) {
  editingCategoryId = cat ? cat.id : null;
  $('modal-category-title').textContent = cat ? '编辑分类' : '新增分类';
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
      var c = Store.addCategory({ name: name, icon: icon });
      if (!quickCat) quickCat = c.id;
    }
  } catch (e) { toast(e.message); return; }
  $('modal-category').classList.add('hidden');
  data = Store.load();
  renderCategoryManage();
  renderQuickCategories();
  toast('已保存 ✓');
}

/* ================= 记录编辑弹窗 ================= */

function openRecordModal(id) {
  var r = Store.getRecord(id);
  if (!r) return;
  editingRecordId = id;
  editCat = r.categoryId;
  $('edit-amount').value = f(r.amount);
  $('edit-date').value = r.date;
  $('edit-note').value = r.note || '';
  renderCategoryGrid($('edit-categories'), editCat);
  $('modal-record').classList.remove('hidden');
}

function editSave() {
  if (!editingRecordId) return;
  var amount = parseFloat($('edit-amount').value);
  if (!isFinite(amount) || amount <= 0) { toast('请输入正确的金额'); return; }
  try {
    Store.updateRecord(editingRecordId, {
      amount: amount,
      categoryId: editCat,
      date: $('edit-date').value || Store.todayStr(),
      note: $('edit-note').value
    });
  } catch (e) { toast(e.message); return; }
  $('modal-record').classList.add('hidden');
  toast('已保存 ✓');
  renderRecordList();
  refreshBanner();
}

function editDelete() {
  if (!editingRecordId) return;
  if (!confirm('确定删除这条记录吗？')) return;
  Store.deleteRecord(editingRecordId);
  $('modal-record').classList.add('hidden');
  toast('已删除');
  renderRecordList();
  refreshBanner();
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
  toast('已导出备份 ✓');
}

function importJSON(file) {
  var reader = new FileReader();
  reader.onload = function () {
    var res = Store.importJSON(reader.result);
    if (!res.ok) { toast(res.error); return; }
    data = Store.load();
    var cats = Store.getCategories();
    quickCat = cats.length ? cats[0].id : null;
    toast('恢复成功 ✓');
    renderCategoryManage();
    refreshBanner();
  };
  reader.readAsText(file, 'utf-8');
}

/* ================= 事件绑定与启动 ================= */

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

  // 流水列表（事件委托 → 编辑弹窗）
  $('record-list').addEventListener('click', function (e) {
    var item = e.target.closest('.record-item');
    if (item) openRecordModal(item.getAttribute('data-id'));
  });

  // 预算
  $('budget-save-btn').addEventListener('click', budgetSave);
  $('budget-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') budgetSave(); });

  // 管理页
  $('add-category-btn').addEventListener('click', function () { openCategoryModal(null); });
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
        var rest = Store.getCategories();
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
  $('edit-categories').addEventListener('click', function (e) {
    var btn = e.target.closest('.cat-item');
    if (!btn) return;
    editCat = btn.getAttribute('data-id');
    renderCategoryGrid($('edit-categories'), editCat);
  });

  // 分类弹窗
  $('category-save-btn').addEventListener('click', categorySave);
  $('category-cancel-btn').addEventListener('click', function () { $('modal-category').classList.add('hidden'); });

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

  // 账户：退出登录 / 修改密码
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
  $('pw-cancel-btn').addEventListener('click', function () { $('modal-password').classList.add('hidden'); });
  $('pw-save-btn').addEventListener('click', function () {
    var newPw = $('pw-new').value;
    if (newPw !== $('pw-new2').value) { toast('两次输入的新密码不一致'); return; }
    $('pw-save-btn').disabled = true;
    Auth.changePassword($('pw-old').value, newPw).then(function () {
      $('pw-save-btn').disabled = false;
      $('modal-password').classList.add('hidden');
      toast('密码已修改 ✓');
    }).catch(function (e) {
      $('pw-save-btn').disabled = false;
      toast(e.message);
    });
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
  $('auth-username').value = '';
  $('auth-password').value = '';
  $('auth-password2').value = '';
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
  navigator.serviceWorker.register('sw.js').then(function (reg) {
    console.log('[PWA] 离线缓存就绪', reg.scope);
  }).catch(function (e) {
    console.warn('[PWA] Service Worker 注册失败：', e);
  });
}

/* ================= 启动入口 ================= */

/** 登录成功后：绑定该账户的数据空间并初始化各视图 */
function startApp(username) {
  Store.setUser(username);
  data = Store.load();
  currentYm = Store.currentYm();
  var cats = Store.getCategories();
  quickCat = cats.length ? cats[0].id : null;
  $('account-name').textContent = username;
  $('quick-date').value = Store.todayStr();
  updateMonthLabel();
  switchView('record');
  refreshBanner();
}

function boot() {
  detectStandalone();
  bindEvents();
  registerServiceWorker();
  var user = Auth.currentUser();
  if (user) {
    $('auth-screen').classList.add('hidden');
    $('app').classList.remove('hidden');
    startApp(user);
  } else {
    // 还没有任何账户时默认展示注册页
    showAuth(Auth.isEmpty() ? 'register' : 'login');
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
