/**
 * home-ui.js —— 首页（通知中心 + 分区入口 + 快捷动作）
 *
 * 依赖：core.js（Store）、days.js（Days）、diet.js（Diet）、alerts.js（Alerts）、
 *       icons.js（Icons）；页面跳转用 app.js 暴露的 window.goTo(view, mod)。
 * render() 由 app.js 的 switchView('home') 调起；事件绑定只在 init() 做一次。
 */
var HomeUI = (function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var WEEKS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var ALERT_LEVEL_CLS = { over: 'over', warn: 'warn', info: 'info' };

  /** 分区入口定义（sub 为实时摘要的取值函数） */
  function entries() {
    return [
      { view: 'record', mod: '', icon: 'record', name: '记账',
        sub: function () {
          return '本月支出 ¥' + Store.formatMoney(Store.getMonthSummary(Store.currentYm()).expense);
        } },
      { view: 'stats', mod: '', icon: 'stats', name: '统计',
        sub: function () {
          var s = Store.getMonthSummary(Store.currentYm());
          return '本月结余 ¥' + Store.formatMoney(s.balance);
        } },
      { view: 'budget', mod: '', icon: 'budget', name: '预算',
        sub: function () {
          var s = Store.getBudgetStatus(Store.currentYm());
          if (s.level === 'none') return '未设置预算';
          return '已用 ' + s.usedPct + '%';
        } },
      { view: 'life', mod: 'days', icon: 'life', name: '生活',
        sub: function () {
          var today = Store.todayStr();
          var evs = Days.sortEvents(Store.getDays().events, today);
          for (var i = 0; i < evs.length; i++) {
            var c = Days.eventCountdown(evs[i], today);
            if (c.today) return '今天有「' + evs[i].title + '」';
            if (!c.past) return '距「' + evs[i].title + '」' + c.n + ' 天';
          }
          var n = Store.getDays().habits.length;
          return n ? n + ' 个打卡计划' : '日子与打卡';
        } },
      { view: 'life', mod: 'diet', icon: 'food', name: '饮食',
        sub: function () {
          var s = Diet.daySummary(Store.todayStr());
          return '今日 ' + Math.round(s.kcal) + ' kcal';
        } },
      { view: 'manage', mod: '', icon: 'manage', name: '管理',
        sub: function () {
          var b = Store.getLastBackupAt();
          if (!b) return Store.getRecords().length ? '还未备份' : '账户与外观';
          var d = Math.floor((Date.now() - b) / 86400000);
          return d >= 7 ? d + ' 天未备份' : '已备份';
        } }
    ];
  }

  /** 快捷动作定义 */
  var QUICK = [
    { label: '记一笔', icon: 'notebook-pen', go: { view: 'record' }, focus: 'quick-input' },
    { label: '记一餐', icon: 'food', go: { view: 'life', mod: 'diet' }, focus: 'diet-nlp-input' },
    { label: '去打卡', icon: 'check-circle', go: { view: 'life', mod: 'days' } },
    { label: '背单词', icon: 'graduation-cap', go: { view: 'life', mod: 'vocab' } }
  ];

  /* ==================== 渲染 ==================== */

  function renderGreeting() {
    var h = new Date().getHours();
    var greet = h < 6 ? '夜深了' : h < 12 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    var d = new Date();
    $('home-greet').textContent = greet;
    $('home-date').textContent =
      (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + WEEKS[d.getDay()];
    // 农历落款（方案三 §6.4）：「农历八月廿六 · 宜记一笔」；Lunar 缺失或异常时整行隐藏
    var alm = $('home-almanac');
    if (alm) {
      var lunarTxt = '';
      try {
        if (window.Lunar) lunarTxt = Lunar.lunarText(Lunar.solarToLunar(Store.todayStr())) || '';
      } catch (e) { /* 忽略：落款是装饰性行，失败不挡首页 */ }
      if (lunarTxt) {
        alm.textContent = lunarTxt + ' · 宜记一笔';
        alm.hidden = false;
      } else {
        alm.hidden = true;
      }
    }
  }

  /** 焦点卡：优先最近的考试/纪念日倒计时；没有事件时显示本月支出 */
  function renderFocus() {
    var box = $('home-focus');
    var today = Store.todayStr();
    var evs = Days.sortEvents(Store.getDays().events, today);
    var pick = null, cc = null;
    for (var i = 0; i < evs.length; i++) {
      var c = Days.eventCountdown(evs[i], today);
      if (!c.past) { pick = evs[i]; cc = c; break; }
    }
    if (pick) {
      var rgb = /^#[0-9a-fA-F]{6}$/.exec(pick.color || '')
        ? pick.color : null;
      var style = rgb
        ? ' style="--ev-rgb:' + hexRgb(rgb) + ';--ev-color:' + esc(rgb) + '"'
        : ' style="--ev-rgb:var(--primary-rgb)"';
      var num = cc.today
        ? '<span class="dc-n">今天</span>'
        : '<span class="dc-label">' + cc.label + '</span>' +
          '<span class="dc-n">' + cc.n + '</span><span class="dc-unit">天</span>';
      box.innerHTML =
        '<div class="day-card home-focus-card' + (cc.today ? ' today' : '') + '"' + style + '>' +
          '<div class="day-card-top">' +
            '<span class="day-card-icon">' + esc(pick.icon || '📅') + '</span>' +
            '<span class="day-card-title">' + esc(pick.title) + '</span>' +
            '<span class="day-card-date">' + esc(pick.date) + '</span>' +
          '</div>' +
          '<div class="day-card-num">' + num + '</div>' +
        '</div>';
      box.classList.remove('hidden');
      return;
    }
    // 没有日子：本月支出
    var s = Store.getMonthSummary(Store.currentYm());
    box.innerHTML =
      '<div class="day-card home-focus-card" style="--ev-rgb:var(--primary-rgb)">' +
        '<div class="day-card-top">' +
          '<span class="day-card-icon">💰</span>' +
          '<span class="day-card-title">本月支出</span>' +
          '<span class="day-card-date">' + Store.currentYm().replace('-', ' 年 ') + ' 月</span>' +
        '</div>' +
        '<div class="day-card-num"><span class="dc-n dc-money">¥' +
          Store.formatMoney(s.expense) + '</span></div>' +
        '<div class="day-card-foot">' +
          '<span class="day-card-note">收入 ¥' + Store.formatMoney(s.income) +
            ' · 结余 ¥' + Store.formatMoney(s.balance) + '</span>' +
        '</div>' +
      '</div>';
    box.classList.remove('hidden');
  }

  /** '#RRGGBB' → 'R,G,B' */
  function hexRgb(hex) {
    var h = hex.slice(1);
    return parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' +
      parseInt(h.slice(4, 6), 16);
  }

  function renderAlerts() {
    var list = Alerts.collect();
    var box = $('home-alerts');
    $('home-alert-count').textContent = list.length ? list.length + ' 条' : '';
    $('home-alerts-empty').classList.toggle('hidden', list.length > 0);
    box.innerHTML = list.map(function (a) {
      var mod = a.go && a.go.mod ? ' data-mod="' + esc(a.go.mod) + '"' : '';
      return '<button type="button" class="alert-row alert-' + (ALERT_LEVEL_CLS[a.level] || 'info') +
        '" data-go="' + esc(a.go.view) + '"' + mod + '>' +
        '<span class="alert-ic">' + Icons.svg(a.icon, 'ic-sm') + '</span>' +
        '<span class="alert-text">' + esc(a.text) + '</span>' +
        '<span class="alert-arrow">' + Icons.svg('chevron-right', 'ic-sm') + '</span>' +
      '</button>';
    }).join('');
  }

  function renderEntries(alerts) {
    var box = $('home-grid');
    box.innerHTML = entries().map(function (e) {
      var n = alerts.filter(function (a) {
        return a.go.view === e.view && (!a.go.mod || a.go.mod === e.mod);
      }).length;
      return '<button type="button" class="home-entry" data-go="' + e.view + '"' +
        (e.mod ? ' data-mod="' + e.mod + '"' : '') + '>' +
        (n ? '<span class="home-entry-badge">' + n + '</span>' : '') +
        '<span class="home-entry-icon">' + Icons.svg(e.icon, 'ic-sm') + '</span>' +
        '<span class="home-entry-name">' + e.name + '</span>' +
        '<span class="home-entry-sub">' + esc(e.sub()) + '</span>' +
      '</button>';
    }).join('');
  }

  function renderQuick() {
    var box = $('home-quick');
    if (box.children.length) return;   // 静态内容只建一次
    box.innerHTML = QUICK.map(function (q, i) {
      return '<button type="button" class="home-quick-btn" data-idx="' + i + '">' +
        Icons.svg(q.icon, 'ic-sm') + '<span>' + q.label + '</span></button>';
    }).join('');
  }

  function render() {
    renderGreeting();
    renderFocus();
    var alerts = Alerts.collect();
    renderAlerts(alerts);
    renderEntries(alerts);
    renderQuick();
  }

  /* ==================== 跳转 ==================== */

  function go(view, mod) {
    if (!window.goTo) return;
    window.goTo(view, mod);
  }

  /* ==================== 初始化（只跑一次） ==================== */

  function init() {
    $('home-alerts').addEventListener('click', function (e) {
      var row = e.target.closest('.alert-row');
      if (row) go(row.getAttribute('data-go'), row.getAttribute('data-mod') || '');
    });
    $('home-grid').addEventListener('click', function (e) {
      var card = e.target.closest('.home-entry');
      if (card) go(card.getAttribute('data-go'), card.getAttribute('data-mod') || '');
    });
    $('home-quick').addEventListener('click', function (e) {
      var btn = e.target.closest('.home-quick-btn');
      if (!btn) return;
      var q = QUICK[Number(btn.getAttribute('data-idx')) || 0];
      if (!q) return;
      go(q.go.view, q.go.mod || '');
      if (q.focus) {
        setTimeout(function () {
          var el = $(q.focus);
          if (el) el.focus();
        }, 350);
      }
    });
  }

  return { init: init, render: render };
})();
