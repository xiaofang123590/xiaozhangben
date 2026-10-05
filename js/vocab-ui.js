/**
 * vocab-ui.js —— 背单词界面（今日任务 + 学习会话 + 快速筛选 + 测试 + 设置）
 *
 * 依赖：core.js（Store）、vocab.js（Vocab）、days.js（Days）、icons.js（Icons）、
 *       spring.js（Spring，运行时调用）、days-ui.js（LifeUI.confettiHTML 撒花）。
 * 结构：#vocab-main 常态内容；#vocab-study 会话层——fixed 全屏专注层，
 *       盖住顶栏与底栏（进出同路径弹簧；Android 返回键 = 退出会话不丢进度）。
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
  var triage = null;        // { queue:[idx], pos, total, markedCount }
  var studyTask = null;     // buildToday() 返回的任务信息
  var toastTimer = 0;
  var testRange = 'today';  // 测试设置页当前范围
  var testSize = 20;        // 测试设置页当前题量
  var test = null;          // { items,pos,correct,wrong,start,kind,key,locked }
  var backPushed = false;   // 已为会话压入一条 history 记录（Android 返回键 = 退出会话）
  var flyAxis = null;       // 学习卡飞出动画（进行中时禁止再次抓卡）
  var backAxis = null;      // 学习卡弹回动画
  var confettiShownDate = null;   // 完成页撒花每天只放一次

  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 1800);
  }

  /** 元素单次入场：淡入 + 轻微上浮（设置展开等非手势进场） */
  function popIn(el) {
    if (!el || Spring.reduced) return;
    el.style.transition = 'none';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    void el.offsetWidth;
    el.style.transition = 'opacity 190ms ease-out, transform 250ms cubic-bezier(0.22, 1, 0.36, 1)';
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
    setTimeout(function () { el.style.transition = ''; el.style.transform = ''; el.style.opacity = ''; }, 270);
  }

  /** 内容卡入场（换词 / 换题 / 换屏）：CSS 动画，减弱动态下由全局规则关掉 */
  function cardEnter(el) {
    if (!el) return;
    el.classList.remove('q-enter');
    void el.offsetWidth;
    el.classList.add('q-enter');
  }

  /** 进度环 SVG：done/total（今日任务卡用） */
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

  /* ==================== 会话层（全屏专注层） ==================== */

  /** 是否处于任何会话/测试中（app.js 开屏简报避让用） */
  function sessionActive() { return !!mode; }

  function pushBackGuard() {
    if (backPushed || !window.history || !history.pushState) return;
    try { history.pushState({ vocabSession: 1 }, ''); backPushed = true; } catch (e) { /* 忽略 */ }
  }

  function popBackGuard() {
    if (!backPushed) return;
    backPushed = false;
    try { history.back(); } catch (e) { /* 忽略 */ }
  }

  /** 会话层上场：盖住顶栏/底栏，底部上滑入场（退出走同一条路径，§7） */
  function showLayer() {
    var layer = $('vocab-study');
    var seg = document.querySelector('#view-life .life-seg');
    if (seg) seg.classList.add('hidden');
    $('vocab-main').classList.add('hidden');
    if (!layer.classList.contains('hidden')) return;
    layer.classList.remove('hidden');
    pushBackGuard();
    if (Spring.reduced) return;
    layer.style.transition = 'none';
    layer.style.opacity = '0';
    layer.style.transform = 'translateY(28px)';
    void layer.offsetWidth;
    layer.style.transition = 'opacity 200ms ease-out, transform 280ms cubic-bezier(0.22, 1, 0.36, 1)';
    layer.style.opacity = '1';
    layer.style.transform = 'translateY(0)';
    setTimeout(function () { layer.style.transition = ''; layer.style.transform = ''; }, 300);
  }

  function exitSession(fromPop) {
    if (!mode) return;
    mode = null;
    revealed = false;
    triage = null;
    test = null;
    if (flyAxis) { flyAxis.kill(); flyAxis = null; }
    if (backAxis) { backAxis.kill(); backAxis = null; }
    if (!fromPop) popBackGuard();
    var layer = $('vocab-study');
    var seg = document.querySelector('#view-life .life-seg');
    function finishHide() {
      layer.classList.add('hidden');
      layer.style.transition = ''; layer.style.opacity = ''; layer.style.transform = '';
      if (seg) seg.classList.remove('hidden');
      $('vocab-main').classList.remove('hidden');
      renderMain();
    }
    if (Spring.reduced) { finishHide(); return; }
    // 与入场同一条路径的镜像缓动：材质消解而非凭空消失（§7 §12）
    layer.style.transition = 'opacity 170ms ease-in, transform 230ms cubic-bezier(0.64, 0, 0.78, 0)';
    layer.style.opacity = '0';
    layer.style.transform = 'translateY(28px)';
    setTimeout(finishHide, 240);
  }

  /**
   * 会话层骨架：细进度条贴顶 + 顶栏（退出 / 计数 / 发音）+ 垂直居中内容。
   * opt.top=false 的屏（结算/完成）不渲染顶栏——退路只留底部一组按钮，语义唯一。
   */
  function shell(opt) {
    var top = '';
    if (opt.top) {
      top = '<header class="vs-top">' +
        '<button type="button" class="vocab-exit" data-act="exit">' +
          Icons.svg('close', 'ic-sm') + '退出</button>' +
        (opt.bar != null
          ? '<div class="vs-bar"><i style="width:' + opt.bar + '%"></i></div>'
          : '<span class="vs-spring"></span>') +
        (opt.count ? '<span class="vs-count">' + opt.count + '</span>' : '') +
        (opt.speak
          ? '<button type="button" class="vocab-speak" data-act="' + opt.speak + '">' +
            Icons.svg('volume', 'ic-sm') + '</button>'
          : '') +
      '</header>';
    }
    return top + '<div class="vs-body"><div class="vs-center">' + opt.body + '</div></div>';
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
    if (study && study.classList.contains('hidden') === false) return;  // 会话中不重绘
    if (!box) return;
    var v = Store.getVocab();
    var deck = v.settings.deck;
    var st = Vocab.deckStats(deck);
    var prev = Vocab.todayPreview();
    var ts = Vocab.todayStat();

    var deckName = deck === 'cet6' ? '六级' : '四级';
    var deckSizes = (window.VOCAB_DB && VOCAB_DB[deck]) ? VOCAB_DB[deck].length : 0;

    // 备考联动：距离大数字 + 两行辅注 + 一行结论（数字排版对齐全站规范，§15）
    var examHTML = '';
    if (v.settings.examEventId && window.Days) {
      var ep = Vocab.examProgress();
      if (ep) {
        var eta = '';
        if (ep.etaDays !== null && !ep.past && !ep.today) {
          eta = ep.etaDays <= ep.daysLeft
            ? '<div class="vocab-exam-eta ok">近 7 天均速 ' + ep.speed + ' 词/天 · 按当前速度可完成 ✓</div>'
            : '<div class="vocab-exam-eta bad">近 7 天均速 ' + ep.speed + ' 词/天 · 按当前速度还差约 ' +
              Math.max(1, ep.remaining - Math.floor(ep.speed * ep.daysLeft)) + ' 词</div>';
        } else if (ep.speed === 0 && ep.remaining > 0 && !ep.past) {
          eta = '<div class="vocab-exam-eta">近 7 天还没学新词，今天开始吧</div>';
        }
        examHTML =
          '<div class="vocab-exam-block">' +
            '<div class="vocab-exam-row">' +
              '<span class="vocab-exam-ic">' + esc(ep.icon || '🎓') + '</span>' +
              '<span class="vocab-exam-name">距「' + esc(ep.title) + '」</span>' +
              '<span class="vocab-exam-days">' +
                (ep.today ? '就是今天'
                  : (ep.past ? '已过 <b>' + Math.abs(ep.daysLeft) + '</b><i>天</i>'
                             : '<b>' + ep.daysLeft + '</b><i>天</i>')) +
              '</span>' +
            '</div>' +
            '<div class="vocab-exam-meta">剩余 <b>' + ep.remaining + '</b> 词' +
              (ep.perDay ? ' · 建议每日 <b>' + ep.perDay + '</b> 词' : '') + '</div>' +
            eta +
          '</div>';
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
        examHTML +
        '<div class="vocab-task-body">' +
          ringHTML(prev.done, prev.total, '/' + prev.total) +
          '<div class="vocab-task-info">' +
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
        '<p class="hint">「已掌握」= 复习周期到 30 天以上的词 + 快速筛选标记的词。每日新词默认 50，吃不消就调低，比积压更好。设置按账户保存。</p>' +
      '</div>' +

      '<div class="card vocab-stats-card">' +
        '<div class="card-head"><h3 class="card-title">掌握情况</h3></div>' +
        '<div class="vocab-stat-grid">' +
          statCell('未学', st.unlearned) + statCell('学习中', st.learning) +
          statCell('已掌握', st.mastered) + statCell('生词本', st.bookmarks) +
          statCell('错词本', st.wrong) +
        '</div>' +
        historyHTML() +
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
    triage = { queue: queue, pos: 0, total: queue.length, markedCount: 0 };
    renderTriage();
  }

  /** 学习卡结构：滑动意图角标（左=不认识 右=认识）+ 单词卡 */
  function studyCardHTML(card) {
    var e = card.entry;
    return '<div class="vocab-swipe-zone">' +
        '<span class="grade-hint gh-left" aria-hidden="true">不认识</span>' +
        '<span class="grade-hint gh-right" aria-hidden="true">认识</span>' +
        '<div class="vocab-word-card q-enter" data-act="reveal">' +
          '<div class="vw-word">' + esc(e.word) + '</div>' +
          (e.phon ? '<div class="vw-phon">' + esc(e.phon) + '</div>' : '') +
          (revealed ? '<div class="vw-reveal">' + revealHTML(e) + '</div>'
                    : '<div class="vw-tap">点卡片或按空格看释义</div>') +
        '</div>' +
      '</div>';
  }

  function renderStudy() {
    showLayer();
    var card = Vocab.currentCard();
    if (!card) { renderFinish(); return; }
    var v = Store.getVocab();
    var total = v.session ? v.session.queue.length : 0;
    var pos = v.session ? v.session.pos : 0;
    var study = $('vocab-study');
    study.innerHTML = shell({
      top: true,
      bar: total ? Math.round(pos / total * 100) : 0,
      count: (pos + 1) + ' / ' + total,
      speak: 'speak',
      body: studyCardHTML(card) +
        (revealed ? '<div class="vw-reveal vr-grade">' + gradeRow() + '</div>' : '') +
        '<p class="hint vocab-keys">滑右 认识 · 上滑 看释义 · 滑左 不认识 · 键盘 空格 / 1 / 2 / 3</p>'
    });
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
    var today = Vocab.todayStr();
    var confetti = '';
    if (confettiShownDate !== today && window.LifeUI && LifeUI.confettiHTML) {
      confettiShownDate = today;
      confetti = LifeUI.confettiHTML();       // 完成每日任务是值得庆祝的时刻（§13）
    }
    Spring.haptic(12);
    var study = $('vocab-study');
    study.innerHTML = shell({
      top: false,
      body: '<div class="vocab-finish q-enter">' +
          confetti +
          '<span class="empty-art"><svg class="ic"><use href="#i-check-circle"></use></svg></span>' +
          '<p class="empty-title">今日任务完成 ✓</p>' +
          '<p class="vocab-finish-sub">新学 ' + ts.isNewToday + ' 词 · 复习 ' + ts.isReviewToday +
            ' 词 · 连续 ' + ts.streak + ' 天</p>' +
          (auto ? '<p class="hint">已自动为打卡计划打上今天的卡 ✓</p>' : '') +
          '<button type="button" class="btn-primary" data-act="exit">返回</button>' +
        '</div>'
    });
  }

  /* ==================== 快速筛选 ==================== */

  function renderTriage() {
    showLayer();
    var v = Store.getVocab();
    var deck = v.settings.deck;
    var study = $('vocab-study');
    if (triage.pos >= triage.queue.length) {
      study.innerHTML = shell({
        top: false,
        body: '<div class="vocab-finish q-enter">' +
            '<span class="empty-art"><svg class="ic"><use href="#i-check-circle"></use></svg></span>' +
            '<p class="empty-title">筛选完成 ✓</p>' +
            '<p class="vocab-finish-sub">本轮标记已掌握 ' + triage.markedCount + ' 词，其余进入每日新词队列</p>' +
            '<button type="button" class="btn-primary" data-act="exit">返回</button>' +
          '</div>'
      });
      return;
    }
    var idx = triage.queue[triage.pos];
    var e = Vocab.entry(deck, idx) || ['', '', ''];
    study.innerHTML = shell({
      top: true,
      bar: Math.round(triage.pos / triage.total * 100),
      count: (triage.pos + 1) + ' / ' + triage.total,
      speak: 'speak-triage',
      body: '<div class="vocab-word-card q-enter">' +
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
        '<p class="hint vocab-keys">认识的直接标记，不会进入学习队列；不认识的留在这里每天学</p>'
    });
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
    showLayer();
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
    study.innerHTML = shell({
      top: true,
      body: '<div class="card vocab-setup-card q-enter">' +
        '<h3 class="vocab-sec-title">测试 · 看英文选中文</h3>' +
        '<div class="form-row"><label class="form-label">范围</label>' +
          '<div class="chip-row" id="test-range-chips">' + chips + '</div></div>' +
        '<div class="form-row"><label class="form-label">题量</label>' +
          '<div class="chip-row" id="test-size-chips">' + sizes + '</div></div>' +
        '<button type="button" class="btn-primary vocab-start" data-act="test-begin"' +
          (sel ? '' : ' disabled') + '>' +
          (sel ? '开始测试（' + Math.min(sel, testSize) + ' 题）' : '这个范围还没有可测的词') + '</button>' +
        '<p class="hint">答错会标出正确答案并回炉：该词进错词本、复习排到明天。</p>' +
      '</div>'
    });
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
    showLayer();
    var item = test.items[test.pos];
    var study = $('vocab-study');
    study.innerHTML = shell({
      top: true,
      bar: Math.round(test.pos / test.items.length * 100),
      count: (test.pos + 1) + ' / ' + test.items.length,
      speak: 'speak-test',
      body: '<div class="vocab-word-card vocab-quiz-card q-enter">' +
          '<div class="vw-word">' + esc(item.word) + '</div>' +
          (item.phon ? '<div class="vw-phon">' + esc(item.phon) + '</div>' : '') +
        '</div>' +
        '<div class="vocab-options" id="test-options">' +
          item.options.map(function (zh, i) {
            return '<button type="button" class="vocab-opt" data-opt="' + i + '">' +
              '<span class="vo-mark">' + 'ABCD'[i] + '</span>' + esc(zh) + '</button>';
          }).join('') +
        '</div>' +
        (test.locked ? '<button type="button" class="btn-primary vocab-next" data-act="test-next">下一题</button>' : '')
    });
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
      Spring.haptic(12);                                  // 答错与视觉同帧（§13）
      test.wrong.push(item.idx);
      // 答错：把释义与例句再显示一遍，并给出「下一题」按钮
      var card = document.querySelector('.vocab-quiz-card');
      var ex = item.exEn
        ? '<div class="vw-ex"><p class="vw-ex-en">' + Vocab.highlightExample(item.exEn, item.word) + '</p>' +
          (item.exCn ? '<p class="vw-ex-cn">' + esc(item.exCn) + '</p>' : '') + '</div>'
        : '';
      card.insertAdjacentHTML('beforeend',
        '<div class="vw-reveal"><div class="vw-zh vocab-answer-zh">' + esc(item.zh) + '</div>' + ex + '</div>');
      if (!document.querySelector('.vocab-next')) {
        var quizCard = document.querySelector('.vs-body');
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

  /** 结算环：正确率描边 + 中央大数字，由 animateResult 驱动生长 */
  function resultRingHTML(pct) {
    var C = 2 * Math.PI * 52;
    var tone = pct >= 80 ? ' good' : (pct < 60 ? ' bad' : '');
    return '<svg class="vocab-ring vr-result' + tone + '" viewBox="0 0 128 128" aria-hidden="true">' +
      '<circle class="vr-bg" cx="64" cy="64" r="52" />' +
      '<circle class="vr-fg vr-arc" cx="64" cy="64" r="52" style="stroke-dasharray:0 ' + C.toFixed(1) + '" />' +
      '<text x="64" y="73" class="vr-pct">0%</text>' +
    '</svg>';
  }

  /** 结算大数字计数 + 环形描边同一帧驱动（§13 harmony）；减弱动态直接显示终值 */
  function animateResult(pct) {
    var svg = document.querySelector('.vr-result');
    if (!svg) return;
    var arc = svg.querySelector('.vr-arc');
    var num = svg.querySelector('.vr-pct');
    var C = 2 * Math.PI * 52;
    var target = C * pct / 100;
    if (Spring.reduced) {
      arc.style.strokeDasharray = target.toFixed(1) + ' ' + C.toFixed(1);
      num.textContent = pct + '%';
      return;
    }
    var t0 = 0, DUR = 650;
    function tick(now) {
      if (!t0) t0 = now;
      var t = Math.min(1, (now - t0) / DUR);
      var e = 1 - Math.pow(1 - t, 3);
      arc.style.strokeDasharray = (target * e).toFixed(1) + ' ' + C.toFixed(1);
      num.textContent = Math.round(pct * e) + '%';
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function renderTestResult() {
    showLayer();
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
    // 错题列表：>3 条默认收折（常见路径先看到成绩，错题一层之隔，§6）
    var wrongHTML;
    if (test.wrong.length) {
      var rows = test.wrong.map(function (idx) {
        var e = Vocab.entry(deck, idx) || ['', '', ''];
        return '<div class="vw-row"><b>' + esc(e[0]) + '</b><span>' +
          esc((e[2] || '').slice(0, 24)) + '</span></div>';
      });
      var more = rows.length > 3
        ? '<div class="vw-rows-more hidden" id="vw-rows-more">' + rows.slice(3).join('') + '</div>' +
          '<button type="button" class="vw-more-btn" data-act="wrong-toggle">展开全部 ' + rows.length + ' 条</button>'
        : '';
      wrongHTML = '<div class="vocab-wrong-list">' + rows.slice(0, 3).join('') + '</div>' + more;
    } else {
      wrongHTML = '<p class="vocab-allright">全对，没有错题 🎉</p>';
    }
    var actions = test.wrong.length
      ? '<button type="button" class="btn-primary" data-act="test-drill">错题再练一轮</button>' +
        '<button type="button" class="btn-secondary" data-act="exit">返回</button>'
      : '<button type="button" class="btn-primary" data-act="exit">返回</button>';
    var study = $('vocab-study');
    study.innerHTML = shell({
      top: false,
      body: '<div class="vocab-finish vr-wrap q-enter">' +
          resultRingHTML(pct) +
          '<p class="vocab-finish-sub">答对 ' + test.correct + ' / ' + total + ' 题 · 用时 ' + time +
            (test.kind === 'daily' ? ' · 已记入今日自检' : test.kind === 'weekly' ? ' · 已记入本周周测' :
             test.kind === 'monthly' ? ' · 已记入本月月测' : '') + '</p>' +
          wrongHTML +
          '<div class="vr-actions">' + actions + '</div>' +
        '</div>'
    });
    mode = 'test-result';
    animateResult(pct);
    Spring.haptic(12);
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

  /* ==================== 学习卡手势 ==================== */
  /* 跟手 1:1（§2）：卡片随手指位移并轻微旋转，评分意图以角标透明度渐显；
     松手速度优先判定（§5），提交则继承速度飞出（§6 投射由速度阈值体现），
     取消则弹回；未翻开时水平方向只给少量阻力位移，提示「先看释义」（§8）。 */

  var gest = { active: false, engaged: false, axis: null, pointerId: -1,
    x0: 0, y0: 0, dx: 0, dy: 0, tracker: null };

  function wordCardEl() { return document.querySelector('#vocab-study .vocab-word-card'); }
  function hintEl(side) { return document.querySelector('#vocab-study .gh-' + side); }

  /** 拖动渲染：位移 + 旋转 + 意图角标（每帧调用，全程连续反馈 §1） */
  function renderDrag(dx, dy) {
    var card = wordCardEl();
    if (!card) return;
    if (gest.axis === 'x') {
      if (revealed) {
        card.style.transform = 'translateX(' + dx + 'px) rotate(' + (dx * 0.06).toFixed(2) + 'deg)';
        var l = hintEl('left'), r = hintEl('right');
        var op = Math.max(0, Math.min(1, Math.abs(dx) / 80));
        if (l) l.style.opacity = dx < 0 ? op : 0;
        if (r) r.style.opacity = dx > 0 ? op : 0;
      } else {
        // 未翻开：水平方向渐进阻力，最多跟 12px（§9 软边界，方向提示）
        var eff = Math.sign(dx) * Math.min(Math.abs(dx) * 0.18, 12);
        card.style.transform = 'translateX(' + eff.toFixed(1) + 'px)';
      }
    } else if (gest.axis === 'y') {
      if (!revealed && dy < 0) {
        var up = Math.max(dy * 0.45, -52);        // 上滑跟手，露出释义的方向感
        card.style.transform = 'translateY(' + up.toFixed(1) + 'px)';
      } else if (!revealed) {
        card.style.transform = 'translateY(' + (dy * 0.12).toFixed(1) + 'px)';
      } else {
        card.style.transform = 'translateY(' + (dy * 0.15).toFixed(1) + 'px)';
      }
    }
  }

  /** 松手弹回：从当前位移出发、继承手指速度（§5 交接） */
  function springBack() {
    var card = wordCardEl();
    if (!card) return;
    if (backAxis) backAxis.kill();
    var from = gest.axis === 'x' ? gest.dx : gest.dy;
    var v = gest.tracker ? gest.tracker.velocity() : 0;
    var preset = Math.abs(v) > 240 ? Spring.PRESET.momentum : Spring.PRESET.move;
    card.classList.add('springing');
    backAxis = new Spring.Axis({
      from: from,
      velocity: v,
      damping: preset.damping,
      response: preset.response,
      onUpdate: (function (ax) {
        return function (x) {
          var c = wordCardEl();
          if (!c) return;
          c.style.transform = ax === 'x'
            ? 'translateX(' + x.toFixed(1) + 'px) rotate(' + (x * 0.06).toFixed(2) + 'deg)'
            : 'translateY(' + x.toFixed(1) + 'px)';
          if (ax === 'x') {
            var l = hintEl('left'), r = hintEl('right');
            var op = Math.max(0, Math.min(1, Math.abs(x) / 80));
            if (l) l.style.opacity = x < 0 ? op : 0;
            if (r) r.style.opacity = x > 0 ? op : 0;
          }
        };
      })(gest.axis),
      onSettle: function () {
        backAxis = null;
        var c = wordCardEl();
        if (c) { c.classList.remove('springing'); c.style.transform = ''; }
        var l = hintEl('left'), r = hintEl('right');
        if (l) l.style.opacity = 0;
        if (r) r.style.opacity = 0;
      }
    });
    backAxis.set(0);
  }

  /** 提交评分：卡片沿手势方向继承速度飞出，落定后渲染下一张（§5 §6） */
  function commitGrade(g, dir, v, fromDx) {
    if (flyAxis) return;
    Spring.haptic(8);
    var r;
    try { r = Vocab.gradeCurrent(g); } catch (e) { r = null; }
    var card = wordCardEl();
    var l = hintEl('left'), rr = hintEl('right');
    if (l) l.style.opacity = dir < 0 ? 1 : 0;
    if (rr) rr.style.opacity = dir > 0 ? 1 : 0;

    function after() {
      flyAxis = null;
      revealed = false;
      if (mode !== 'study') return;
      if (r && r.finished) renderFinish();
      else renderStudy();
    }
    if (!card || Spring.reduced) { after(); return; }
    var W = ($('vocab-study').clientWidth || 360);
    card.style.pointerEvents = 'none';
    var from = dir === 0 ? 0 : (fromDx || 0);
    flyAxis = new Spring.Axis({
      from: from,
      velocity: dir === 0 ? 0 : v,
      damping: Spring.PRESET.momentum.damping,
      response: Spring.PRESET.momentum.response,
      onUpdate: function (x) {
        var c = wordCardEl();
        if (!c) return;
        if (dir === 0) {
          c.style.transform = 'translateY(' + x.toFixed(1) + 'px)';
        } else {
          c.style.transform = 'translateX(' + x.toFixed(1) + 'px) rotate(' + (x * 0.06).toFixed(2) + 'deg)';
        }
        c.style.opacity = String(Math.max(0, 1 - Math.abs(x) / (W * 0.85)));
      }
    });
    flyAxis.onSettle = after;
    flyAxis.set(dir === 0 ? 96 : dir * W * 1.15);
  }

  /** 按钮 / 键盘评分入口：保持与滑动手势同一条飞出路径 */
  function gradeCurrentCard(g) {
    if (flyAxis) return;
    if (!revealed && mode === 'study') { reveal(); return; }   // 未翻开先翻
    var dir = g === 2 ? 1 : (g === 0 ? -1 : 0);
    commitGrade(g, dir, 0, 0);
  }

  function reveal() {
    if (revealed || flyAxis) return;
    revealed = true;
    renderStudy();          // 释义区带 .vw-reveal 入场动画
  }

  function bindSwipe() {
    var host = $('vocab-study');

    host.addEventListener('pointerdown', function (e) {
      if (mode !== 'study' || e.isPrimary === false) return;
      if (e.target.closest('button')) return;
      if (flyAxis) return;                        // 上一张还在飞出，不接新手势
      if (backAxis) { backAxis.kill(); backAxis = null;   // 抓住弹回中的卡片（§3）
        var c0 = wordCardEl();
        if (c0) c0.classList.remove('springing');
      }
      gest.active = true;
      gest.engaged = false;
      gest.axis = null;
      gest.pointerId = e.pointerId;
      gest.x0 = e.clientX;
      gest.y0 = e.clientY;
      gest.dx = 0;
      gest.dy = 0;
      if (!gest.tracker) gest.tracker = new Spring.Tracker();
      gest.tracker.reset();
      gest.tracker.push(0, e.timeStamp || performance.now());
    });

    window.addEventListener('pointermove', function (e) {
      if (!gest.active || e.pointerId !== gest.pointerId) return;
      var dx = e.clientX - gest.x0;
      var dy = e.clientY - gest.y0;
      if (!gest.engaged) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        gest.engaged = true;
        // 并行检测两个方向的意图，谁大锁谁（§10），落选方向不再参与
        gest.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        var c1 = wordCardEl();
        if (c1) c1.style.animation = 'none';      // 入场动画让位给手势
        try { host.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      }
      gest.dx = dx;
      gest.dy = dy;
      gest.tracker.push(gest.axis === 'x' ? dx : dy, e.timeStamp || performance.now());
      renderDrag(dx, dy);
    });

    function up(e, cancelled) {
      if (!gest.active || e.pointerId !== gest.pointerId) return;
      gest.active = false;
      if (!gest.engaged) return;                  // 普通点按走 click
      var dx = gest.dx, dy = gest.dy;
      var v = cancelled ? 0 : gest.tracker.velocity();

      if (gest.axis === 'x') {
        if (revealed) {
          var W = ($('vocab-study').clientWidth || 360);
          var dir = (Math.abs(dx) > 2 ? Math.sign(dx) : (Math.sign(v) || 1));
          var passed = Math.abs(dx) > W * 0.32;                    // 拖过三分之一
          var flung = Math.abs(v) > 420 && Math.sign(v) === dir;   // 或一记快甩（速度优先 §5）
          if (passed || flung) commitGrade(dir > 0 ? 2 : 0, dir, v, dx);
          else springBack();
        } else {
          springBack();               // 未翻开：阻力位移回弹，暗示先看释义
        }
      } else if (gest.axis === 'y') {
        if (!revealed && !cancelled && (dy < -70 || v < -420)) {
          springBack();
          if (backAxis) backAxis.onSettle = (function (prev) {
            return function () {
              if (prev) prev();
              if (mode === 'study' && !revealed && !flyAxis) reveal();
            };
          })(backAxis.onSettle);
        } else {
          springBack();
        }
      }
    }
    window.addEventListener('pointerup', function (e) { up(e, false); });
    window.addEventListener('pointercancel', function (e) { up(e, true); });
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
      else if (a === 'toggle-settings') {
        var s = $('vocab-settings');
        if (s.classList.contains('hidden')) { s.classList.remove('hidden'); popIn(s); }
        else s.classList.add('hidden');
      }
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
        if (a === 'wrong-toggle') {
          var more = $('vw-rows-more');
          if (more) more.classList.remove('hidden');
          act.parentNode.removeChild(act);
          return;
        }
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

    // Android 返回键：退出会话而不是退出应用（进度由会话续学机制保留）
    window.addEventListener('popstate', function () {
      if (backPushed) {
        backPushed = false;
        if (mode) exitSession(true);
      }
    });

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

  return {
    init: init,
    render: render,
    sessionActive: sessionActive
  };
})();
