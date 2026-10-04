/**
 * days.js —— 生活模块 · 日子（纪念日/倒计时）与打卡计划的算法层
 *
 * 依赖：core.js（Store）。只做计算与数据访问，不碰 DOM（界面在 days-ui.js）。
 * 全部日期使用本地时区的 'YYYY-MM-DD' 字符串（与 core.js 约定一致）。
 */
var Days = (function () {
  'use strict';

  // ==================== 日期工具 ====================

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** 'YYYY-MM-DD' → 本地时区 Date；非法返回 null */
  function toDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function toStr(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function addDays(dateStr, delta) {
    var d = toDate(dateStr);
    if (!d) return dateStr;
    d.setDate(d.getDate() + delta);
    return toStr(d);
  }

  /** 天数差 to - from（取整以吸收夏令时 / UTC 偏移误差）；非法输入返回 null */
  function diffDays(from, to) {
    var a = toDate(from);
    var b = toDate(to);
    if (!a || !b) return null;
    return Math.round((b - a) / 86400000);
  }

  // ==================== 事件的下一次发生日 ====================

  /** 某年的「周年候选日」；2 月 29 日在平年落回 2 月 28 日 */
  function yearlyCandidate(base, year) {
    var month = base.getMonth();
    var day = base.getDate();
    if (month === 1 && day === 29) {
      var febLast = new Date(year, 2, 0).getDate();   // 该年 2 月最后一天
      if (febLast !== 29) day = 28;
    }
    return toStr(new Date(year, month, day));
  }

  /** 某月的「月候选日」；29~31 日在小月钳到月末 */
  function monthlyCandidate(base, year, month) {
    var last = new Date(year, month + 1, 0).getDate();
    return toStr(new Date(year, month, Math.min(base.getDate(), last)));
  }

  /**
   * 下一次发生日（≥ today，单次事件除外）：
   *   repeat 'none'    → 原日期本身（可能已过去，用于「已过 X 天」）
   *   repeat 'yearly'  → 今年（已过则明年）的周年日
   *   repeat 'monthly' → 本月（已过则下月）的同一天
   * countup（正数）事件的展示基准永远是原日期；但 repeat 非 none 时
   * 它的「周年提醒」同样按下一次发生日算（如「在一起」每年今天提醒）。
   * @param {{date:string, repeat:string}} ev
   * @param {string} today 'YYYY-MM-DD'
   * @returns {string} 'YYYY-MM-DD'
   */
  function nextOccurrence(ev, today) {
    var base = toDate(ev && ev.date);
    var t = toDate(today);
    if (!base || !t) return (ev && ev.date) || today;
    if (ev.repeat === 'yearly') {
      if (ev.calendar === 'lunar' && ev.lunar && window.Lunar) {
        return nextLunarYearly(ev.lunar, t);
      }
      var y = t.getFullYear();
      var cand = yearlyCandidate(base, y);
      if (cand < today) cand = yearlyCandidate(base, y + 1);
      return cand;
    }
    if (ev.repeat === 'monthly') {
      var m = monthlyCandidate(base, t.getFullYear(), t.getMonth());
      if (m < today) {
        var nm = t.getMonth() + 1;
        var ny = t.getFullYear();
        if (nm > 11) { nm = 0; ny += 1; }
        m = monthlyCandidate(base, ny, nm);
      }
      return m;
    }
    return ev.date;
  }

  /**
   * 农历周年的下一次发生日：依次尝试今明两个农历年（农历 y 年横跨公历
   * y ~ y+1），取第一个 ≥ today 的公历日期；闰月目标在该年无闰月时
   * 由 Lunar 按平月换算，"三十"在小月自动钳到廿九。
   */
  function nextLunarYearly(lunar, today) {
    var y = today.getFullYear();
    var first = Lunar.lunarToSolar(y, lunar.m, lunar.d, !!lunar.leap);
    if (first >= toStr(today)) return first;
    return Lunar.lunarToSolar(y + 1, lunar.m, lunar.d, !!lunar.leap);
  }

  /**
   * 卡片的展示数据
   * @returns {{n:number, label:string, past:boolean, today:boolean}}
   *   countdown：n = 还有 n 天（0 = 就是今天）；单次事件已过 → past: true，n = 已过天数
   *   countup  ：n = 已经 n 天（0 = 今天开始）
   */
  function eventCountdown(ev, today) {
    if (ev.mode === 'countup') {
      var up = diffDays(ev.date, today);
      if (up === null) up = 0;
      // 周年当天（每年/每月重复）也算 today：高亮卡片、排序提前
      var isToday = up === 0;
      if (!isToday && ev.repeat && ev.repeat !== 'none') {
        isToday = nextOccurrence(ev, today) === today;
      }
      return { n: Math.max(0, up), label: '已经', past: false, today: isToday };
    }
    var occ = nextOccurrence(ev, today);
    var m = diffDays(today, occ);
    if (m === null) m = 0;
    if (m >= 0) {
      return { n: m, label: '还有', past: false, today: m === 0 };
    }
    return { n: -m, label: '已过', past: true, today: false };
  }

  /**
   * 卡片排序：置顶 > 今天 > 未到期（临近在前）> 已过（刚过在前）
   * @param {Array} events
   * @param {string} today
   * @returns {Array} 新数组（不改原数组）
   */
  function sortEvents(events, today) {
    var arr = events.slice();
    arr.sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return a.pinned ? -1 : 1;
      var ca = eventCountdown(a, today);
      var cb = eventCountdown(b, today);
      if (ca.today !== cb.today) return ca.today ? -1 : 1;
      var aFuture = !ca.past;
      var bFuture = !cb.past;
      if (aFuture !== bFuture) return aFuture ? -1 : 1;
      return ca.n - cb.n;
    });
    return arr;
  }

  // ==================== 打卡计划 ====================

  /** 是否每周 N 次型计划 */
  function isWeekly(h) {
    return !!(h && h.freq && typeof h.freq === 'object' && h.freq.type === 'weekly');
  }

  /** 含 today 的那一周的周一 'YYYY-MM-DD'（周一为一周之始） */
  function weekStart(today) {
    var d = toDate(today);
    if (!d) return today;
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return toStr(d);
  }

  /** 某一周（周一起 7 天）内的打卡次数 */
  function weekCount(h, ws) {
    var n = 0;
    for (var i = 0; i < 7; i++) {
      if (h.records[addDays(ws, i)]) n += 1;
    }
    return n;
  }

  /** 本周打卡进度 {done, times}（daily 计划 times=7/7 无意义，调用方自行判断） */
  function habitWeekProgress(h, today) {
    if (!isWeekly(h)) return null;
    return { done: weekCount(h, weekStart(today)), times: h.freq.times };
  }

  /**
   * 连续打卡：daily = 连续天数（今天没打不打断，从昨天回溯）；
   * weekly = 连续达标周数（本周已达标计入，未达标不打断、从上周回溯）
   */
  function habitStreak(h, today) {
    if (isWeekly(h)) {
      var n = 0;
      var ws = weekStart(today);
      if (weekCount(h, ws) >= h.freq.times) n += 1;
      ws = addDays(ws, -7);
      while (weekCount(h, ws) >= h.freq.times) {
        n += 1;
        ws = addDays(ws, -7);
      }
      return n;
    }
    var cur = h.records[today] ? today : addDays(today, -1);
    var m = 0;
    while (h.records[cur]) {
      m += 1;
      cur = addDays(cur, -1);
    }
    return m;
  }

  /** 最近 7 天打卡布尔数组：[6 天前 … 今天]，供行内圆点展示 */
  function habitLast7(h, today) {
    var out = [];
    for (var i = -6; i <= 0; i++) {
      out.push(!!h.records[addDays(today, i)]);
    }
    return out;
  }

  // ==================== 提醒（打开 App 时检查，无后台推送） ====================

  /** 今天是「正日子」的事件（含每年 / 每月的周年当天），按卡片顺序返回 */
  function todayEvents(today) {
    var days = Store.getDays();
    return sortEvents(days.events.filter(function (ev) {
      return nextOccurrence(ev, today) === today;
    }), today);
  }

  /**
   * 落在提前提醒窗口内的事件
   * @returns {Array<{ev:Object, inDays:number}>} inDays = 距发生日还有几天（>0）
   */
  function upcomingReminders(today) {
    var days = Store.getDays();
    var out = [];
    days.events.forEach(function (ev) {
      if (!Array.isArray(ev.remindDays) || !ev.remindDays.length) return;
      var occ = nextOccurrence(ev, today);
      var d = diffDays(today, occ);
      if (d !== null && d > 0 && ev.remindDays.indexOf(d) !== -1) {
        out.push({ ev: ev, inDays: d });
      }
    });
    out.sort(function (a, b) { return a.inDays - b.inDays; });
    return out;
  }

  /** 今天还没完成的计划（未归档）：daily 看当天、weekly 看本周配额 */
  function uncheckedHabits(today) {
    return Store.getDays().habits.filter(function (h) {
      if (h.archived) return false;
      if (isWeekly(h)) return weekCount(h, weekStart(today)) < h.freq.times;
      return !h.records[today];
    });
  }

  // ==================== 导出 ====================

  return {
    nextOccurrence: nextOccurrence,
    eventCountdown: eventCountdown,
    sortEvents: sortEvents,
    isWeekly: isWeekly,
    habitWeekProgress: habitWeekProgress,
    habitStreak: habitStreak,
    habitLast7: habitLast7,
    todayEvents: todayEvents,
    upcomingReminders: upcomingReminders,
    uncheckedHabits: uncheckedHabits,
    addDays: addDays,
    diffDays: diffDays
  };
})();
