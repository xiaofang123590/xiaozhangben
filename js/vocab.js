/**
 * vocab.js —— 背单词 SRS 引擎（间隔阶梯 + 每日配额 + 会话队列 + 快速筛选）
 *
 * 依赖：core.js（Store）。数据来源 js/vocab-db.js 的全局 VOCAB_DB（数组下标即词 id）。
 * 只做计算与数据访问，不碰 DOM（界面在 vocab-ui.js）。
 *
 * SRS 规则（与 core.js 的 vocabGrade 一致）：
 *   间隔阶梯 INTERVALS[0..7] = [0,1,2,4,7,15,30,60] 天；box≥6 视为已掌握
 *   认识 → box+1；模糊 → box-1（不低于 1）；不认识 → box=1、进错词本
 */
var Vocab = (function () {
  'use strict';

  var INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60];
  var MASTERED_BOX = 6;

  var DB = (typeof VOCAB_DB !== 'undefined') ? VOCAB_DB : { cet4: [], cet6: [] };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function dayOrdinal(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    return Math.round(d.getTime() / 86400000);
  }

  function entry(deck, idx) {
    var list = DB[deck];
    return (list && list[idx]) || null;
  }

  /** 词库概况：总词数 / 未学 / 学习中 / 已掌握（known + box≥6）/ 生词本 / 错词本 */
  function deckStats(deck) {
    var v = Store.getVocab();
    var list = DB[deck] || [];
    var prog = v.progress[deck] || {};
    var known = v.known[deck] || {};
    var total = list.length;
    var learned = 0, mastered = 0;
    for (var k in prog) {
      if (Object.prototype.hasOwnProperty.call(prog, k)) {
        learned += 1;
        if (prog[k].b >= MASTERED_BOX) mastered += 1;
      }
    }
    var knownCount = 0;
    for (var k2 in known) {
      if (Object.prototype.hasOwnProperty.call(known, k2)) knownCount += 1;
    }
    var marks = 0, wrong = 0;
    for (var k3 in (v.bookmarks[deck] || {})) {
      if (Object.prototype.hasOwnProperty.call(v.bookmarks[deck], k3)) marks += 1;
    }
    for (var k4 in (v.wrong[deck] || {})) {
      if (Object.prototype.hasOwnProperty.call(v.wrong[deck], k4)) wrong += 1;
    }
    return {
      total: total,
      unlearned: total - learned - knownCount,
      learning: learned - mastered,
      mastered: mastered + knownCount,
      bookmarks: marks,
      wrong: wrong
    };
  }

  /**
   * 今日任务：到期复习（≤ reviewCap）+ 新词（≤ newPerDay，词频序）。
   * 已有今天的会话（未完成）直接续，不做重复构建。
   * @returns {{queue:number[], pos:number, dueCount:number, newCount:number,
   *            done:number, total:number, resumed:boolean}}
   */
  function buildToday() {
    var v = Store.getVocab();
    var deck = v.settings.deck;
    var today = todayStr();
    var todayOrd = dayOrdinal(today);
    var prog = v.progress[deck] || {};
    var known = v.known[deck] || {};

    // 今天的会话还在 → 续
    if (v.session && v.session.date === today && v.session.pos < v.session.queue.length) {
      var s = v.session;
      return { queue: s.queue, pos: s.pos, dueCount: 0, newCount: 0,
        done: s.pos, total: s.queue.length, resumed: true };
    }

    var due = [];
    for (var k in prog) {
      if (Object.prototype.hasOwnProperty.call(prog, k) &&
          !known[k] && prog[k].b < MASTERED_BOX && prog[k].d <= todayOrd) {
        due.push(Number(k));
      }
    }
    due.sort(function (a, b) { return prog[a].d - prog[b].d; });
    if (due.length > v.settings.reviewCap) due = due.slice(0, v.settings.reviewCap);

    var dayStat = v.stats.daily[today] || { n: 0, r: 0 };
    var newQuota = Math.max(0, v.settings.newPerDay - dayStat.n);
    var fresh = [];
    if (newQuota > 0) {
      var list = DB[deck] || [];
      for (var i = 0; i < list.length && fresh.length < newQuota; i++) {
        if (!prog[i] && !known[i]) fresh.push(i);
      }
    }

    var queue = due.concat(fresh);
    var session = { date: today, queue: queue, pos: 0 };
    if (queue.length) Store.vocabSetSession(session);
    return { queue: queue, pos: 0, dueCount: due.length, newCount: fresh.length,
      done: 0, total: queue.length, resumed: false };
  }

  /** 会话当前卡：{ idx, entry:{word,phon,zh,frq,exEn,exCn}, isNew }；null = 全部完成 */
  function currentCard() {
    var v = Store.getVocab();
    var s = v.session;
    if (!s || !s.queue || s.pos >= s.queue.length) return null;
    var deck = v.settings.deck;
    var idx = s.queue[s.pos];
    var e = entry(deck, idx);
    if (!e) {          // 词库变动导致的悬空下标：跳过
      return { idx: idx, entry: { word: '（词库外）', phon: '', zh: '', frq: 0, exEn: '', exCn: '' }, isNew: false, stale: true };
    }
    return {
      idx: idx,
      entry: { word: e[0], phon: e[1], zh: e[2], frq: e[3], exEn: e[4] || '', exCn: e[5] || '' },
      isNew: !(v.progress[deck] && v.progress[deck][String(idx)]),
      stale: false
    };
  }

  /** 评分当前卡并前进；不认识时同场重排（该词再排到队尾一次） */
  function gradeCurrent(g) {
    var v = Store.getVocab();
    var s = v.session;
    if (!s || s.pos >= s.queue.length) return null;
    var deck = v.settings.deck;
    var idx = s.queue[s.pos];
    var wasNew = !(v.progress[deck] && v.progress[deck][String(idx)]);
    Store.vocabGrade(deck, idx, g, todayStr());
    s.pos += 1;
    if (g === 0) {
      var rest = s.queue.slice(s.pos);
      if (rest.indexOf(idx) === -1) s.queue.push(idx);   // 不重复排队
    }
    Store.vocabSetSession(s);
    return { idx: idx, wasNew: wasNew, finished: s.pos >= s.queue.length };
  }

  /** 今日任务预览（不落盘）：任务卡展示用 */
  function todayPreview() {
    var v = Store.getVocab();
    var deck = v.settings.deck;
    var today = todayStr();
    var todayOrd = dayOrdinal(today);
    var prog = v.progress[deck] || {};
    var known = v.known[deck] || {};
    var due = 0;
    for (var k in prog) {
      if (Object.prototype.hasOwnProperty.call(prog, k) &&
          !known[k] && prog[k].b < MASTERED_BOX && prog[k].d <= todayOrd) {
        due += 1;
      }
    }
    var dayStat = v.stats.daily[today] || { n: 0, r: 0 };
    var newLeft = Math.max(0, v.settings.newPerDay - dayStat.n);
    var sess = (v.session && v.session.date === today) ? v.session : null;
    var resumable = !!(sess && sess.pos < sess.queue.length);
    var total = resumable ? sess.queue.length : Math.min(due, v.settings.reviewCap) + newLeft;
    return {
      due: due,
      newLeft: newLeft,
      total: total,
      done: resumable ? sess.pos : 0,
      resumable: resumable,
      deck: deck
    };
  }

  /** 今日已完成数（新 + 复习）与配额信息 */
  function todayStat() {
    var v = Store.getVocab();
    var today = todayStr();
    var day = v.stats.daily[today] || { n: 0, r: 0 };
    return {
      date: today,
      isNewToday: day.n,
      isReviewToday: day.r,
      newPerDay: v.settings.newPerDay,
      streak: v.stats.streak || 0
    };
  }

  /** 快速筛选队列：本词库中未学、未标记已掌握的全部词（词频序） */
  function triageQueue() {
    var v = Store.getVocab();
    var deck = v.settings.deck;
    var prog = v.progress[deck] || {};
    var known = v.known[deck] || {};
    var list = DB[deck] || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (!prog[i] && !known[i]) out.push(i);
    }
    return out;
  }

  /** 今日任务完成后：自动为绑定的打卡计划打卡（若存在且今天未打） */
  function autoCheckHabit() {
    var v = Store.getVocab();
    var hid = v.settings.autoCheckHabitId;
    if (!hid) return false;
    var today = todayStr();
    var habits = Store.getDays().habits;
    for (var i = 0; i < habits.length; i++) {
      if (habits[i].id === hid && !habits[i].records[today]) {
        Store.toggleHabitDay(hid, today);
        return true;
      }
    }
    return false;
  }

  /** 例句高亮：目标词（含屈折）加 <b> */
  function highlightExample(exEn, word) {
    if (!exEn) return '';
    var esc = function (s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };
    var w = String(word || '').toLowerCase();
    if (!w) return esc(exEn);
    var forms = [w];
    if (w.length > 2) {
      forms.push(w + 's', w + 'es', w + 'ed', w + 'd', w + 'ing');
      if (w.endsWith('y')) forms.push(w.slice(0, -1) + 'ies');
      if (w.endsWith('e')) forms.push(w.slice(0, -1) + 'ing');
    }
    var re = new RegExp('\\b(' + forms.map(function (f) {
      return f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('|') + ')\\b', 'i');
    var html = esc(exEn);
    var m = re.exec(html);
    if (m) {
      html = html.slice(0, m.index) + '<b>' + m[1] + '</b>' + html.slice(m.index + m[1].length);
    }
    return html;
  }

  // ==================== 测试出题引擎（阶段 4） ====================

  var POS_RE = /^(n\.|v\.|adj\.|adv\.|prep\.|conj\.|pron\.|num\.|int\.|art\.)/;

  /** 该周周一 'YYYY-MM-DD' / 该月 'YYYY-MM' */
  function weekKey(today) {
    return weekStartStr(today);
  }
  function weekStartStr(today) {
    var d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function monthKey(today) {
    return today.slice(0, 7);
  }
  /** 是否处于月末提醒窗口（最后 margin+1 天内） */
  function isMonthEnd(today, margin) {
    var d = new Date(today + 'T00:00:00');
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() >= last - margin;
  }

  function shuffleArr(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /**
   * 测试范围的候选词下标
   * @param {string} range 'today'|'week'|'month'|'all'|'bookmarks'|'wrong'
   */
  function rangeCandidates(range, today) {
    var v = Store.getVocab();
    var deck = v.settings.deck;
    var prog = v.progress[deck] || {};
    var out = [];
    var todayOrd = dayOrdinal(today);
    var weekOrd = dayOrdinal(weekStartStr(today));
    var monthOrd = dayOrdinal(today.slice(0, 8) + '01');
    function collect(obj, filter) {
      for (var k in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) {
          var idx = Number(k);
          if (!isFinite(idx) || !entry(deck, idx)) continue;
          if (!filter || filter(obj[k], idx)) out.push(idx);
        }
      }
    }
    if (range === 'today') collect(prog, function (p) { return p.t === todayOrd; });
    else if (range === 'week') collect(prog, function (p) { return isFinite(p.t) && p.t >= weekOrd; });
    else if (range === 'month') collect(prog, function (p) { return isFinite(p.t) && p.t >= monthOrd; });
    else if (range === 'all') collect(prog, function () { return true; });
    else if (range === 'bookmarks') collect(v.bookmarks[deck] || {}, function () { return true; });
    else if (range === 'wrong') collect(v.wrong[deck] || {}, function () { return true; });
    // 去重（月测 = 本月 + 错词本 的并集）
    return out.filter(function (x, i) { return out.indexOf(x) === i; });
  }

  /**
   * 生成一份测试卷：看英文选中文，四选一。
   * 干扰项优先同词性（释义首段 n./v./adj.…）、释义文本不重复。
   * @param {string|number[]} rangeOrIdxs 范围名 或 指定词下标（错题再练）
   * @param {number} size 题量
   * @returns {{deck:string, items:Array, range:string}|null} 空范围返回 null
   */
  function makeQuiz(rangeOrIdxs, size) {
    var v = Store.getVocab();
    var deck = v.settings.deck;
    var list = DB[deck] || [];
    var idxs = Array.isArray(rangeOrIdxs)
      ? rangeOrIdxs.filter(function (i) { return entry(deck, i); })
      : rangeCandidates(rangeOrIdxs, todayStr());
    if (!idxs.length) return null;
    shuffleArr(idxs);
    var n = Math.min(size || 20, idxs.length);
    // 词性池（构建一次，同词性干扰项优先）
    var posMap = {};
    for (var i = 0; i < list.length; i++) {
      var m = POS_RE.exec(list[i][2] || '');
      var pos = m ? m[1] : 'other';
      (posMap[pos] = posMap[pos] || []).push(i);
    }
    var items = [];
    for (var j = 0; j < n; j++) {
      var idx = idxs[j];
      var e = list[idx];
      var pm = POS_RE.exec(e[2] || '');
      var same = (posMap[pm ? pm[1] : 'other'] || []).slice();
      shuffleArr(same);
      var opts = [e[2]];
      for (var k = 0; k < same.length && opts.length < 4; k++) {
        var oi = same[k];
        if (oi !== idx && opts.indexOf(list[oi][2]) === -1) opts.push(list[oi][2]);
      }
      // 同词性不够：从全库补
      for (var q = 0; opts.length < 4 && q < list.length; q++) {
        if (q !== idx && opts.indexOf(list[q][2]) === -1) opts.push(list[q][2]);
      }
      // 选项乱序并记录正确位置
      var correctZh = opts[0];
      shuffleArr(opts);
      items.push({
        idx: idx,
        word: e[0],
        phon: e[1],
        zh: e[2],
        exEn: e[4] || '',
        exCn: e[5] || '',
        options: opts,
        correct: opts.indexOf(correctZh)
      });
    }
    return { deck: deck, items: items, range: Array.isArray(rangeOrIdxs) ? 'drill' : rangeOrIdxs };
  }

  /** 本周/本月测试是否已做（提醒用） */
  function testStatus(today) {
    var v = Store.getVocab();
    var day = v.stats.daily[today] || { n: 0, r: 0 };
    return {
      studiedToday: (day.n + day.r) > 0,
      dailyDone: !!v.tests.daily[today],
      weeklyDone: !!v.tests.weekly[weekStartStr(today)],
      monthlyDone: !!v.tests.monthly[monthKey(today)],
      isSunday: new Date(today + 'T00:00:00').getDay() === 0,
      monthEnd: isMonthEnd(today, 1)
    };
  }

  /** 本周/本月测试的归档键（测试结束时写入） */
  function testKey(kind, today) {
    return kind === 'daily' ? today : kind === 'weekly' ? weekStartStr(today) : monthKey(today);
  }

  /**
   * 备考联动：绑定考试后的进度预测。
   * remaining = 还没掌握的词（学习中 + 未学）；建议每日 = ceil(剩余/剩余天数)；
   * speed7 = 近 7 天新词均速；etaDays = 按该速度还需的天数。
   * @returns {Object|null} 未绑定或事件已删返回 null
   */
  function examProgress() {
    var v = Store.getVocab();
    var eid = v.settings.examEventId;
    if (!eid || !window.Days) return null;
    var evs = Store.getDays().events;
    var ev = null;
    for (var i = 0; i < evs.length; i++) {
      if (evs[i].id === eid) { ev = evs[i]; break; }
    }
    if (!ev) return null;
    var today = todayStr();
    var c = Days.eventCountdown(ev, today);
    var daysLeft = c.today ? 0 : (c.past ? -c.n : c.n);
    var st = deckStats(v.settings.deck);
    var remaining = st.unlearned + st.learning;
    var perDay = (daysLeft > 0 && remaining > 0) ? Math.ceil(remaining / daysLeft) : null;
    var speedSum = 0;
    for (var d = 0; d < 7; d++) {
      var ds = Days.addDays(today, -d);
      var day = v.stats.daily[ds];
      if (day) speedSum += day.n;
    }
    var speed = Math.round(speedSum / 7 * 10) / 10;
    var etaDays = (speed > 0 && remaining > 0) ? Math.ceil(remaining / speed) : null;
    return {
      title: ev.title,
      icon: ev.icon || '🎓',
      daysLeft: daysLeft,
      past: c.past,
      today: c.today,
      remaining: remaining,
      perDay: perDay,
      speed: speed,
      etaDays: etaDays
    };
  }

  return {
    todayStr: todayStr,
    dayOrdinal: dayOrdinal,
    entry: entry,
    deckStats: deckStats,
    buildToday: buildToday,
    todayPreview: todayPreview,
    currentCard: currentCard,
    gradeCurrent: gradeCurrent,
    todayStat: todayStat,
    triageQueue: triageQueue,
    autoCheckHabit: autoCheckHabit,
    highlightExample: highlightExample,
    weekKey: weekKey,
    monthKey: monthKey,
    isMonthEnd: isMonthEnd,
    makeQuiz: makeQuiz,
    rangeCandidates: rangeCandidates,
    testStatus: testStatus,
    testKey: testKey,
    examProgress: examProgress,
    INTERVALS: INTERVALS,
    MASTERED_BOX: MASTERED_BOX
  };
})();
