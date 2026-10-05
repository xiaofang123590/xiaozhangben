/**
 * alerts.js —— 通知注册表（首页通知中心的数据源）
 *
 * 各模块向 Alerts.register 登记一个收集器函数；collect() 汇总全部通知，
 * 按严重级排序（over 红 → warn 黄 → info 蓝）。未来新模块（背单词、饮食…）
 * 接入通知只需再加一个 register 调用，首页零改动。
 *
 * 通知对象形状：
 *   { id:'budget-over', level:'over'|'warn'|'info', icon:'warn',
 *     text:'本月已超支 ¥120', go:{ view:'budget', mod:'days' } }
 *   go.mod 可选：目标视图为 life 时指定分段（days/vocab/diet）。
 *
 * 依赖：core.js（Store）、days.js（Days）。不碰 DOM。
 */
var Alerts = (function () {
  'use strict';

  var collectors = [];                     // { name, fn }
  var LEVEL_RANK = { over: 0, warn: 1, info: 2 };

  /** 登记/替换一个收集器：fn() 返回通知数组（异常由 collect 统一吞掉） */
  function register(name, fn) {
    for (var i = 0; i < collectors.length; i++) {
      if (collectors[i].name === name) { collectors[i].fn = fn; return; }
    }
    collectors.push({ name: name, fn: fn });
  }

  /** 收集并排序全部通知；单个收集器出错不影响其它模块 */
  function collect() {
    var out = [];
    collectors.forEach(function (c) {
      try {
        var list = c.fn();
        if (Array.isArray(list)) {
          list.forEach(function (a) {
            if (a && a.text) {
              out.push({
                id: a.id || c.name,
                level: LEVEL_RANK[a.level] !== undefined ? a.level : 'info',
                icon: a.icon || 'bell',
                text: String(a.text),
                go: a.go || { view: 'home' }
              });
            }
          });
        }
      } catch (e) {
        console.warn('[alerts] 收集器 ' + c.name + ' 出错：', e);
      }
    });
    out.sort(function (a, b) { return LEVEL_RANK[a.level] - LEVEL_RANK[b.level]; });
    return out;
  }

  // ==================== 内置收集器（现有各模块的提醒） ====================

  /** 本月预算：超支红 / 达 80% 黄 */
  register('budget', function () {
    var s = Store.getBudgetStatus(Store.currentYm());
    if (s.level === 'over') {
      return [{ id: 'budget-over', level: 'over', icon: 'warn',
        text: '本月已超支 ¥' + Store.formatMoney(Math.abs(s.remaining)) + '，注意控制开销',
        go: { view: 'budget' } }];
    }
    if (s.level === 'warn') {
      return [{ id: 'budget-warn', level: 'warn', icon: 'warn',
        text: '本月预算已用 ' + s.usedPct + '%，剩余 ¥' + Store.formatMoney(s.remaining),
        go: { view: 'budget' } }];
    }
    return [];
  });

  /** 分类预算：超支红 / 达 80% 黄（最多取 3 条，避免刷屏） */
  register('catbudget', function () {
    var list = Store.getCategoryBudgetStatus(Store.currentYm()).filter(function (s) {
      return s.level !== 'ok';
    }).slice(0, 3);
    return list.map(function (s) {
      return {
        id: 'catbudget-' + s.categoryId,
        level: s.level === 'over' ? 'over' : 'warn',
        icon: 'budget',
        text: s.level === 'over'
          ? '「' + s.name + '」分类预算已超支 ¥' + Store.formatMoney(Math.abs(s.remaining))
          : '「' + s.name + '」预算已用 ' + s.usedPct + '%',
        go: { view: 'budget' }
      };
    });
  });

  /** 日子：今天有正日子（红）/ 落在提前提醒窗口（黄） */
  register('days', function () {
    var today = Store.todayStr();
    var out = [];
    Days.todayEvents(today).forEach(function (ev, i) {
      out.push({ id: 'day-today-' + i, level: 'over', icon: 'calendar-heart',
        text: '今天是「' + ev.title + '」', go: { view: 'life', mod: 'days' } });
    });
    Days.upcomingReminders(today).forEach(function (r) {
      out.push({ id: 'day-soon-' + r.ev.id, level: 'warn', icon: 'calendar-heart',
        text: '距离「' + r.ev.title + '」还有 ' + r.inDays + ' 天',
        go: { view: 'life', mod: 'days' } });
    });
    return out;
  });

  /** 打卡：今天还没打的计划（晚 8 点前蓝、之后黄） */
  register('habits', function () {
    var today = Store.todayStr();
    var hour = new Date().getHours();
    return Days.uncheckedHabits(today).slice(0, 3).map(function (h) {
      return {
        id: 'habit-' + h.id,
        level: hour >= 20 ? 'warn' : 'info',
        icon: 'check-circle',
        text: '「' + h.title + '」今天还没打卡',
        go: { view: 'life', mod: 'days' }
      };
    });
  });

  /** 记账：晚 8 点还没记账（黄，保持原有提醒窗口） */
  register('record', function () {
    var hour = new Date().getHours();
    if (hour < 20) return [];
    var today = Store.todayStr();
    var records = Store.getRecords();
    for (var i = 0; i < records.length; i++) {
      if (records[i].date === today) return [];
    }
    return [{ id: 'record-evening', level: 'warn', icon: 'notebook-pen',
      text: '今天还没有记账，花销别忘啦', go: { view: 'record' } }];
  });

  /** 背单词：今日还有待学任务（白天蓝、晚 8 点后黄） */
  register('vocab', function () {
    if (!window.Vocab || !window.VOCAB_DB) return [];
    var prev = Vocab.todayPreview();
    if (prev.total === 0) return [];
    var hour = new Date().getHours();
    return [{ id: 'vocab-today', level: hour >= 20 ? 'warn' : 'info', icon: 'graduation-cap',
      text: '今日还有 ' + prev.total + ' 个词待学',
      go: { view: 'life', mod: 'vocab' } }];
  });

  /** 备份：超过 7 天未导出（黄） */
  register('backup', function () {
    var b = Store.getLastBackupAt();
    if (!b) {
      return Store.getRecords().length
        ? [{ id: 'backup-never', level: 'warn', icon: 'export',
             text: '还没有导出过备份，建议立即导出一份', go: { view: 'manage' } }]
        : [];
    }
    var days = Math.floor((Date.now() - b) / 86400000);
    if (days >= 7) {
      return [{ id: 'backup-old', level: 'warn', icon: 'export',
        text: '已 ' + days + ' 天未备份，建议导出一份完整备份', go: { view: 'manage' } }];
    }
    return [];
  });

  return { register: register, collect: collect };
})();
