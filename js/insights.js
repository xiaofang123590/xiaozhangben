/**
 * insights.js —— 智能洞察（统计页顶部「可滑动洞察卡」）
 *
 * 纯前端计算：全部数据来自 Store 的现有统计 API（getMonthSummary /
 * getMonthRecords / getBudgetStatus / getCategoryBudgetStatus），不新增存储。
 *
 * 洞察按优先级生成，最多展示 MAX_SLIDES 条：
 *   预算警报 / 分类预算告急 → 环比（本月至今 vs 上月同期）→ 结余与储蓄率
 *   → 预算预测 → 最大开销分类 → 分类变化 → 最大单笔 → 记账习惯
 * 本月还没数据时给一条引导；过去月份只做整月对比、不做预测与习惯。
 *
 * 暴露全局对象 Insights = { init, render }（普通 <script> 引入，无模块系统）。
 */
var Insights = (function () {
  'use strict';

  var MAX_SLIDES = 5;   // 最多展示条数
  var AUTO_MS = 6000;   // 自动轮播间隔

  var curIdx = 0;
  var autoTimer = 0;
  var resumeTimer = 0;
  var reduceMotion = false;
  var inited = false;

  // ==================== 小工具 ====================

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmt(n) { return Store.formatAmount(n); }

  /** '2026-10' → '2026-09' */
  function prevYmOf(ym) {
    var y = Number(ym.slice(0, 4));
    var m = Number(ym.slice(5, 7)) - 1;
    if (m === 0) { m = 12; y -= 1; }
    return y + '-' + (m < 10 ? '0' + m : String(m));
  }

  /** 该月总天数 */
  function daysInYm(ym) {
    var y = Number(ym.slice(0, 4));
    var m = Number(ym.slice(5, 7));
    return new Date(y, m, 0).getDate();
  }

  /** 'YYYY-MM-DD' → '10月3日' */
  function mdLabel(dateStr) {
    var p = String(dateStr).split('-');
    return parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日';
  }

  /**
   * 某月 1 号到 dayLimit 的支出合计；dayLimit 缺省表示整月。
   * catId 缺省表示全部支出。
   */
  function periodExpense(ym, dayLimit, catId) {
    var list = Store.getMonthRecords(ym, 'expense');
    var sum = 0;
    for (var i = 0; i < list.length; i++) {
      if (dayLimit && Number(String(list[i].date).slice(8, 10)) > dayLimit) continue;
      if (catId && list[i].categoryId !== catId) continue;
      sum += list[i].amount;
    }
    return Math.round(sum * 100) / 100;
  }

  /** 本月已记天数（去重），用于「日均」 */
  function activeDays(ym, dayLimit) {
    var list = Store.getMonthRecords(ym, 'expense');
    var seen = {};
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var d = String(list[i].date);
      if (dayLimit && Number(d.slice(8, 10)) > dayLimit) continue;
      if (!seen[d]) { seen[d] = 1; n++; }
    }
    return n;
  }

  // ==================== 洞察生成 ====================

  /**
   * 生成洞察列表（最多 MAX_SLIDES 条）
   * @param {string} ym 形如 '2026-10'
   * @returns {Array<{icon:string, title:string, desc:string, tone:string}>}
   *          tone: 'neutral' | 'good' | 'warn'
   */
  function build(ym) {
    var out = [];
    var sum = Store.getMonthSummary(ym);
    var isCur = ym === Store.currentYm();
    var today = Store.todayStr();
    var todayDay = Number(today.slice(8, 10));
    var prevYm = prevYmOf(ym);
    // 同期截止日：本月至今 → 上月取同一日（超出上月总天数则截到月末）
    var sameLimit = isCur ? Math.min(todayDay, daysInYm(prevYm)) : null;

    // 空月：只给引导
    if (!sum.count) {
      return [{
        icon: '🌱', tone: 'neutral',
        title: '本月还没有记录',
        desc: '记下第一笔，这里就会出现你的专属消费洞察。'
      }];
    }

    // ---------- 1. 总预算 ----------
    var budget = Store.getBudgetStatus(ym);
    if (budget.budget != null) {
      if (budget.level === 'over') {
        out.push({
          icon: '🚨', tone: 'warn',
          title: '本月预算已超支 ¥' + fmt(budget.spent - budget.budget),
          desc: '已用 ¥' + fmt(budget.spent) + ' / ¥' + fmt(budget.budget) +
                '（' + budget.usedPct + '%）'
        });
      } else if (isCur && todayDay >= 3) {
        var perDay = sum.expense / todayDay;
        var forecast = perDay * daysInYm(ym);
        if (forecast > budget.budget) {
          out.push({
            icon: '⏳', tone: 'warn',
            title: '按当前速度，预计超支 ¥' + fmt(forecast - budget.budget),
            desc: '日均 ¥' + fmt(perDay) + '，预计月末 ¥' + fmt(forecast) +
                  '，预算 ¥' + fmt(budget.budget)
          });
        } else {
          out.push({
            icon: '🎯', tone: 'good',
            title: '预算还剩 ¥' + fmt(budget.remaining) + '，节奏健康',
            desc: '日均 ¥' + fmt(perDay) + '，预计月末 ¥' + fmt(forecast) +
                  '，在 ¥' + fmt(budget.budget) + ' 预算内'
          });
        }
      }
    }

    // ---------- 2. 分类预算告急（只报 warn / over） ----------
    var cbStatus = Store.getCategoryBudgetStatus(ym);
    if (cbStatus.length) {
      var hot = cbStatus[0];   // 已按使用比例降序
      if (hot.level === 'over') {
        out.push({
          icon: esc(hot.icon), tone: 'warn',
          title: '「' + esc(hot.name) + '」已超分类预算 ¥' + fmt(hot.spent - hot.budget),
          desc: '已用 ¥' + fmt(hot.spent) + ' / ¥' + fmt(hot.budget) +
                '（' + hot.usedPct + '%）'
        });
      } else if (hot.level === 'warn') {
        out.push({
          icon: esc(hot.icon), tone: 'warn',
          title: '「' + esc(hot.name) + '」已用掉 ' + hot.usedPct + '% 分类预算',
          desc: '还剩 ¥' + fmt(hot.remaining) + '，本月才过 ' +
                (isCur ? todayDay : daysInYm(ym)) + ' 天'
        });
      }
    }

    // ---------- 3. 环比（同期对比） ----------
    var curExp = periodExpense(ym, isCur ? todayDay : null);
    var prevExp = periodExpense(prevYm, sameLimit);
    if (prevExp > 0 && curExp > 0) {
      var diff = curExp - prevExp;
      var pct = Math.round(Math.abs(diff) / prevExp * 100);
      if (pct >= 8) {
        var span = isCur ? '截至 ' + todayDay + ' 日' : '全月';
        if (diff > 0) {
          out.push({
            icon: '📈', tone: 'warn',
            title: '比上月同期多花 ' + pct + '%',
            desc: '多出 ¥' + fmt(diff) + '（' + span + ' ¥' + fmt(prevExp) +
                  ' → ¥' + fmt(curExp) + '）'
          });
        } else {
          out.push({
            icon: '📉', tone: 'good',
            title: '比上月同期省了 ' + pct + '%',
            desc: '少花 ¥' + fmt(-diff) + '（' + span + ' ¥' + fmt(prevExp) +
                  ' → ¥' + fmt(curExp) + '）'
          });
        }
      }
    }

    // ---------- 4. 结余与储蓄率（有收入时） ----------
    if (sum.income > 0) {
      var rate = Math.round((sum.income - sum.expense) / sum.income * 100);
      out.push({
        icon: '💰', tone: sum.balance >= 0 ? 'good' : 'warn',
        title: '本月结余 ¥' + fmt(sum.balance),
        desc: '收入 ¥' + fmt(sum.income) + ' · 支出 ¥' + fmt(sum.expense) +
              (rate >= 0 ? ' · 储蓄率 ' + rate + '%' : '')
      });
    }

    // ---------- 5. 最大开销分类 ----------
    if (sum.byCategory.length) {
      var topCat = sum.byCategory[0];
      var share = sum.expense > 0 ? Math.round(topCat.total / sum.expense * 100) : 0;
      out.push({
        icon: esc(topCat.icon), tone: 'neutral',
        title: esc(topCat.name) + '是本月最大的开销',
        desc: '¥' + fmt(topCat.total) + ' · 占本月支出的 ' + share + '%'
      });
    }

    // ---------- 6. 分类环比（变化最明显的分类） ----------
    var best = null;
    for (var i = 0; i < sum.byCategory.length; i++) {
      var c = sum.byCategory[i];
      var cur = c.total;
      var prev = periodExpense(prevYm, sameLimit, c.id);
      if (prev <= 0) continue;
      var d = cur - prev;
      if (Math.abs(d) < 50) continue;                  // 变化太小不打扰
      if (Math.abs(d) / prev < 0.3) continue;
      if (!best || Math.abs(d) > Math.abs(best.d)) {
        best = { name: c.name, icon: c.icon, cur: cur, prev: prev, d: d };
      }
    }
    if (best) {
      out.push({
        icon: esc(best.icon), tone: best.d > 0 ? 'warn' : 'good',
        title: '「' + esc(best.name) + '」比上月同期' + (best.d > 0 ? '多花' : '少花') +
               ' ¥' + fmt(Math.abs(best.d)),
        desc: '¥' + fmt(best.prev) + ' → ¥' + fmt(best.cur)
      });
    }

    // ---------- 7. 最大单笔 ----------
    var maxRec = null;
    var list = Store.getMonthRecords(ym, 'expense');
    for (var j = 0; j < list.length; j++) {
      if (!maxRec || list[j].amount > maxRec.amount) maxRec = list[j];
    }
    if (maxRec) {
      var cats = Store.getCategories('expense');
      var catName = '';
      for (var k = 0; k < cats.length; k++) if (cats[k].id === maxRec.categoryId) catName = cats[k].name;
      out.push({
        icon: '💸', tone: 'neutral',
        title: '最大一笔：¥' + fmt(maxRec.amount),
        desc: (catName ? esc(catName) + ' · ' : '') + mdLabel(maxRec.date) +
              (maxRec.note ? ' · ' + esc(maxRec.note) : '')
      });
    }

    // ---------- 8. 记账习惯 / 提醒 ----------
    if (isCur) {
      var gap = 0;
      var lastDate = null;
      for (var m = 0; m < 14; m++) {                    // 看最近 14 天哪天记过账
        var dstr = addDays(today, -m);
        if (Store.getMonthRecords(dstr.slice(0, 7)).some(function (r) { return r.date === dstr; })) {
          lastDate = dstr;
          break;
        }
        gap++;
      }
      if (gap >= 3 && lastDate) {
        out.push({
          icon: '✍️', tone: 'warn',
          title: '已经 ' + gap + ' 天没记账了',
          desc: '上次记账：' + mdLabel(lastDate) + '，别让账本断了'
        });
      } else {
        var days = activeDays(ym, todayDay);
        out.push({
          icon: '✍️', tone: 'neutral',
          title: '本月已记 ' + sum.count + ' 笔',
          desc: days > 0 ? '覆盖 ' + days + ' 天，平均每天 ¥' + fmt(sum.expense / days) : ''
        });
      }
    }

    return out.slice(0, MAX_SLIDES);
  }

  /** 'YYYY-MM-DD' 往前/后 n 天 */
  function addDays(dateStr, delta) {
    var p = String(dateStr).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + delta);
    var mm = d.getMonth() + 1;
    var dd = d.getDate();
    return d.getFullYear() + '-' + (mm < 10 ? '0' + mm : mm) + '-' + (dd < 10 ? '0' + dd : dd);
  }

  // ==================== 渲染与轮播 ====================

  function updateDots(idx) {
    var dots = document.getElementById('insight-dots');
    if (!dots) return;
    var els = dots.children;
    for (var i = 0; i < els.length; i++) els[i].classList.toggle('on', i === idx);
  }

  /** 重建洞察卡内容并回到第一条 */
  function render(ym) {
    var track = document.getElementById('insight-track');
    var dots = document.getElementById('insight-dots');
    if (!track || !dots) return;
    var slides = build(ym || Store.currentYm());
    var html = '';
    for (var i = 0; i < slides.length; i++) {
      var s = slides[i];
      html += '<div class="insight-slide tone-' + s.tone + '">' +
        '<span class="insight-icon">' + s.icon + '</span>' +
        '<div class="insight-body">' +
          '<div class="insight-title">' + s.title + '</div>' +
          (s.desc ? '<div class="insight-desc">' + s.desc + '</div>' : '') +
        '</div></div>';
    }
    track.innerHTML = html;
    var d = '';
    for (var j = 0; j < slides.length; j++) {
      d += '<span class="insight-dot' + (j === 0 ? ' on' : '') + '"></span>';
    }
    dots.innerHTML = d;
    dots.style.display = slides.length > 1 ? '' : 'none';
    track.scrollLeft = 0;
    curIdx = 0;
    restartAuto();
  }

  // ==================== 轮播 ====================

  function stopAuto() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = 0; }
  }

  function restartAuto() {
    stopAuto();
    if (reduceMotion) return;
    var track = document.getElementById('insight-track');
    if (!track || track.children.length <= 1) return;
    autoTimer = setInterval(function () {
      if (!track.offsetParent || track.clientWidth <= 0) return;   // 页面不可见时不滚
      var next = (curIdx + 1) % track.children.length;
      try {
        track.scrollTo({ left: next * track.clientWidth, behavior: 'smooth' });
      } catch (e) {
        track.scrollLeft = next * track.clientWidth;               // 老内核退化为瞬移
      }
    }, AUTO_MS);
  }

  /** 用户开始操作：暂停自动轮播，10 秒后恢复 */
  function pauseAuto() {
    stopAuto();
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(restartAuto, 10000);
  }

  /** 只绑定一次：滑动更新圆点 / 触摸暂停 / 圆点可点 */
  function init() {
    if (inited) return;
    var track = document.getElementById('insight-track');
    var dots = document.getElementById('insight-dots');
    if (!track || !dots) return;
    inited = true;
    reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    track.addEventListener('scroll', function () {
      if (track.clientWidth <= 0) return;
      var idx = Math.round(track.scrollLeft / track.clientWidth);
      if (idx !== curIdx) { curIdx = idx; updateDots(idx); }
    }, { passive: true });

    track.addEventListener('pointerdown', pauseAuto);

    dots.addEventListener('click', function (e) {
      var dot = e.target;
      if (!dot || !dot.classList || !dot.classList.contains('insight-dot')) return;
      var idx = 0;
      for (var n = dot.previousSibling; n; n = n.previousSibling) idx++;
      pauseAuto();
      try {
        track.scrollTo({ left: idx * track.clientWidth, behavior: 'smooth' });
      } catch (err) {
        track.scrollLeft = idx * track.clientWidth;
      }
      curIdx = idx;
      updateDots(idx);
    });
  }

  return { init: init, render: render };
})();
