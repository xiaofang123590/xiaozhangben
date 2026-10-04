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
  var editRemind = {};            // 弹窗当前提醒档 {0:true,1:false,...}
  var editColor = '';             // 弹窗当前颜色（'' = 跟随主题）

  /** 卡片滑动手势状态 */
  var drag = { active: false, dragging: false, pointerId: -1,
    startX: 0, startY: 0, dx: 0, width: 1, suppressClick: false };

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
      return v === 'vocab' ? 'vocab' : 'days';
    } catch (e) { return 'days'; }
  }

  function saveSeg() {
    try { localStorage.setItem(segKey(), currentMod); } catch (e) { /* 忽略 */ }
  }

  /** 当前分段（app.js 记滚动位置用） */
  function currentSeg() { return currentMod; }

  /** 切分段：不跳页，内容原地替换；--life-seg 驱动滑动胶囊 */
  function setSegment(mod) {
    if (mod !== 'days' && mod !== 'vocab') mod = 'days';
    currentMod = mod;
    $('life-days').classList.toggle('hidden', mod !== 'days');
    $('life-vocab').classList.toggle('hidden', mod !== 'vocab');
    var seg = $('life-seg');
    seg.style.setProperty('--life-seg', mod === 'vocab' ? '1' : '0');
    var btns = seg.querySelectorAll('.life-seg-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-mod') === mod);
    }
    saveSeg();
    render();
  }

  /* ==================== 日子：卡片切换器 ==================== */

  function cardHTML(ev, today) {
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
    if (ev.pinned) {
      tags += '<span class="day-card-tag">' + Icons.svg('pin', 'ic-sm') + '置顶</span>';
    }

    return '<div class="day-card' + (c.today ? ' today' : '') + '" data-id="' + ev.id + '"' + style + '>' +
      '<div class="day-card-top">' +
        '<span class="day-card-icon">' + esc(ev.icon || '📅') + '</span>' +
        '<span class="day-card-title">' + esc(ev.title) + '</span>' +
        '<span class="day-card-date">' + esc(ev.date) + '</span>' +
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

  /** 把轨道摆到 dayIdx 的位置；animate=false 用于重绘后直接落位 */
  function applyTrack(animate) {
    var track = $('day-track');
    if (!track) return;
    track.classList.toggle('anim', !!animate);
    track.style.transform = 'translateX(' + (-dayIdx * 90) + '%)';
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

    track.innerHTML = events.map(function (ev) { return cardHTML(ev, today); }).join('');
    updateDots(cardCount);
    applyTrack(false);
  }

  /* ==================== 日子：打卡计划 ==================== */

  function habitRowHTML(h, today) {
    var streak = Days.habitStreak(h, today);
    var last7 = Days.habitLast7(h, today);
    var done = !!h.records[today];
    var dots = last7.map(function (on) {
      return '<i class="' + (on ? 'on' : '') + '"></i>';
    }).join('');
    return '<div class="habit-row" data-id="' + h.id + '">' +
      '<span class="habit-icon">' + esc(h.icon || '✅') + '</span>' +
      '<span class="habit-main">' +
        '<span class="habit-title">' + esc(h.title) + '</span>' +
        '<span class="habit-meta">' +
          '<span class="habit-streak' + (streak > 0 ? '' : ' zero') + '">' +
            Icons.svg('flame', 'ic-sm') + streak + ' 天</span>' +
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
    if (nowDone) flash('已打卡 ✓');
    else toast('已撤销打卡');
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
    var remindChips = document.querySelectorAll('#day-remind-chips .chip');
    for (var k = 0; k < remindChips.length; k++) {
      remindChips[k].classList.toggle('active', !!editRemind[remindChips[k].getAttribute('data-remind')]);
    }
    var colorChips = document.querySelectorAll('#day-color-chips .chip');
    for (var m = 0; m < colorChips.length; m++) {
      colorChips[m].classList.toggle('active', (colorChips[m].getAttribute('data-color') || '') === editColor);
    }
  }

  function openEventModal(ev) {
    editingEventId = ev ? ev.id : null;
    $('modal-day-title').textContent = ev ? '编辑日子' : '新建纪念日 / 倒计时';
    $('day-title-input').value = ev ? ev.title : '';
    $('day-date-input').value = ev ? ev.date : Store.todayStr();
    editMode = ev && ev.mode === 'countup' ? 'countup' : 'countdown';
    editRepeat = ev && ev.repeat === 'yearly' ? 'yearly' : 'none';
    editColor = ev && ev.color ? ev.color : '';
    editRemind = {};
    var remind = (ev && Array.isArray(ev.remindDays) && ev.remindDays.length) ? ev.remindDays : [0];
    remind.forEach(function (d) { editRemind[d] = true; });
    $('day-icon-input').value = ev ? (ev.icon || '') : '';
    $('day-note-input').value = ev ? (ev.note || '') : '';
    $('day-delete-btn').classList.toggle('hidden', !ev);
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
    var payload = {
      title: title,
      date: date,
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

  function openHabitModal(h) {
    editingHabitId = h ? h.id : null;
    $('modal-habit-title').textContent = h ? '编辑打卡计划' : '新增打卡计划';
    $('habit-title-input').value = h ? h.title : '';
    $('habit-icon-input').value = h ? (h.icon || '') : '';
    $('habit-delete-btn').classList.toggle('hidden', !h);
    $('modal-habit').classList.remove('hidden');
  }

  function saveHabit() {
    var title = $('habit-title-input').value.trim();
    if (!title) { toast('先给它起个名字'); return; }
    var icon = $('habit-icon-input').value.trim() || '✅';
    try {
      if (editingHabitId) Store.updateHabit(editingHabitId, { title: title, icon: icon });
      else Store.addHabit({ title: title, icon: icon });
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

  /* ==================== 卡片滑动手势 ==================== */

  function bindSwipe() {
    var stage = $('day-stage');
    var track = $('day-track');

    stage.addEventListener('pointerdown', function (e) {
      if (e.isPrimary === false || cardCount < 2) return;
      drag.active = true;
      drag.dragging = false;
      drag.pointerId = e.pointerId;
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.dx = 0;
      drag.width = stage.clientWidth || 1;
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
      // 边缘阻尼：第一张往右 / 最后一张往左时给 1/3 手感
      var eff = dx;
      if ((dayIdx === 0 && dx > 0) || (dayIdx === cardCount - 1 && dx < 0)) eff = dx / 3;
      var base = -dayIdx * 0.9 * drag.width;
      track.style.transform = 'translateX(' + (base + eff) + 'px)';
    });

    function end(e) {
      if (!drag.active || (e && e.pointerId !== drag.pointerId)) return;
      drag.active = false;
      if (!drag.dragging) return;
      drag.dragging = false;
      stage.classList.remove('dragging');
      var threshold = drag.width * 0.16;
      if (drag.dx <= -threshold && dayIdx < cardCount - 1) dayIdx += 1;
      else if (drag.dx >= threshold && dayIdx > 0) dayIdx -= 1;
      drag.suppressClick = true;
      setTimeout(function () { drag.suppressClick = false; }, 300);
      applyTrack(true);
      updateDots(cardCount);
    }
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
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

    // 恢复上次所在分段（不落库的默认是"日子"）
    setSegment(loadSeg());
  }

  return {
    init: init,
    render: render,
    setSegment: setSegment,
    currentSeg: currentSeg,
    refreshBadge: refreshBadge
  };
})();
