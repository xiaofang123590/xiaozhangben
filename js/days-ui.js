/**
 * days-ui.js —— 生活页界面（分段切换 + 日子卡片切换器 + 打卡计划 + 编辑弹窗）
 *
 * 依赖：core.js（Store）、days.js（Days）、icons.js（Icons）、app.js（window.successFlash）
 * 事件绑定只在 init() 做一次（app.js boot 调用）；render() 每次重画数据区。
 * 分段偏好与主题偏好一样按账户记忆（localStorage 键 jz_life_seg::用户名）。
 */
var LifeUI = (function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var currentMod = 'days';        // 'days' | 'vocab'
  var dayIdx = 0;                 // 当前显示第几张事件卡
  var cardCount = 0;              // 事件卡总数（滑动边界用）
  var editingEventId = null;      // 正在编辑的事件 id（null = 新增）
  var editingHabitId = null;      // 正在编辑的打卡 id（null = 新增）
  var editMode = 'countdown';     // 弹窗当前方向
  var editRepeat = 'none';        // 弹窗当前重复
  var editCalendar = 'solar';     // 弹窗当前历法（仅每年重复时可选农历）
  var editRemind = {};            // 弹窗当前提醒档 {0:true,1:false,...}
  var editColor = '';             // 弹窗当前颜色（'' = 跟随主题）
  var editFreq = 'daily';         // 打卡弹窗频率：'daily' | {type:'weekly',times:N}
  var confettiShownDate = null;   // 撒花每天只放一次

  /** 卡片滑动手势状态（tracker/axis 延迟创建：spring.js 在本文件之后加载） */
  var drag = { active: false, dragging: false, pointerId: -1,
    startX: 0, startY: 0, dx: 0, width: 1, suppressClick: false,
    basePx: 0, tracker: null, axis: null };

  /* ==================== 小工具 ==================== */

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 1800);
  }

  function flash(msg) {
    if (window.successFlash) window.successFlash(msg);
    else toast(msg);
  }

  /** '#RRGGBB' → 'R,G,B'；其余返回 null（卡片回退主题色） */
  function hexToRgb(hex) {
    var m = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(hex || '');
    if (!m) return null;
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' +
      parseInt(h.slice(4, 6), 16);
  }

  /* ==================== 分段切换 ==================== */

  function segKey() {
    return 'jz_life_seg::' + (Store.storageUser() || '');
  }

  function loadSeg() {
    try {
      var v = localStorage.getItem(segKey());
      return (v === 'vocab' || v === 'diet') ? v : 'days';
    } catch (e) { return 'days'; }
  }

  function saveSeg() {
    try { localStorage.setItem(segKey(), currentMod); } catch (e) { /* 忽略 */ }
  }

  /** 当前分段（app.js 记滚动位置用） */
  function currentSeg() { return currentMod; }

  var SEG_INDEX = { days: 0, vocab: 1, diet: 2 };

  /** 切分段：不跳页，内容交叉淡入替换（与页面切换同一套节奏）；--life-seg 驱动滑动胶囊 */
  function setSegment(mod) {
    if (SEG_INDEX[mod] === undefined) mod = 'days';
    var prev = currentMod;
    currentMod = mod;
    var seg = $('life-seg');
    seg.style.setProperty('--life-seg', String(SEG_INDEX[mod]));
    var btns = seg.querySelectorAll('.life-seg-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-mod') === mod);
    }
    saveSeg();
    if (mod === prev) { render(); return; }
    var outEl = $('life-' + prev);
    var inEl = $('life-' + mod);
    window.fadeSwap(outEl, inEl, function () {
      outEl.classList.add('hidden');
      inEl.classList.remove('hidden');
      render();
    });
  }

  /* ==================== 日子：卡片切换器 ==================== */

  function cardHTML(ev, today, withConfetti) {
    var c = Days.eventCountdown(ev, today);
    var rgb = hexToRgb(ev.color);
    var style = rgb
      ? ' style="--ev-rgb:' + rgb + ';--ev-color:' + esc(ev.color) + '"'
      : ' style="--ev-rgb:var(--primary-rgb)"';

    var num;
    if (c.today && c.n === 0 && ev.mode !== 'countup') {
      num = '<span class="dc-n">今天</span>';
    } else if (c.today && c.n === 0) {
      num = '<span class="dc-n">第 1 天</span>';
    } else {
      num = '<span class="dc-label">' + c.label + '</span>' +
        '<span class="dc-n' + (c.past ? ' past' : '') + '">' + c.n + '</span>' +
        '<span class="dc-unit">天</span>';
    }

    var tags = '';
    if (ev.repeat === 'yearly') {
      tags += '<span class="day-card-tag">' + Icons.svg('repeat', 'ic-sm') + '每年</span>';
    } else if (ev.repeat === 'monthly') {
      tags += '<span class="day-card-tag">' + Icons.svg('repeat', 'ic-sm') + '每月</span>';
    }
    if (ev.calendar === 'lunar' && ev.lunar) {
      tags += '<span class="day-card-tag tag-vertical">' + Lunar.lunarText(ev.lunar).replace(/^农历/, '') + '</span>';
    }
    if (ev.pinned) {
      tags += '<span class="day-card-tag">' + Icons.svg('pin', 'ic-sm') + '置顶</span>';
    }

    // 农历事件的日期位显示农历文本（公历换算出的下一次日期已由大数字表达）
    var dateLabel = (ev.calendar === 'lunar' && ev.lunar && window.Lunar)
      ? Lunar.lunarText(ev.lunar) : ev.date;

    return '<div class="day-card' + (c.today ? ' today' : '') + '" data-id="' + ev.id + '"' + style + '>' +
      (c.today && withConfetti ? confettiHTML() : '') +
      '<div class="day-card-top">' +
        '<span class="day-card-icon">' + esc(ev.icon || '📅') + '</span>' +
        '<span class="day-card-title">' + esc(ev.title) + '</span>' +
        '<span class="day-card-date">' + esc(dateLabel) + '</span>' +
      '</div>' +
      '<div class="day-card-num">' + num + '</div>' +
      (ev.note || tags
        ? '<div class="day-card-foot">' +
            (ev.note ? '<span class="day-card-note">' + esc(ev.note) + '</span>' : '<span class="day-card-note"></span>') +
            '<span class="day-card-tags">' + tags + '</span>' +
          '</div>'
        : '') +
    '</div>';
  }

  /** 撒花：14 片彩纸从卡片顶部飘落（纯 CSS 动画，动画结束自然消失） */
  function confettiHTML() {
    var colors = ['#FF7043', '#42A5F5', '#AB47BC', '#F4B400', '#26A69A', '#EF5350'];
    var pieces = '';
    for (var i = 0; i < 14; i++) {
      pieces += '<i style="left:' + (4 + i * 6.8) + '%;--c:' + colors[i % colors.length] +
        ';animation-delay:' + (i * 0.07).toFixed(2) + 's"></i>';
    }
    return '<span class="confetti" aria-hidden="true">' + pieces + '</span>';
  }

  function updateDots(count) {
    var dots = $('day-dots');
    var html = '';
    for (var i = 0; i < count; i++) {
      html += '<button type="button" class="day-dot' + (i === dayIdx ? ' active' : '') +
        '" data-idx="' + i + '" aria-label="第' + (i + 1) + '张"></button>';
    }
    dots.innerHTML = html;
    dots.classList.toggle('hidden', count < 2);
  }

  /** 把轨道摆到 dayIdx 的位置；animate=false 用于重绘后直接落位。
      用 px 而非 -90%：translateX 的百分比基准是轨道边盒（含 7% 内边距），
      与卡片实际间距（90% × 内容盒）每步差约 45px，滑多了会明显漂移。 */
  function applyTrack(animate) {
    killTrackAxis();
    var track = $('day-track');
    if (!track) return;
    track.classList.toggle('anim', !!animate);
    track.style.transform = 'translateX(' + (-dayIdx * trackUnit()).toFixed(1) + 'px)';
  }

  /* ==================== 卡片滑动手势 ==================== */
  /* 与底栏玻璃块同一套物理：拖动 1:1 跟手 → 松手按动量投射选目标卡（§6）→
     弹簧从当前呈现值出发并继承松手速度（§5）；越界渐进橡皮筋（§9）；
     滑行中随时可以再抓住（§3 可打断）。 */

  /** 一张卡在轨道里的真实步长（px）：直接量相邻卡片的间距。
      translate 是均匀平移，不影响间距；量不出来时按 0.774×舞台宽兜底
      （0.86 卡宽 + 0.04 间隙，均以去掉 7% 内边距后的内容盒为基准）。 */
  function trackUnit() {
    var track = $('day-track');
    var cards = track ? track.querySelectorAll('.day-card') : null;
    if (cards && cards.length >= 2) {
      var u = cards[1].getBoundingClientRect().x - cards[0].getBoundingClientRect().x;
      if (u > 10) return u;
    }
    var stage = $('day-stage');
    return 0.774 * ((stage && stage.clientWidth) || 358);
  }

  function killTrackAxis() {
    if (!drag.axis) return;
    drag.axis.kill();
    drag.axis = null;
    var track = $('day-track');
    if (track) track.classList.remove('springing');
  }

  /** 越界渐进阻尼：第一张往右 / 最后一张往左，越拖越「顶」而不是硬停 */
  function resistedDayPx(dx) {
    var raw = drag.basePx + dx;
    var min = -(cardCount - 1) * trackUnit();
    if (raw > 0) return Spring.rubberband(raw, drag.width);
    if (raw < min) return min - Spring.rubberband(min - raw, drag.width);
    return raw;
  }

  /** 弹簧把轨道送到第 idx 张：从呈现值 fromPx 出发、继承松手速度 v（§5 交接） */
  function springTrackTo(idx, fromPx, v) {
    var track = $('day-track');
    if (!track) return;
    killTrackAxis();
    track.classList.add('springing');          // 关掉 CSS 过渡：位置由弹簧逐帧接管
    var preset = Math.abs(v) > 240 ? Spring.PRESET.momentum : Spring.PRESET.move;
    drag.axis = new Spring.Axis({
      from: fromPx,
      velocity: v,
      damping: preset.damping,
      response: preset.response,
      onUpdate: function (x) {
        track.style.transform = 'translateX(' + x.toFixed(1) + 'px)';
      },
      onSettle: function () {
        drag.axis = null;
        track.classList.remove('springing');
        // 弹簧终值与定位值等位，写回无跳变
        track.style.transform = 'translateX(' + (-idx * trackUnit()).toFixed(1) + 'px)';
      }
    });
    drag.axis.set(-idx * trackUnit());
  }

  function bindSwipe() {
    var stage = $('day-stage');
    var track = $('day-track');

    stage.addEventListener('pointerdown', function (e) {
      if (e.isPrimary === false || cardCount < 2) return;
      killTrackAxis();                     // 抓住一个还在滑行的轨道：从当前值接续（§3）
      drag.active = true;
      drag.dragging = false;
      drag.pointerId = e.pointerId;
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.dx = 0;
      drag.width = stage.clientWidth || 1;
      drag.basePx = -dayIdx * trackUnit();
      if (!drag.tracker) drag.tracker = new Spring.Tracker();
      drag.tracker.reset();
      drag.tracker.push(0, e.timeStamp || performance.now());
    });

    window.addEventListener('pointermove', function (e) {
      if (!drag.active || e.pointerId !== drag.pointerId) return;
      var dx = e.clientX - drag.startX;
      var dy = e.clientY - drag.startY;
      if (!drag.dragging) {
        if (Math.abs(dx) < 12 || Math.abs(dx) <= Math.abs(dy)) return;
        drag.dragging = true;
        stage.classList.add('dragging');
        track.classList.remove('anim');
        try { stage.setPointerCapture(drag.pointerId); } catch (err) { /* 忽略 */ }
      }
      drag.dx = dx;
      drag.tracker.push(dx, e.timeStamp || performance.now());
      track.style.transform = 'translateX(' + resistedDayPx(dx).toFixed(1) + 'px)';
    });

    function end(e, cancelled) {
      if (!drag.active || (e && e.pointerId !== drag.pointerId)) return;
      drag.active = false;
      if (!drag.dragging) return;
      drag.dragging = false;
      stage.classList.remove('dragging');

      var fromPx = resistedDayPx(drag.dx);          // 松手时的呈现位置
      var v = cancelled ? 0 : drag.tracker.velocity();   // px/s，与轨道同向

      // 动量投射：按「本来会滑到哪」选目标卡（§6）——快甩与慢拖落点不同
      var landed = fromPx + Spring.project(v, 0.99);
      var idx = Math.max(0, Math.min(cardCount - 1, Math.round(-landed / trackUnit())));
      dayIdx = idx;
      updateDots(cardCount);
      drag.suppressClick = true;
      setTimeout(function () { drag.suppressClick = false; }, 300);
      springTrackTo(idx, fromPx, v);
    }
    window.addEventListener('pointerup', function (e) { end(e, false); });
    window.addEventListener('pointercancel', function (e) { end(e, true); });
  }

  function renderDays() {
    var today = Store.todayStr();
    var days = Store.getDays();
    var stage = $('day-stage');
    var track = $('day-track');
    var empty = $('day-empty');
    var banner = $('day-banner');

    // 页内横幅：今天的日子 + 提前提醒（合并成一行，都空则隐藏）
    var msgs = [];
    Days.todayEvents(today).forEach(function (ev) {
      msgs.push('今天是「' + ev.title + '」');
    });
    Days.upcomingReminders(today).forEach(function (r) {
      msgs.push('距离「' + r.ev.title + '」还有 ' + r.inDays + ' 天');
    });
    if (msgs.length) {
      banner.className = 'banner banner-info';
      banner.innerHTML = Icons.svg('calendar', 'banner-ic') +
        '<span>' + esc(msgs.slice(0, 2).join('；')) + '</span>';
    } else {
      banner.className = 'banner hidden';
    }

    var events = Days.sortEvents(days.events, today);
    cardCount = events.length;
    if (dayIdx >= cardCount) dayIdx = Math.max(0, cardCount - 1);

    if (!cardCount) {
      stage.classList.add('hidden');
      $('day-dots').classList.add('hidden');
      empty.classList.remove('hidden');
      track.innerHTML = '';
      return;
    }
    stage.classList.remove('hidden');
    empty.classList.add('hidden');

    // 今天有日子时撒一次花（每天至多一次，重进页面不重复）
    var confettiFor = null;
    for (var i = 0; i < events.length; i++) {
      if (Days.eventCountdown(events[i], today).today) { confettiFor = events[i].id; break; }
    }
    var withConfetti = false;
    if (confettiFor && confettiShownDate !== today) {
      withConfetti = true;
      confettiShownDate = today;
    }

    track.innerHTML = events.map(function (ev) {
      return cardHTML(ev, today, withConfetti && ev.id === confettiFor);
    }).join('');
    updateDots(cardCount);
    applyTrack(false);
  }

  /* ==================== 日子：打卡计划 ==================== */

  function habitRowHTML(h, today) {
    var weekly = Days.isWeekly(h);
    var streak = Days.habitStreak(h, today);
    var last7 = Days.habitLast7(h, today);
    var done = !!h.records[today];
    var dots = last7.map(function (on) {
      return '<i class="' + (on ? 'on' : '') + '"></i>';
    }).join('');
    // 周打卡：🔥 计周数 + 本周配额进度；每天：🔥 计天数
    var streakLabel = weekly
      ? '<span class="habit-streak' + (streak > 0 ? '' : ' zero') + '">' +
          Icons.svg('flame', 'ic-sm') + streak + ' 周</span>'
      : '<span class="habit-streak' + (streak > 0 ? '' : ' zero') + '">' +
          Icons.svg('flame', 'ic-sm') + streak + ' 天</span>';
    var goal = '';
    if (weekly) {
      var wp = Days.habitWeekProgress(h, today);
      var met = wp.done >= wp.times;
      goal = '<span class="habit-goal' + (met ? ' met' : '') + '">本周 ' + wp.done + '/' + wp.times + '</span>';
    }
    return '<div class="habit-row" data-id="' + h.id + '">' +
      '<span class="habit-icon">' + esc(h.icon || '✅') + '</span>' +
      '<span class="habit-main">' +
        '<span class="habit-title">' + esc(h.title) + '</span>' +
        '<span class="habit-meta">' +
          streakLabel + goal +
          '<span class="habit-week">' + dots + '</span>' +
        '</span>' +
      '</span>' +
      '<button type="button" class="habit-check' + (done ? ' done' : '') +
        '" data-act="toggle" aria-label="' + (done ? '撤销打卡' : '打卡') + '">' +
        Icons.svg('check', 'ic-sm') + '</button>' +
    '</div>';
  }

  function renderHabits() {
    var today = Store.todayStr();
    var habits = Store.getDays().habits.slice().sort(function (a, b) {
      return (a.sort || 0) - (b.sort || 0);
    });
    $('habit-list').innerHTML = habits.map(function (h) {
      return habitRowHTML(h, today);
    }).join('');
    $('habit-empty').classList.toggle('hidden', habits.length > 0);
  }

  function toggleHabit(id) {
    var today = Store.todayStr();
    var nowDone = false;
    try {
      nowDone = Store.toggleHabitDay(id, today);
    } catch (e) {
      toast(e.message);
      return;
    }
    if (nowDone) {
      Spring.haptic(8);              // 与勾选动画同帧：勾选是值得确认的时刻（§13）
      flash('已打卡 ✓');
    } else {
      toast('已撤销打卡');
    }
    renderHabits();
    if (window.refreshReminders) window.refreshReminders();
  }

  /* ==================== 生活 tab 角标 ==================== */

  /** 今天有日子 / 还有打卡没完成 → 生活 tab 亮红点 */
  function refreshBadge() {
    var tab = document.querySelector('.tab[data-view="life"]');
    if (!tab) return;
    var on = false;
    try {
      if (Store.storageUser()) {
        var today = Store.todayStr();
        on = Days.todayEvents(today).length > 0 || Days.uncheckedHabits(today).length > 0;
      }
    } catch (e) { on = false; }
    if (on) tab.setAttribute('data-badge', '1');
    else tab.removeAttribute('data-badge');
  }

  /* ==================== 总渲染 ==================== */

  function render() {
    if (currentMod === 'days') {
      renderDays();
      renderHabits();
    } else if (currentMod === 'diet' && window.DietUI) {
      DietUI.render();           // 饮食已并入为生活页第 3 分段
    } else if (currentMod === 'vocab' && window.VocabUI) {
      VocabUI.render();          // 背单词分段
    }
    refreshBadge();
  }

  /* ==================== 事件编辑弹窗 ==================== */

  function syncDayToggles() {
    var modeBtns = document.querySelectorAll('#day-mode-toggle .type-btn');
    for (var i = 0; i < modeBtns.length; i++) {
      modeBtns[i].classList.toggle('active', modeBtns[i].getAttribute('data-mode') === editMode);
    }
    var repeatBtns = document.querySelectorAll('#day-repeat-toggle .type-btn');
    for (var j = 0; j < repeatBtns.length; j++) {
      repeatBtns[j].classList.toggle('active', repeatBtns[j].getAttribute('data-repeat') === editRepeat);
    }
    // 历法只在"每年"时有意义
    $('day-calendar-row').classList.toggle('hidden', editRepeat !== 'yearly');
    var calBtns = document.querySelectorAll('#day-calendar-toggle .type-btn');
    for (var c = 0; c < calBtns.length; c++) {
      calBtns[c].classList.toggle('active', calBtns[c].getAttribute('data-calendar') === editCalendar);
    }
    updateLunarHint();
    var remindChips = document.querySelectorAll('#day-remind-chips .chip');
    for (var k = 0; k < remindChips.length; k++) {
      remindChips[k].classList.toggle('active', !!editRemind[remindChips[k].getAttribute('data-remind')]);
    }
    var colorChips = document.querySelectorAll('#day-color-chips .chip');
    for (var m = 0; m < colorChips.length; m++) {
      colorChips[m].classList.toggle('active', (colorChips[m].getAttribute('data-color') || '') === editColor);
    }
  }

  /** 选中农历后，把用户挑的公历日期换算成农历文本回显 */
  function updateLunarHint() {
    var hint = $('day-lunar-hint');
    if (!hint) return;
    if (editRepeat !== 'yearly' || editCalendar !== 'lunar') {
      hint.classList.add('hidden');
      return;
    }
    var L = (window.Lunar && Lunar.solarToLunar) ? Lunar.solarToLunar($('day-date-input').value) : null;
    hint.textContent = L
      ? '每年按农历「' + L.text + '」计算' + (L.leap ? '（该年有闰月；无闰月的年份按平月）' : '')
      : '每年按农历同月同日计算';
    hint.classList.remove('hidden');
  }

  function openEventModal(ev) {
    editingEventId = ev ? ev.id : null;
    $('modal-day-title').textContent = ev ? '编辑日子' : '新建纪念日 / 倒计时';
    $('day-title-input').value = ev ? ev.title : '';
    $('day-date-input').value = ev ? ev.date : Store.todayStr();
    editMode = ev && ev.mode === 'countup' ? 'countup' : 'countdown';
    editRepeat = ev && ev.repeat === 'yearly' ? 'yearly' : (ev && ev.repeat === 'monthly' ? 'monthly' : 'none');
    editCalendar = ev && ev.calendar === 'lunar' ? 'lunar' : 'solar';
    editColor = ev && ev.color ? ev.color : '';
    editRemind = {};
    var remind = (ev && Array.isArray(ev.remindDays) && ev.remindDays.length) ? ev.remindDays : [0];
    remind.forEach(function (d) { editRemind[d] = true; });
    $('day-icon-input').value = ev ? (ev.icon || '') : '';
    $('day-note-input').value = ev ? (ev.note || '') : '';
    $('day-delete-btn').classList.toggle('hidden', !ev);
    $('day-share-btn').classList.toggle('hidden', !ev);
    syncDayToggles();
    $('modal-day').classList.remove('hidden');
  }

  function saveEvent() {
    var title = $('day-title-input').value.trim();
    var date = $('day-date-input').value;
    if (!title) { toast('先给它起个名字'); return; }
    if (!date) { toast('选一个日期'); return; }
    var remind = [];
    for (var k in editRemind) {
      if (Object.prototype.hasOwnProperty.call(editRemind, k) && editRemind[k]) remind.push(Number(k));
    }
    remind.sort(function (a, b) { return a - b; });
    // 农历：把挑好的公历日期换算成农历月日，周年按农历递推
    var useLunar = editRepeat === 'yearly' && editCalendar === 'lunar';
    var L = (useLunar && window.Lunar) ? Lunar.solarToLunar(date) : null;
    var payload = {
      title: title,
      date: date,
      calendar: (useLunar && L) ? 'lunar' : 'solar',
      lunar: (useLunar && L) ? { m: L.m, d: L.d, leap: L.leap } : null,
      mode: editMode,
      repeat: editRepeat,
      icon: $('day-icon-input').value.trim() || '📅',
      color: editColor || null,
      remindDays: remind,
      note: $('day-note-input').value.trim()
    };
    try {
      if (editingEventId) Store.updateDayEvent(editingEventId, payload);
      else Store.addDayEvent(payload);
    } catch (e) {
      toast(e.message);
      return;
    }
    $('modal-day').classList.add('hidden');
    flash('已保存');
    renderDays();
    refreshBadge();
    if (window.refreshReminders) window.refreshReminders();
  }

  /* ---- 分享卡片：canvas 画一张"还有 X 天"，Web Share 或下载 ---- */

  function shareEventCard() {
    var ev = null;
    var events = Store.getDays().events;
    for (var i = 0; i < events.length; i++) {
      if (events[i].id === editingEventId) { ev = events[i]; break; }
    }
    if (!ev) return;
    var today = Store.todayStr();
    var c = Days.eventCountdown(ev, today);
    var rgb = hexToRgb(ev.color) || [0, 181, 120];

    var canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 900;
    var ctx = canvas.getContext('2d');
    ctx.textAlign = 'center';

    // 背景：白底 + 事件色柔和渐变
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 600, 900);
    var g = ctx.createLinearGradient(0, 0, 0, 900);
    g.addColorStop(0, 'rgba(' + rgb + ',0.18)');
    g.addColorStop(1, 'rgba(' + rgb + ',0.04)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 600, 900);

    ctx.fillStyle = '#333333';
    ctx.font = '84px serif';
    ctx.fillText(ev.icon || '📅', 300, 190);
    ctx.font = '700 40px sans-serif';
    ctx.fillText(ev.title, 300, 290);

    ctx.fillStyle = '#8a8f8b';
    ctx.font = '26px sans-serif';
    var dateLine = (ev.calendar === 'lunar' && ev.lunar && window.Lunar)
      ? Lunar.lunarText(ev.lunar) + '（' + ev.date + '）' : ev.date;
    ctx.fillText(dateLine, 300, 345);

    if (c.today) {
      ctx.fillStyle = 'rgb(' + rgb + ')';
      ctx.font = '700 160px sans-serif';
      ctx.fillText('今天', 300, 580);
    } else {
      ctx.fillStyle = '#8a8f8b';
      ctx.font = '30px sans-serif';
      ctx.fillText(c.label, 300, 480);
      ctx.fillStyle = 'rgb(' + rgb + ')';
      ctx.font = '700 200px sans-serif';
      ctx.fillText(String(c.n), 300, 660);
      ctx.fillStyle = '#555555';
      ctx.font = '32px sans-serif';
      ctx.fillText('天', 300, 715);
    }

    ctx.fillStyle = '#b3b8b3';
    ctx.font = '22px sans-serif';
    ctx.fillText('小账本 · 本地生活记录', 300, 830);

    canvas.toBlob(function (blob) {
      if (!blob) { toast('卡片生成失败'); return; }
      var filename = '小账本-' + ev.title + '.png';
      if (navigator.canShare && navigator.canShare({ files: [new File([blob], filename, { type: 'image/png' })] })) {
        navigator.share({ files: [new File([blob], filename, { type: 'image/png' })], title: ev.title })
          .catch(function () { /* 用户取消分享 */ });
        return;
      }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('图片已生成，可保存或分享');
    });
  }

  function deleteEvent() {
    if (!editingEventId) return;
    if (!confirm('确定删除这个日子吗？')) return;
    Store.deleteDayEvent(editingEventId);
    $('modal-day').classList.add('hidden');
    toast('已删除');
    renderDays();
    refreshBadge();
    if (window.refreshReminders) window.refreshReminders();
  }

  /* ==================== 打卡编辑弹窗 ==================== */

  /** 打卡弹窗控件选中态（频率 toggle + 每周目标 chips） */
  function syncHabitEditor() {
    var freqBtns = document.querySelectorAll('#habit-freq-toggle .type-btn');
    var weekly = editFreq !== 'daily';
    for (var i = 0; i < freqBtns.length; i++) {
      var isWeeklyBtn = freqBtns[i].getAttribute('data-freq') === 'weekly';
      freqBtns[i].classList.toggle('active', isWeeklyBtn === weekly);
    }
    $('habit-times-row').classList.toggle('hidden', !weekly);
    var times = weekly ? editFreq.times : 5;
    var chips = document.querySelectorAll('#habit-times-chips .chip');
    for (var j = 0; j < chips.length; j++) {
      chips[j].classList.toggle('active', Number(chips[j].getAttribute('data-times')) === times);
    }
  }

  function openHabitModal(h) {
    editingHabitId = h ? h.id : null;
    $('modal-habit-title').textContent = h ? '编辑打卡计划' : '新增打卡计划';
    $('habit-title-input').value = h ? h.title : '';
    $('habit-icon-input').value = h ? (h.icon || '') : '';
    editFreq = (h && Days.isWeekly(h)) ? { type: 'weekly', times: h.freq.times } : 'daily';
    $('habit-delete-btn').classList.toggle('hidden', !h);
    syncHabitEditor();
    $('modal-habit').classList.remove('hidden');
  }

  function saveHabit() {
    var title = $('habit-title-input').value.trim();
    if (!title) { toast('先给它起个名字'); return; }
    var icon = $('habit-icon-input').value.trim() || '✅';
    try {
      if (editingHabitId) Store.updateHabit(editingHabitId, { title: title, icon: icon, freq: editFreq });
      else Store.addHabit({ title: title, icon: icon, freq: editFreq });
    } catch (e) {
      toast(e.message);
      return;
    }
    $('modal-habit').classList.add('hidden');
    flash('已保存');
    renderHabits();
    refreshBadge();
    if (window.refreshReminders) window.refreshReminders();
  }

  function deleteHabit() {
    if (!editingHabitId) return;
    if (!confirm('确定删除这个打卡计划吗？历史打卡记录会一并删除。')) return;
    Store.deleteHabit(editingHabitId);
    $('modal-habit').classList.add('hidden');
    toast('已删除');
    renderHabits();
    refreshBadge();
    if (window.refreshReminders) window.refreshReminders();
  }

  /* ==================== 初始化与事件绑定（只跑一次） ==================== */

  function init() {
    // 分段切换
    $('life-seg').addEventListener('click', function (e) {
      var btn = e.target.closest('.life-seg-btn');
      if (btn) setSegment(btn.getAttribute('data-mod'));
    });

    // 卡片：点击编辑、拖动后吞掉尾随 click；指示点直达
    $('day-track').addEventListener('click', function (e) {
      if (drag.suppressClick) return;
      var card = e.target.closest('.day-card');
      if (!card) return;
      var id = card.getAttribute('data-id');
      var ev = null;
      var events = Store.getDays().events;
      for (var i = 0; i < events.length; i++) {
        if (events[i].id === id) { ev = events[i]; break; }
      }
      openEventModal(ev);
    });
    $('day-dots').addEventListener('click', function (e) {
      var dot = e.target.closest('.day-dot');
      if (!dot) return;
      dayIdx = Number(dot.getAttribute('data-idx')) || 0;
      applyTrack(true);
      updateDots(cardCount);
    });
    bindSwipe();

    // 打卡列表：点圆圈打卡，点行编辑
    $('habit-list').addEventListener('click', function (e) {
      var row = e.target.closest('.habit-row');
      if (!row) return;
      var id = row.getAttribute('data-id');
      if (e.target.closest('[data-act="toggle"]')) {
        toggleHabit(id);
        return;
      }
      var habits = Store.getDays().habits;
      var h = null;
      for (var i = 0; i < habits.length; i++) {
        if (habits[i].id === id) { h = habits[i]; break; }
      }
      openHabitModal(h);
    });

    // 新增按钮与空状态
    $('add-event-btn').addEventListener('click', function () { openEventModal(null); });
    $('day-empty').addEventListener('click', function () { openEventModal(null); });
    $('add-habit-btn').addEventListener('click', function () { openHabitModal(null); });

    // 日子弹窗
    $('day-save-btn').addEventListener('click', saveEvent);
    $('day-cancel-btn').addEventListener('click', function () { $('modal-day').classList.add('hidden'); });
    $('day-delete-btn').addEventListener('click', deleteEvent);
    $('day-mode-toggle').addEventListener('click', function (e) {
      var btn = e.target.closest('.type-btn');
      if (btn) { editMode = btn.getAttribute('data-mode'); syncDayToggles(); }
    });
    $('day-repeat-toggle').addEventListener('click', function (e) {
      var btn = e.target.closest('.type-btn');
      if (btn) { editRepeat = btn.getAttribute('data-repeat'); syncDayToggles(); }
    });
    $('day-calendar-toggle').addEventListener('click', function (e) {
      var btn = e.target.closest('.type-btn');
      if (btn) { editCalendar = btn.getAttribute('data-calendar'); syncDayToggles(); }
    });
    $('day-date-input').addEventListener('change', updateLunarHint);
    $('day-share-btn').addEventListener('click', shareEventCard);
    $('day-remind-chips').addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      var key = chip.getAttribute('data-remind');
      editRemind[key] = !editRemind[key];
      // 选项全取消时至少保留"当天"，避免永远收不到提醒
      var any = false;
      for (var k in editRemind) {
        if (Object.prototype.hasOwnProperty.call(editRemind, k) && editRemind[k]) any = true;
      }
      if (!any) editRemind[0] = true;
      syncDayToggles();
    });
    $('day-color-chips').addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      editColor = chip.getAttribute('data-color') || '';
      syncDayToggles();
    });

    // 打卡弹窗
    $('habit-save-btn').addEventListener('click', saveHabit);
    $('habit-cancel-btn').addEventListener('click', function () { $('modal-habit').classList.add('hidden'); });
    $('habit-delete-btn').addEventListener('click', deleteHabit);
    $('habit-freq-toggle').addEventListener('click', function (e) {
      var btn = e.target.closest('.type-btn');
      if (!btn) return;
      editFreq = btn.getAttribute('data-freq') === 'weekly'
        ? (editFreq !== 'daily' ? editFreq : { type: 'weekly', times: 5 })
        : 'daily';
      syncHabitEditor();
    });
    $('habit-times-chips').addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      editFreq = { type: 'weekly', times: Number(chip.getAttribute('data-times')) || 5 };
      syncHabitEditor();
    });

    // 恢复上次所在分段（不落库的默认是"日子"）
    setSegment(loadSeg());
  }

  return {
    init: init,
    render: render,
    setSegment: setSegment,
    currentSeg: currentSeg,
    refreshBadge: refreshBadge,
    confettiHTML: confettiHTML       // 背单词完成页复用同一套撒花
  };
})();
