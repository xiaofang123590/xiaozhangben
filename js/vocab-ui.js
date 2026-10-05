/**
 * vocab-ui.js —— 背单词界面（今日任务 + 学习会话 + 快速筛选 + 设置）
 *
 * 依赖：core.js（Store）、vocab.js（Vocab）、days.js（Days）、icons.js（Icons）。
 * 结构：#vocab-main 常态内容；#vocab-study 学习/筛选会话（全屏接管，隐藏分段器）。
 * 事件绑定只在 init() 做一次；render() 由 LifeUI 在背单词分段被调起。
 */
var VocabUI = (function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var mode = null;          // null | 'study' | 'triage' | 'test-setup' | 'test' | 'test-result'
  var revealed = false;     // 学习卡是否已翻开
  var triage = null;        // { queue:[idx], pos, total }
  var studyTask = null;     // buildToday() 返回的任务信息
  var toastTimer = 0;
  var testRange = 'today';  // 测试设置页当前范围
  var testSize = 20;        // 测试设置页当前题量
  var test = null;          // { items,pos,correct,wrong,start,kind,key,locked }

  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 1800);
  }

  /** 进度环 SVG：done/total */
  function ringHTML(done, total, label) {
    var R = 52, C = 2 * Math.PI * R;
    var pct = total > 0 ? Math.min(1, done / total) : (total === 0 ? 1 : 0);
    return '<svg class="vocab-ring" viewBox="0 0 128 128" aria-hidden="true">' +
      '<circle class="vr-bg" cx="64" cy="64" r="' + R + '" />' +
      '<circle class="vr-fg" cx="64" cy="64" r="' + R + '" style="stroke-dasharray:' +
        (C * pct).toFixed(1) + ' ' + C.toFixed(1) + '" />' +
      '<text x="64" y="60" class="vr-num">' + done + '</text>' +
      '<text x="64" y="82" class="vr-sub">' + esc(label || ('/' + total)) + '</text>' +
    '</svg>';
  }

  /* ==================== 常态：今日任务 + 统计 + 设置 ==================== */

  function render() {
    if (mode === 'study' || mode === 'triage' || mode === 'test-setup' ||
        mode === 'test' || mode === 'test-result') {
      return;                        // 会话/测试接管中不被重绘打断
    }
    renderMain();
  }

  function renderMain() {
    var box = $('vocab-main');
    var study = $('vocab-study');
    if (study) study.classList.add('hidden');
    if (!box) return;
    var v = Store.getVocab();
    var deck = v.settings.deck;
    var st = Vocab.deckStats(deck);
    var prev = Vocab.todayPreview();
    var ts = Vocab.todayStat();

    var deckName = deck === 'cet6' ? '六级' : '四级';
    var deckSizes = (window.VOCAB_DB && VOCAB_DB[deck]) ? VOCAB_DB[deck].length : 0;

    // 备考联动：绑定考试 → 倒计时 + 剩余词 + 建议每日 + 速度预测
    var examHTML = '';
    if (v.settings.examEventId && window.Days) {
      var ep = Vocab.examProgress();
      if (ep) {
        var dayTxt = ep.today ? '就是今天' : (ep.past ? '已过 ' + ep.daysLeft : '还有 ' + ep.daysLeft + ' 天');
        var lines = '<span class="vocab-exam">' + esc(ep.icon) + ' 距「' + esc(ep.title) + '」' + dayTxt + '</span>' +
          '<div class="vocab-task-line">剩余 <b>' + ep.remaining + '</b> 词' +
          (ep.perDay ? ' · 建议每日 <b>' + ep.perDay + '</b> 词' : '') + '</div>';
        if (ep.etaDays !== null && !ep.past && !ep.today) {
          lines += ep.etaDays <= ep.daysLeft
            ? '<div class="vocab-task-line vocab-eta-ok">近 7 天均速 ' + ep.speed + ' 词/天 · 按当前速度考前可完成 ✓</div>'
            : '<div class="vocab-task-line vocab-eta-bad">近 7 天均速 ' + ep.speed + ' 词/天 · 按当前速度考前还差约 ' +
              Math.max(1, ep.remaining - Math.floor(ep.speed * ep.daysLeft)) + ' 词</div>';
        } else if (ep.speed === 0 && ep.remaining > 0 && !ep.past) {
          lines += '<div class="vocab-task-line">近 7 天还没学新词，今天开始吧</div>';
        }
        examHTML = lines;
      }
    }

    var taskBtn = '<button type="button" class="btn-primary vocab-start" data-act="start">' +
      (prev.resumable ? '继续学习' : '开始学习') + '</button>';
    if (prev.total === 0) {
      taskBtn = '<span class="vocab-done-tip">今日任务已完成 ✓ 明天继续</span>';
    }

    box.innerHTML =
      '<div class="card vocab-task-card">' +
        '<div class="card-head"><h3 class="card-title">今日任务 · ' + deckName + '</h3>' +
          '<span class="vocab-deck-count">' + deckSizes + ' 词</span></div>' +
        '<div class="vocab-task-body">' +
          ringHTML(prev.done, prev.total, '/' + prev.total) +
          '<div class="vocab-task-info">' +
            examHTML +
            '<div class="vocab-task-line">待复习 <b>' + Math.min(prev.due, v.settings.reviewCap) + '</b> · ' +
              '新词还剩 <b>' + prev.newLeft + '</b></div>' +
            '<div class="vocab-task-line">今日已学 新 <b>' + ts.isNewToday + '</b> / 复习 <b>' + ts.isReviewToday + '</b>' +
              '<span class="habit-streak' + (ts.streak > 0 ? '' : ' zero') + '">' +
              Icons.svg('flame', 'ic-sm') + ts.streak + ' 天</span></div>' +
            '<div class="vocab-task-btn">' + taskBtn + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="vocab-quick-row">' +
          '<button type="button" class="btn-secondary btn-sm" data-act="triage">' +
            Icons.svg('check-circle', 'ic-sm') + '快速筛选</button>' +
          '<button type="button" class="btn-secondary btn-sm" data-act="test">' +
            Icons.svg('edit', 'ic-sm') + '测试</button>' +
          '<button type="button" class="btn-secondary btn-sm" data-act="toggle-settings">' +
            Icons.svg('budget', 'ic-sm') + '学习设置</button>' +
        '</div>' +
      '</div>' +

      '<div class="card vocab-settings hidden" id="vocab-settings">' +
        '<div class="card-head"><h3 class="card-title">学习设置</h3></div>' +
        '<div class="form-row"><label class="form-label">词库</label>' +
          '<div class="type-toggle" id="vocab-deck-toggle">' +
            '<button type="button" class="type-btn' + (deck === 'cet4' ? ' active' : '') + '" data-deck="cet4">四级 ' +
              ((window.VOCAB_DB && VOCAB_DB.cet4) ? VOCAB_DB.cet4.length : 0) + ' 词</button>' +
            '<button type="button" class="type-btn' + (deck === 'cet6' ? ' active' : '') + '" data-deck="cet6">六级 ' +
              ((window.VOCAB_DB && VOCAB_DB.cet6) ? VOCAB_DB.cet6.length : 0) + ' 词</button>' +
          '</div></div>' +
        '<div class="form-row vocab-two-col">' +
          '<div><label class="form-label">每日新词</label>' +
            '<input id="vocab-new-input" type="number" inputmode="numeric" min="10" max="100" step="10" value="' +
              v.settings.newPerDay + '"></div>' +
          '<div><label class="form-label">复习上限</label>' +
            '<input id="vocab-cap-input" type="number" inputmode="numeric" min="0" max="500" step="10" value="' +
              v.settings.reviewCap + '"></div>' +
        '</div>' +
        '<div class="form-row"><label class="form-label">每日自检题量</label>' +
          '<div class="chip-row" id="vocab-checksize-chips">' +
            [10, 20, 30, 50].map(function (n) {
              return '<button type="button" class="chip' + (v.settings.checkSize === n ? ' active' : '') +
                '" data-checksize="' + n + '">' + n + ' 题</button>';
            }).join('') +
          '</div></div>' +
        '<div class="form-row"><label class="form-label">备考目标（显示倒计时）</label>' +
          '<select id="vocab-exam-select"><option value="">不绑定</option></select></div>' +
        '<div class="form-row"><label class="form-label">完成自动打卡</label>' +
          '<select id="vocab-habit-select"><option value="">不自动打卡</option></select></div>' +
        '<p class="hint">每日新词默认 50；吃不消就调低，比积压更好。设置按账户保存。</p>' +
      '</div>' +

      '<div class="card vocab-stats-card">' +
        '<div class="card-head"><h3 class="card-title">掌握情况</h3></div>' +
        '<div class="vocab-stat-grid">' +
          statCell('未学', st.unlearned) + statCell('学习中', st.learning) +
          statCell('已掌握', st.mastered) + statCell('生词本', st.bookmarks) +
          statCell('错词本', st.wrong) +
        '</div>' +
        historyHTML() +
        '<p class="hint">「已掌握」= 复习周期到 30 天以上的词 + 快速筛选标记的词。</p>' +
      '</div>';

    fillSelects(v);
  }

  /** 测试成绩历史：最近 8 次（自检/周测/月测）正确率条 */
  function historyHTML() {
    var v = Store.getVocab();
    var rows = [];
    var kinds = [['daily', '自检'], ['weekly', '周测'], ['monthly', '月测']];
    kinds.forEach(function (kv) {
      var map = v.tests[kv[0]] || {};
      for (var key in map) {
        if (Object.prototype.hasOwnProperty.call(map, key)) {
          rows.push({ kind: kv[1], key: key, at: map[key].at || 0,
            total: map[key].total || 0, correct: map[key].correct || 0 });
        }
      }
    });
    if (!rows.length) return '';
    rows.sort(function (a, b) { return b.at - a.at; });
    var html = '<div class="vocab-history">' +
      '<div class="accent-label">测试成绩 · 最近 ' + Math.min(8, rows.length) + ' 次</div>';
    rows.slice(0, 8).forEach(function (r) {
      var pct = r.total ? Math.round(r.correct / r.total * 100) : 0;
      var label = r.key.replace(/^\d{4}-/, '');
      html += '<div class="vh-row">' +
        '<span class="vh-kind">' + r.kind + '</span>' +
        '<span class="vh-key">' + esc(label) + '</span>' +
        '<span class="vh-bar"><i style="width:' + pct + '%"></i></span>' +
        '<span class="vh-pct' + (pct >= 80 ? ' good' : (pct < 60 ? ' bad' : '')) + '">' + pct + '%</span>' +
      '</div>';
    });
    html += '</div>';
    return html;
  }

  function statCell(label, n) {
    return '<div class="vocab-stat-cell"><b>' + n + '</b><span>' + label + '</span></div>';
  }

  /** 备考目标 / 自动打卡两个下拉的选项 */
  function fillSelects(v) {
    var examSel = $('vocab-exam-select');
    if (examSel) {
      var evs = Store.getDays().events;
      for (var i = 0; i < evs.length; i++) {
        var opt = document.createElement('option');
        opt.value = evs[i].id;
        opt.textContent = evs[i].title + '（' + evs[i].date + '）';
        if (evs[i].id === v.settings.examEventId) opt.selected = true;
        examSel.appendChild(opt);
      }
    }
    var habitSel = $('vocab-habit-select');
    if (habitSel) {
      var habits = Store.getDays().habits;
      for (var j = 0; j < habits.length; j++) {
        var opt2 = document.createElement('option');
        opt2.value = habits[j].id;
        opt2.textContent = habits[j].title;
        if (habits[j].id === v.settings.autoCheckHabitId) opt2.selected = true;
        habitSel.appendChild(opt2);
      }
    }
  }

  /* ==================== 学习会话 ==================== */

  function startStudy() {
    studyTask = Vocab.buildToday();
    if (!studyTask.total) { toast('今天没有待学的词'); return; }
    mode = 'study';
    revealed = false;
    renderStudy();
  }

  function startTriage() {
    var queue = Vocab.triageQueue();
    if (!queue.length) { toast('没有可筛选的新词了'); return; }
    mode = 'triage';
    triage = { queue: queue, pos: 0, total: queue.length };
    renderTriage();
  }

  function exitSession() {
    mode = null;
    revealed = false;
    triage = null;
    test = null;
    var study = $('vocab-study');
    if (study) study.classList.add('hidden');
    var seg = document.querySelector('#view-life .life-seg');
    if (seg) seg.classList.remove('hidden');
    $('vocab-main').classList.remove('hidden');
    renderMain();
  }

  /** 会话接管：隐藏分段器与常态内容，只留会话卡与退出 */
  function takeOver() {
    var study = $('vocab-study');
    study.classList.remove('hidden');
    var seg = document.querySelector('#view-life .life-seg');
    if (seg) seg.classList.add('hidden');
    $('vocab-main').classList.add('hidden');
  }

  function renderStudy() {
    takeOver();
    var card = Vocab.currentCard();
    var v = Store.getVocab();
    if (!card) { renderFinish(); return; }
    var study = $('vocab-study');
    var pos = v.session ? v.session.pos : 0;
    var total = v.session ? v.session.queue.length : 0;

    study.innerHTML =
      '<div class="card vocab-session-card">' +
        '<div class="vocab-session-top">' +
          '<button type="button" class="vocab-exit" data-act="exit">' + Icons.svg('close', 'ic-sm') + '退出</button>' +
          '<span class="vocab-progress">' + (pos + 1) + ' / ' + total + '</span>' +
          '<button type="button" class="vocab-speak" data-act="speak">' + Icons.svg('bell', 'ic-sm') + '</button>' +
        '</div>' +
        '<div class="vocab-word-card" data-act="reveal">' +
          '<div class="vw-word">' + esc(card.entry.word) + '</div>' +
          (card.entry.phon ? '<div class="vw-phon">' + esc(card.entry.phon) + '</div>' : '') +
          (revealed ? revealHTML(card.entry) : '<div class="vw-tap">点卡片或按空格看释义</div>') +
        '</div>' +
        (revealed ? gradeRow() : '') +
        '<p class="hint vocab-keys">左滑 认识 · 上滑 看释义 · 左下 不认识 · 键盘 空格 / 1 / 2 / 3</p>' +
      '</div>';
  }

  function revealHTML(e) {
    var ex = '';
    if (e.exEn) {
      ex = '<div class="vw-ex"><p class="vw-ex-en">' + Vocab.highlightExample(e.exEn, e.word) + '</p>' +
        (e.exCn ? '<p class="vw-ex-cn">' + esc(e.exCn) + '</p>' : '') + '</div>';
    }
    return '<div class="vw-zh">' + esc(e.zh) + '</div>' + ex +
      '<button type="button" class="vw-bookmark" data-act="bookmark">' +
        Icons.svg('star', 'ic-sm') + '生词本</button>';
  }

  function gradeRow() {
    return '<div class="vocab-grade-row">' +
      '<button type="button" class="grade-btn g0" data-grade="0">不认识</button>' +
      '<button type="button" class="grade-btn g1" data-grade="1">模糊</button>' +
      '<button type="button" class="grade-btn g2" data-grade="2">认识</button>' +
    '</div>';
  }

  function renderFinish() {
    // 今日任务完成：清会话 + 自动打卡
    Store.vocabSetSession(null);
    var ts = Vocab.todayStat();
    var auto = Vocab.autoCheckHabit();
    var study = $('vocab-study');
    study.innerHTML =
      '<div class="card vocab-session-card">' +
        '<div class="vocab-session-top">' +
          '<button type="button" class="vocab-exit" data-act="exit">' + Icons.svg('close', 'ic-sm') + '退出</button>' +
        '</div>' +
        '<div class="vocab-finish">' +
          '<span class="empty-art"><svg class="ic"><use href="#i-check-circle"></use></svg></span>' +
          '<p class="empty-title">今日任务完成 ✓</p>' +
          '<p class="vocab-finish-sub">新学 ' + ts.isNewToday + ' 词 · 复习 ' + ts.isReviewToday +
            ' 词 · 连续 ' + ts.streak + ' 天</p>' +
          (auto ? '<p class="hint">已自动为打卡计划打上今天的卡 ✓</p>' : '') +
          '<button type="button" class="btn-primary" data-act="exit">返回</button>' +
        '</div>' +
      '</div>';
  }

  /* ==================== 快速筛选 ==================== */

  function renderTriage() {
    takeOver();
    var v = Store.getVocab();
    var deck = v.settings.deck;
    var study = $('vocab-study');
    if (triage.pos >= triage.queue.length) {
      var marked = triage.total - triage.queue.length + triage.pos;
      study.innerHTML =
        '<div class="card vocab-session-card">' +
          '<div class="vocab-session-top">' +
            '<button type="button" class="vocab-exit" data-act="exit">' + Icons.svg('close', 'ic-sm') + '退出</button>' +
          '</div>' +
          '<div class="vocab-finish">' +
            '<span class="empty-art"><svg class="ic"><use href="#i-check-circle"></use></svg></span>' +
            '<p class="empty-title">筛选完成 ✓</p>' +
            '<p class="vocab-finish-sub">本轮标记已掌握 ' + triage.markedCount + ' 词，其余进入每日新词队列</p>' +
            '<button type="button" class="btn-primary" data-act="exit">返回</button>' +
          '</div>' +
        '</div>';
      return;
    }
    var idx = triage.queue[triage.pos];
    var e = Vocab.entry(deck, idx) || ['', '', ''];
    study.innerHTML =
      '<div class="card vocab-session-card">' +
        '<div class="vocab-session-top">' +
          '<button type="button" class="vocab-exit" data-act="exit">' + Icons.svg('close', 'ic-sm') + '退出</button>' +
          '<span class="vocab-progress">剩余 ' + (triage.queue.length - triage.pos) + ' / ' + triage.total + '</span>' +
          '<button type="button" class="vocab-speak" data-act="speak-triage">' + Icons.svg('bell', 'ic-sm') + '</button>' +
        '</div>' +
        '<div class="vocab-word-card">' +
          '<div class="vw-word">' + esc(e[0]) + '</div>' +
          (e[1] ? '<div class="vw-phon">' + esc(e[1]) + '</div>' : '') +
          '<div class="vw-zh">' + esc(e[2]) + '</div>' +
          (e[4] ? '<div class="vw-ex"><p class="vw-ex-en">' + Vocab.highlightExample(e[4], e[0]) + '</p>' +
            (e[5] ? '<p class="vw-ex-cn">' + esc(e[5]) + '</p>' : '') + '</div>' : '') +
        '</div>' +
        '<div class="vocab-grade-row">' +
          '<button type="button" class="grade-btn g0" data-triage="0">还不认识</button>' +
          '<button type="button" class="grade-btn g2" data-triage="1">已掌握</button>' +
        '</div>' +
        '<p class="hint vocab-keys">认识的直接标记，不会进入学习队列；不认识的留在这里每天学</p>' +
      '</div>';
  }

  function triageNext(markKnown) {
    var deck = Store.getVocab().settings.deck;
    var idx = triage.queue[triage.pos];
    if (markKnown) {
      Store.vocabSetKnown(deck, idx, true);
      triage.markedCount = (triage.markedCount || 0) + 1;
    }
    triage.pos += 1;
    renderTriage();
  }

  /* ==================== 测试（看英文选中文，四选一） ==================== */

  var RANGES = [['today', '今日'], ['week', '本周'], ['month', '本月'],
    ['all', '全部已学'], ['bookmarks', '生词本'], ['wrong', '错词本']];
  var SIZES = [10, 20, 30, 50];

  function startTestSetup() {
    mode = 'test-setup';
    testSize = Store.getVocab().settings.checkSize || 20;
    renderTestSetup();
  }

  function renderTestSetup() {
    takeOver();
    var study = $('vocab-study');
    var chips = RANGES.map(function (r) {
      var n = Vocab.rangeCandidates(r[0], Vocab.todayStr()).length;
      return '<button type="button" class="chip' + (testRange === r[0] ? ' active' : '') +
        '" data-range="' + r[0] + '">' + r[1] + ' <i>' + n + '</i></button>';
    }).join('');
    var sizes = SIZES.map(function (n) {
      return '<button type="button" class="chip' + (testSize === n ? ' active' : '') +
        '" data-size="' + n + '">' + n + ' 题</button>';
    }).join('');
    var sel = Vocab.rangeCandidates(testRange, Vocab.todayStr()).length;
    study.innerHTML =
      '<div class="card vocab-session-card">' +
        '<div class="vocab-session-top">' +
          '<button type="button" class="vocab-exit" data-act="exit">' + Icons.svg('close', 'ic-sm') + '退出</button>' +
        '</div>' +
        '<h3 class="vocab-sec-title">测试 · 看英文选中文</h3>' +
        '<div class="form-row"><label class="form-label">范围</label>' +
          '<div class="chip-row" id="test-range-chips">' + chips + '</div></div>' +
        '<div class="form-row"><label class="form-label">题量</label>' +
          '<div class="chip-row" id="test-size-chips">' + sizes + '</div></div>' +
        '<button type="button" class="btn-primary vocab-start" data-act="test-begin"' +
          (sel ? '' : ' disabled') + '>' +
          (sel ? '开始测试（' + Math.min(sel, testSize) + ' 题）' : '这个范围还没有可测的词') + '</button>' +
        '<p class="hint">答错会标出正确答案并回炉：该词进错词本、复习排到明天。</p>' +
      '</div>';
  }

  function startTest(range, size) {
    var quiz = Vocab.makeQuiz(range, size);
    if (!quiz || !quiz.items.length) { toast('这个范围还没有可测的词'); return; }
    var today = Vocab.todayStr();
    var kind = range === 'today' ? 'daily' : range === 'week' ? 'weekly' : range === 'month' ? 'monthly' : null;
    test = {
      items: quiz.items, deck: quiz.deck, pos: 0, correct: 0, wrong: [],
      start: Date.now(), kind: kind, key: kind ? Vocab.testKey(kind, today) : null,
      locked: false
    };
    mode = 'test';
    renderTest();
  }

  function renderTest() {
    takeOver();
    var item = test.items[test.pos];
    var study = $('vocab-study');
    var secs = Math.round((Date.now() - test.start) / 1000);
    study.innerHTML =
      '<div class="card vocab-session-card">' +
        '<div class="vocab-session-top">' +
          '<button type="button" class="vocab-exit" data-act="exit">' + Icons.svg('close', 'ic-sm') + '退出</button>' +
          '<span class="vocab-progress">第 ' + (test.pos + 1) + ' / ' + test.items.length + ' 题 · ' +
            Math.floor(secs / 60) + ':' + ('0' + secs % 60).slice(-2) + '</span>' +
          '<button type="button" class="vocab-speak" data-act="speak-test">' + Icons.svg('bell', 'ic-sm') + '</button>' +
        '</div>' +
        '<div class="vocab-word-card vocab-quiz-card">' +
          '<div class="vw-word">' + esc(item.word) + '</div>' +
          (item.phon ? '<div class="vw-phon">' + esc(item.phon) + '</div>' : '') +
        '</div>' +
        '<div class="vocab-options" id="test-options">' +
          item.options.map(function (zh, i) {
            return '<button type="button" class="vocab-opt" data-opt="' + i + '">' +
              '<span class="vo-mark">' + 'ABCD'[i] + '</span>' + esc(zh) + '</button>';
          }).join('') +
        '</div>' +
        (test.locked ? '<button type="button" class="btn-primary vocab-next" data-act="test-next">下一题</button>' : '') +
      '</div>';
  }

  function answerTest(optIdx) {
    if (test.locked) return;
    var item = test.items[test.pos];
    var hit = optIdx === item.correct;
    test.locked = true;
    var opts = document.querySelectorAll('#test-options .vocab-opt');
    for (var i = 0; i < opts.length; i++) {
      var oi = Number(opts[i].getAttribute('data-opt'));
      if (oi === item.correct) opts[i].classList.add('right');
      else if (oi === optIdx) opts[i].classList.add('wrong-pick');
      opts[i].disabled = true;
    }
    if (hit) {
      test.correct += 1;
      setTimeout(function () { nextTestItem(); }, 600);   // 答对 0.6 秒自动下一题
    } else {
      test.wrong.push(item.idx);
      // 答错：把释义与例句再显示一遍，并给出「下一题」按钮
      var card = document.querySelector('.vocab-quiz-card');
      var ex = item.exEn
        ? '<div class="vw-ex"><p class="vw-ex-en">' + Vocab.highlightExample(item.exEn, item.word) + '</p>' +
          (item.exCn ? '<p class="vw-ex-cn">' + esc(item.exCn) + '</p>' : '') + '</div>'
        : '';
      card.insertAdjacentHTML('beforeend', '<div class="vw-zh vocab-answer-zh">' + esc(item.zh) + '</div>' + ex);
      if (!document.querySelector('.vocab-next')) {
        var quizCard = document.querySelector('.vocab-session-card');
        quizCard.insertAdjacentHTML('beforeend',
          '<button type="button" class="btn-primary vocab-next" data-act="test-next">下一题</button>');
      }
    }
  }

  function nextTestItem() {
    test.locked = false;
    test.pos += 1;
    if (test.pos >= test.items.length) renderTestResult();
    else renderTest();
  }

  function renderTestResult() {
    takeOver();
    var total = test.items.length;
    var pct = total ? Math.round(test.correct / total * 100) : 0;
    var secs = Math.round((Date.now() - test.start) / 1000);
    var time = Math.floor(secs / 60) + ':' + ('0' + secs % 60).slice(-2);
    // 归档（自由测试/错题再练不记录）
    if (test.kind && test.key) {
      Store.recordVocabTest(test.kind, test.key, {
        total: total, correct: test.correct, wrong: test.wrong.slice(), at: Date.now()
      });
    }
    // 错题回炉：进错词本 + SRS 打回（明天复习见）
    var deck = test.deck;
    test.wrong.forEach(function (idx) {
      Store.vocabGrade(deck, idx, 0, Vocab.todayStr());
    });
    var wrongList = test.wrong.length
      ? '<div class="vocab-wrong-list">' + test.wrong.map(function (idx) {
          var e = Vocab.entry(deck, idx) || ['', '', ''];
          return '<div class="vw-row"><b>' + esc(e[0]) + '</b><span>' + esc((e[2] || '').slice(0, 24)) + '</span></div>';
        }).join('') + '</div>'
      : '<p class="vocab-allright">全对，没有错题 🎉</p>';
    var study = $('vocab-study');
    study.innerHTML =
      '<div class="card vocab-session-card">' +
        '<div class="vocab-session-top">' +
          '<button type="button" class="vocab-exit" data-act="exit">' + Icons.svg('close', 'ic-sm') + '返回</button>' +
        '</div>' +
        '<div class="vocab-finish">' +
          '<p class="vocab-score' + (pct >= 80 ? ' good' : (pct < 60 ? ' bad' : '')) + '">' + pct + '%</p>' +
          '<p class="vocab-finish-sub">答对 ' + test.correct + ' / ' + total + ' 题 · 用时 ' + time +
            (test.kind === 'daily' ? ' · 已记入今日自检' : test.kind === 'weekly' ? ' · 已记入本周周测' :
             test.kind === 'monthly' ? ' · 已记入本月月测' : '') + '</p>' +
          wrongList +
          (test.wrong.length
            ? '<button type="button" class="btn-secondary btn-sm vocab-drill" data-act="test-drill">错题再练一轮</button>'
            : '') +
          '<button type="button" class="btn-primary vocab-start" data-act="exit">返回</button>' +
        '</div>' +
      '</div>';
    mode = 'test-result';
  }

  function drillWrong() {
    var idxs = test.wrong.slice();
    var quiz = Vocab.makeQuiz(idxs, idxs.length);
    if (!quiz || !quiz.items.length) { toast('错题清空了'); return; }
    test = { items: quiz.items, deck: quiz.deck, pos: 0, correct: 0, wrong: [],
      start: Date.now(), kind: null, key: null, locked: false };
    mode = 'test';
    renderTest();
  }

  /* ==================== 发音 ==================== */

  function speak(word) {
    if (!('speechSynthesis' in window)) { toast('此浏览器不支持发音'); return; }
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(word);
      u.lang = 'en-US';
      u.rate = 0.92;
      window.speechSynthesis.speak(u);
    } catch (e) { toast('发音失败'); }
  }

  /* ==================== 手势（学习卡：右=认识 左=不认识 上=看释义） ==================== */

  var swipe = { active: false, x0: 0, y0: 0, engaged: false };

  function bindSwipe() {
    var host = $('vocab-study');
    host.addEventListener('pointerdown', function (e) {
      if (mode !== 'study' || e.isPrimary === false) return;
      if (e.target.closest('button')) return;
      swipe.active = true;
      swipe.engaged = false;
      swipe.x0 = e.clientX;
      swipe.y0 = e.clientY;
    });
    window.addEventListener('pointermove', function (e) {
      if (!swipe.active) return;
      var dx = e.clientX - swipe.x0;
      var dy = e.clientY - swipe.y0;
      if (!swipe.engaged) {
        if (Math.abs(dx) < 40 && Math.abs(dy) < 40) return;
        swipe.engaged = true;
      }
    });
    window.addEventListener('pointerup', function (e) {
      if (!swipe.active) return;
      var dx = e.clientX - swipe.x0;
      var dy = e.clientY - swipe.y0;
      swipe.active = false;
      if (!swipe.engaged) return;                    // 普通点按走 click
      if (Math.abs(dx) < 40 && Math.abs(dy) < 40) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        if (dy < -40 && !revealed) reveal();
      } else if (dx > 40) {
        if (revealed) gradeCurrentCard(2);
      } else if (dx < -40) {
        if (revealed) gradeCurrentCard(0);
      }
    });
  }

  /* ==================== 动作 ==================== */

  function reveal() {
    if (revealed) return;
    revealed = true;
    renderStudy();
  }

  function gradeCurrentCard(g) {
    if (!revealed && mode === 'study') { reveal(); return; }   // 未翻开先翻
    var r = Vocab.gradeCurrent(g);
    revealed = false;
    if (r && r.finished) renderFinish();
    else renderStudy();
  }

  /* ==================== 初始化（只跑一次） ==================== */

  function init() {
    $('vocab-main').addEventListener('click', function (e) {
      var act = e.target.closest('[data-act]');
      if (!act) return;
      var a = act.getAttribute('data-act');
      if (a === 'start') startStudy();
      else if (a === 'triage') startTriage();
      else if (a === 'test') startTestSetup();
      else if (a === 'toggle-settings') $('vocab-settings').classList.toggle('hidden');
    });

    // 设置项（委托，重绘后仍有效）
    $('vocab-main').addEventListener('change', function (e) {
      var t = e.target;
      if (t.id === 'vocab-new-input') {
        Store.setVocabSettings({ newPerDay: Number(t.value) || 50 });
        toast('已保存');
      } else if (t.id === 'vocab-cap-input') {
        Store.setVocabSettings({ reviewCap: Number(t.value) || 0 });
        toast('已保存');
      } else if (t.id === 'vocab-exam-select') {
        Store.setVocabSettings({ examEventId: t.value || null });
        toast('已保存');
      } else if (t.id === 'vocab-habit-select') {
        Store.setVocabSettings({ autoCheckHabitId: t.value || null });
        toast('已保存');
      }
    });
    $('vocab-main').addEventListener('click', function (e) {
      var btn = e.target.closest('#vocab-deck-toggle .type-btn');
      if (btn) {
        Store.setVocabSettings({ deck: btn.getAttribute('data-deck') });
        Store.vocabSetSession(null);      // 换词库清会话
        renderMain();
        if (window.refreshReminders) window.refreshReminders();
        return;
      }
      var cs = e.target.closest('#vocab-checksize-chips .chip');
      if (cs) {
        Store.setVocabSettings({ checkSize: Number(cs.getAttribute('data-checksize')) || 20 });
        renderMain();
        toast('已保存');
      }
    });

    // 会话/测试内点击（委托）
    $('vocab-study').addEventListener('click', function (e) {
      // 测试设置页的 chips
      var rangeChip = e.target.closest('[data-range]');
      if (rangeChip) { testRange = rangeChip.getAttribute('data-range'); renderTestSetup(); return; }
      var sizeChip = e.target.closest('[data-size]');
      if (sizeChip) { testSize = Number(sizeChip.getAttribute('data-size')) || 20; renderTestSetup(); return; }
      // 测试答题
      var opt = e.target.closest('[data-opt]');
      if (opt && mode === 'test' && test && !test.locked) {
        answerTest(Number(opt.getAttribute('data-opt')));
        return;
      }
      var act = e.target.closest('[data-act]');
      if (act) {
        var a = act.getAttribute('data-act');
        if (a === 'exit') { exitSession(); return; }
        if (a === 'reveal') { reveal(); return; }
        if (a === 'test') { startTestSetup(); return; }
        if (a === 'test-begin') { startTest(testRange, testSize); return; }
        if (a === 'test-next') { if (test && test.locked) nextTestItem(); return; }
        if (a === 'test-drill') { drillWrong(); return; }
        if (a === 'speak') {
          var c = Vocab.currentCard();
          if (c) speak(c.entry.word);
          return;
        }
        if (a === 'speak-test') {
          if (test && test.items[test.pos]) speak(test.items[test.pos].word);
          return;
        }
        if (a === 'speak-triage') {
          var deck = Store.getVocab().settings.deck;
          var idx = triage.queue[triage.pos];
          var en = Vocab.entry(deck, idx);
          if (en) speak(en[0]);
          return;
        }
        if (a === 'bookmark') {
          var cc = Vocab.currentCard();
          if (cc) {
            var on = Store.vocabToggleBookmark(Store.getVocab().settings.deck, cc.idx);
            toast(on ? '已加入生词本' : '已移出生词本');
          }
          return;
        }
      }
      var grade = e.target.closest('[data-grade]');
      if (grade) gradeCurrentCard(Number(grade.getAttribute('data-grade')));
      var tri = e.target.closest('[data-triage]');
      if (tri) triageNext(tri.getAttribute('data-triage') === '1');
    });

    bindSwipe();

    // 键盘：空格翻面 / 1·2·3 评分 / 1–4 答题 / Esc 退出
    document.addEventListener('keydown', function (e) {
      if (mode === null) return;
      if (e.key === 'Escape') { exitSession(); return; }
      if (mode === 'study') {
        if (e.key === ' ') { e.preventDefault(); reveal(); }
        else if (revealed && ['1', '2', '3'].indexOf(e.key) >= 0) {
          gradeCurrentCard(Number(e.key) - 1);
        }
      } else if (mode === 'test' && test && !test.locked &&
                 ['1', '2', '3', '4'].indexOf(e.key) >= 0) {
        answerTest(Number(e.key) - 1);
      }
    });
  }

  return { init: init, render: render };
})();
