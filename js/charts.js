/**
 * charts.js —— 图表模块（基于 Chart.js v4 UMD，全局变量 Chart）
 *
 * 暴露全局对象 Charts，供 app.js 调用：
 *   Charts.renderCategoryPie(canvas, items, title?) 分类占比环形图
 *   Charts.renderDailyTrend(canvas, days)           每日趋势（支出/收入双系列）
 *   Charts.renderMonthlyTrend(canvas, months)       近 N 个月趋势（双系列）
 *   Charts.renderCalorieTrend(canvas, days, budget) 近 7 天热量柱状图（饮食页）
 *   Charts.renderLineTrend(canvas, rows)            近 N 天走势折线图（双系列）
 *   Charts.destroyAll()                             销毁本模块创建的所有图表实例
 *
 * 约定：不主动操作 DOM（仅使用调用方传入的 canvas 元素）；
 *       容器高度由 CSS（.chart-box 260px）控制，图表只负责自适应填充。
 */
(function () {
  'use strict';

  // ==================== 内部工具 ====================

  /** 浅色兜底色（读取 CSS 变量失败时使用） */
  var FALLBACK = { text: '#333', sub: '#999', grid: '#eee', surface: '#ffffff' };

  /** 系列颜色：支出橙 / 收入绿（透明度在柱色里控制） */
  var SERIES_EXPENSE = 'rgba(255,107,59,0.8)';
  var SERIES_EXPENSE_HOVER = 'rgba(255,107,59,1)';
  var SERIES_INCOME = 'rgba(0,181,120,0.8)';
  var SERIES_INCOME_HOVER = 'rgba(0,149,98,1)';

  /**
   * 读取当前主题色（跟随 body 上的 CSS 变量，深色模式自动生效）
   */
  function theme() {
    try {
      var s = getComputedStyle(document.body);
      return {
        text: (s.getPropertyValue('--text-main') || '').trim() || FALLBACK.text,
        sub: (s.getPropertyValue('--text-grey') || '').trim() || FALLBACK.sub,
        grid: (s.getPropertyValue('--line') || '').trim() || FALLBACK.grid,
        surface: (s.getPropertyValue('--surface') || '').trim() || FALLBACK.surface,
        primary: (s.getPropertyValue('--primary') || '').trim() || ''
      };
    } catch (e) {
      return FALLBACK;
    }
  }

  /** 主色（跟随当前风格色板）转 rgba；解析失败回退到内置收入绿 */
  function incomeColor(alpha) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(theme().primary || '');
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' +
             parseInt(h.slice(4, 6), 16) + ',' + alpha + ')';
    }
    return alpha >= 1 ? SERIES_INCOME_HOVER : SERIES_INCOME;
  }

  /** 系统默认字体族，保证中文正常显示 */
  var FONT_FAMILY = "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif";

  /**
   * 金额格式化：千分位 + 两位小数（负数保留负号）
   * @param {*} num 任意输入，非法值兜底为 0
   * @returns {string} 如 '1,234.50'
   */
  function formatMoney(num) {
    var n = Number(num);
    if (!isFinite(n)) {
      n = 0;
    }
    var negative = n < 0;
    var fixed = Math.abs(n).toFixed(2);          // 两位小数（取绝对值，负号单独处理）
    var parts = fixed.split('.');
    // 整数部分插入千分位逗号
    var intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (negative ? '-' : '') + intPart + '.' + parts[1];
  }

  /**
   * 日期标签转中文：'10-01' → '10月1日'（去前导零）
   * 无法解析时原样返回
   */
  function toChineseDate(label) {
    if (typeof label !== 'string') {
      return '';
    }
    var m = /^(\d{1,2})-(\d{1,2})$/.exec(label.trim());
    if (!m) {
      return label;
    }
    return parseInt(m[1], 10) + '月' + parseInt(m[2], 10) + '日';
  }

  /** 百分比格式化：保留 1 位小数并去掉多余的 .0 */
  function formatPercent(pct) {
    return String(Math.round(pct * 10) / 10);
  }

  /** 图表库是否就绪；未就绪时给出警告并让调用方安全返回 */
  function libReady() {
    if (typeof Chart === 'undefined') {
      console.warn('[charts] Chart.js 未加载（js/chart.umd.js），图表功能不可用');
      return false;
    }
    return true;
  }

  // ==================== 实例管理 ====================

  /** 本模块创建的所有 Chart 实例，key 为传入的 canvas 元素 */
  var instances = new Map();

  /** 销毁指定 canvas 上已存在的图表实例（重新渲染前调用，避免 "Canvas is already in use"） */
  function destroyChart(canvas) {
    var inst = instances.get(canvas);
    if (inst) {
      try {
        inst.destroy();
      } catch (e) {
        // 销毁失败不中断页面
        console.warn('[charts] 销毁图表实例失败：', e);
      }
      instances.delete(canvas);
    }
  }

  /** 清空画布（仅针对调用方传入的 canvas 参数使用） */
  function clearCanvas(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') {
      return;
    }
    try {
      var ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    } catch (e) {
      // 清空失败不中断页面
      console.warn('[charts] 清空画布失败：', e);
    }
  }

  // ==================== 环形图中心文本插件（内联插件，只作用于环形图） ====================

  /**
   * 在环形图环心绘制两行文本：
   *   第一行：'本月支出'（#999，12px）
   *   第二行：'¥' + 千分位格式总额（#333，加粗 18px）
   * 插件选项从 options.plugins.pieCenterText 读取。
   */
  var pieCenterTextPlugin = {
    id: 'pieCenterText',
    afterDraw: function (chart, args, opts) {
      if (!opts || !opts.amount) {
        return;
      }
      var meta = chart.getDatasetMeta(0);
      if (!meta || !meta.data || meta.data.length === 0) {
        return;
      }
      var arc = meta.data[0]; // 以第一个扇区的圆心作为环心
      if (!arc) {
        return;
      }
      var ctx = chart.ctx;
      var t = theme();
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // 第一行：小字“本月支出”
      ctx.font = '12px ' + FONT_FAMILY;
      ctx.fillStyle = t.sub;
      ctx.fillText(opts.title || '本月支出', arc.x, arc.y - 11);
      // 第二行：加粗总额
      ctx.font = 'bold 18px ' + FONT_FAMILY;
      ctx.fillStyle = t.text;
      ctx.fillText('¥' + opts.amount, arc.x, arc.y + 9);
      ctx.restore();
    }
  };

  // ==================== 公共配置 ====================

  /** 公共 options：容器高度由 CSS 控制，动画 300ms 即可 */
  function baseOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      font: { family: FONT_FAMILY }
    };
  }

  // ==================== 对外 API ====================

  var Charts = {};

  /**
   * 渲染「分类占比」环形图
   * @param {HTMLCanvasElement} canvas 画布元素
   * @param {Array<{name:string, value:number, color:string}>} items 分类数组
   * @param {string=} title 环心标题（如 '本月支出' / '本月收入'）
   */
  Charts.renderCategoryPie = function (canvas, items, title) {
    // 容错：图表库未加载时直接返回，绝不抛异常
    if (!libReady()) {
      return;
    }
    if (!canvas) {
      console.warn('[charts] renderCategoryPie：未传入 canvas');
      return;
    }
    items = Array.isArray(items) ? items : [];

    // 先销毁该画布上的旧实例（切换月份重绘时复用同一画布）
    destroyChart(canvas);

    // 空数据：只销毁并清空画布，不画任何东西
    if (items.length === 0) {
      clearCanvas(canvas);
      return;
    }

    // 清洗数据：value 兜底为数字，color 缺失时给默认色
    var data = items.map(function (it) {
      return {
        name: it && it.name ? String(it.name) : '未分类',
        value: Number(it && it.value) || 0,
        color: it && it.color ? it.color : '#999'
      };
    });

    // 本月总支出（用于中心文本与百分比计算）
    var total = 0;
    data.forEach(function (it) {
      total += it.value;
    });

    var t = theme();
    var config = {
      type: 'doughnut',
      data: {
        // 图例标签格式：名称 ¥金额
        labels: data.map(function (it) {
          return it.name + ' ¥' + formatMoney(it.value);
        }),
        datasets: [{
          data: data.map(function (it) {
            return it.value;
          }),
          backgroundColor: data.map(function (it) {
            return it.color;
          }),
          borderColor: t.surface,        // 扇区间 2px 分隔边框（跟随表面色）
          borderWidth: 2,
          hoverOffset: 4
        }]
      },
      options: (function () {
        var options = baseOptions();
        options.cutout = '58%';          // 环形中空比例
        options.plugins = {
          legend: {
            position: 'bottom',          // 图例放底部
            labels: {
              color: t.text,
              boxWidth: 12,
              padding: 10,
              font: { size: 12 }
            }
          },
          tooltip: {
            callbacks: {
              // 名称: ¥金额 (百分比%)
              label: function (ctx) {
                var it = data[ctx.dataIndex];
                if (!it) {
                  return '';
                }
                var pct = total > 0 ? (it.value / total) * 100 : 0;
                return it.name + ': ¥' + formatMoney(it.value) + ' (' + formatPercent(pct) + '%)';
              }
            }
          },
          // 中心文本插件选项
          pieCenterText: {
            title: title || '本月支出',
            amount: formatMoney(total)
          }
        };
        return options;
      })(),
      plugins: [pieCenterTextPlugin]     // 内联插件，仅作用于本图表
    };

    try {
      var chart = new Chart(canvas, config);
      instances.set(canvas, chart);
    } catch (e) {
      // 渲染失败不拖垮页面
      console.warn('[charts] 分类占比图渲染失败：', e);
      clearCanvas(canvas);
    }
  };

  /**
   * 构建双系列（支出/收入）柱状图配置
   * @param {Array<{label:string, expense:number, income:number}>} rows
   * @param {Object} opts { tooltipLabel: function(ctx, row) }
   */
  function dualBarConfig(rows, opts) {
    var t = theme();
    var hasIncome = rows.some(function (r) { return Number(r.income) > 0; });
    var datasets = [{
      label: '支出',
      data: rows.map(function (r) { return Number(r.expense) || 0; }),
      backgroundColor: SERIES_EXPENSE,
      hoverBackgroundColor: SERIES_EXPENSE_HOVER,
      borderRadius: 4,
      borderSkipped: false
    }];
    if (hasIncome) {
      datasets.push({
        label: '收入',
        data: rows.map(function (r) { return Number(r.income) || 0; }),
        backgroundColor: incomeColor(0.8),
        hoverBackgroundColor: incomeColor(1),
        borderRadius: 4,
        borderSkipped: false
      });
    }

    var options = baseOptions();
    options.plugins = {
      legend: {
        display: hasIncome,             // 只有支出时不显示图例
        position: 'top',
        labels: { color: t.text, boxWidth: 12, padding: 8, font: { size: 12 } }
      },
      tooltip: {
        callbacks: {
          title: function () { return ''; },
          label: function (ctx) {
            var row = rows[ctx.dataIndex];
            var head = opts && typeof opts.tooltipLabel === 'function'
              ? opts.tooltipLabel(row, ctx)
              : (row && row.label ? row.label : '');
            var kind = ctx.dataset.label === '收入' ? '收入' : '支出';
            return head + ' ' + kind + ': ¥' + formatMoney(ctx.parsed.y);
          }
        }
      }
    };
    options.scales = {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: t.sub,
          font: { size: 11 },
          autoSkip: true,
          maxTicksLimit: 12,
          maxRotation: 0,
          minRotation: 0
        }
      },
      y: {
        beginAtZero: true,
        grid: { color: t.grid, borderDash: [4, 4] },
        border: { display: false },
        ticks: {
          color: t.sub,
          font: { size: 11 },
          callback: function (value) { return '¥' + value; }
        }
      }
    };
    return { type: 'bar', data: { labels: rows.map(function (r) { return r.label; }), datasets: datasets }, options: options };
  }

  /**
   * 渲染「每日趋势」柱状图（支出/收入双系列，纯支出月自动退化为单系列）
   * @param {HTMLCanvasElement} canvas 画布元素
   * @param {Array<{label:string, expense:number, income:number}>} days 按日期升序
   */
  Charts.renderDailyTrend = function (canvas, days) {
    if (!libReady()) {
      return;
    }
    if (!canvas) {
      console.warn('[charts] renderDailyTrend：未传入 canvas');
      return;
    }
    days = Array.isArray(days) ? days : [];

    destroyChart(canvas);

    if (days.length === 0) {
      clearCanvas(canvas);
      return;
    }

    // 清洗数据（兼容旧 {label, value} 结构：value 视为支出）
    var rows = days.map(function (d) {
      return {
        label: d && d.label !== undefined ? String(d.label) : '',
        expense: Number(d && (d.expense !== undefined ? d.expense : d.value)) || 0,
        income: Number(d && d.income) || 0
      };
    });

    try {
      var chart = new Chart(canvas, dualBarConfig(rows, {
        tooltipLabel: function (row) { return toChineseDate(row.label); }
      }));
      instances.set(canvas, chart);
    } catch (e) {
      console.warn('[charts] 每日趋势图渲染失败：', e);
      clearCanvas(canvas);
    }
  };

  /**
   * 渲染「近 N 个月」柱状图（支出/收入双系列）
   * @param {HTMLCanvasElement} canvas 画布元素
   * @param {Array<{ym:string, label:string, expense:number, income:number}>} months 升序
   */
  Charts.renderMonthlyTrend = function (canvas, months) {
    if (!libReady()) {
      return;
    }
    if (!canvas) {
      console.warn('[charts] renderMonthlyTrend：未传入 canvas');
      return;
    }
    months = Array.isArray(months) ? months : [];

    destroyChart(canvas);

    if (months.length === 0) {
      clearCanvas(canvas);
      return;
    }

    var rows = months.map(function (m) {
      return {
        label: m && m.label !== undefined ? String(m.label) : (m && m.ym ? m.ym : ''),
        expense: Number(m && m.expense) || 0,
        income: Number(m && m.income) || 0
      };
    });

    try {
      var chart = new Chart(canvas, dualBarConfig(rows, {
        tooltipLabel: function (row) {
          var m = /^(\d{1,4})-(\d{1,2})$/.exec(row.label);
          return m ? (parseInt(m[1], 10) + '年' + parseInt(m[2], 10) + '月') : row.label;
        }
      }));
      instances.set(canvas, chart);
    } catch (e) {
      console.warn('[charts] 月度趋势图渲染失败：', e);
      clearCanvas(canvas);
    }
  };

  /**
   * 渲染「近 N 天走势」折线图（支出/收入双系列，纯支出时单系列）
   * @param {HTMLCanvasElement} canvas 画布元素
   * @param {Array<{label:string, expense:number, income:number}>} rows 按日期升序
   */
  Charts.renderLineTrend = function (canvas, rows) {
    if (!libReady()) {
      return;
    }
    if (!canvas) {
      console.warn('[charts] renderLineTrend：未传入 canvas');
      return;
    }
    rows = Array.isArray(rows) ? rows : [];

    destroyChart(canvas);

    if (rows.length === 0) {
      clearCanvas(canvas);
      return;
    }

    var t = theme();
    var hasIncome = rows.some(function (r) { return Number(r.income) > 0; });
    var datasets = [{
      label: '支出',
      data: rows.map(function (r) { return Number(r.expense) || 0; }),
      borderColor: SERIES_EXPENSE_HOVER,
      backgroundColor: 'rgba(255,107,59,0.12)',
      fill: true,
      tension: 0.35,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointBackgroundColor: SERIES_EXPENSE_HOVER
    }];
    if (hasIncome) {
      datasets.push({
        label: '收入',
        data: rows.map(function (r) { return Number(r.income) || 0; }),
        borderColor: incomeColor(1),
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.35,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointBackgroundColor: incomeColor(1)
      });
    }

    var options = baseOptions();
    options.interaction = { mode: 'index', intersect: false };
    options.plugins = {
      legend: {
        display: hasIncome,
        position: 'top',
        labels: { color: t.text, boxWidth: 12, padding: 8, font: { size: 12 } }
      },
      tooltip: {
        callbacks: {
          title: function (items) {
            var row = rows[items[0] && items[0].dataIndex];
            return row ? toChineseDate(row.label) : '';
          },
          label: function (ctx) {
            var kind = ctx.dataset.label === '收入' ? '收入' : '支出';
            return kind + ': ¥' + formatMoney(ctx.parsed.y);
          }
        }
      }
    };
    options.scales = {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: t.sub,
          font: { size: 11 },
          autoSkip: true,
          maxTicksLimit: 8,
          maxRotation: 0,
          minRotation: 0
        }
      },
      y: {
        beginAtZero: true,
        grid: { color: t.grid, borderDash: [4, 4] },
        border: { display: false },
        ticks: {
          color: t.sub,
          font: { size: 11 },
          callback: function (value) { return '¥' + value; }
        }
      }
    };

    try {
      var chart = new Chart(canvas, { type: 'line', data: { labels: rows.map(function (r) { return r.label; }), datasets: datasets }, options: options });
      instances.set(canvas, chart);
    } catch (e) {
      console.warn('[charts] 走势折线图渲染失败：', e);
      clearCanvas(canvas);
    }
  };

  /**
   * 渲染「近 7 天热量」柱状图（饮食页专用，单位千卡）。
   * 有预算时按当日摄入占比着色：<80% 绿 / 80%~105% 橙 / >105% 红；
   * 无预算时全部主题绿。空数据只清空画布（空态由调用方控制提示文案）。
   * @param {HTMLCanvasElement} canvas 画布元素
   * @param {Array<{label:string, kcal:number, tip:string}>} days 按日期升序，
   *        label 为 x 轴短标签（如 '10-02'），tip 为悬浮提示全文
   * @param {number=} budget 每日热量预算（用于着色，缺省/非法视为无预算）
   */
  Charts.renderCalorieTrend = function (canvas, days, budget) {
    if (!libReady()) {
      return;
    }
    if (!canvas) {
      console.warn('[charts] renderCalorieTrend：未传入 canvas');
      return;
    }
    days = Array.isArray(days) ? days : [];
    var b = Number(budget);
    var hasBudget = isFinite(b) && b > 0;

    destroyChart(canvas);

    if (days.length === 0) {
      clearCanvas(canvas);
      return;
    }

    var rows = days.map(function (d) {
      return {
        label: d && d.label !== undefined ? String(d.label) : '',
        kcal: Number(d && d.kcal) || 0,
        tip: d && d.tip ? String(d.tip) : ''
      };
    });

    var GREEN = incomeColor(0.8);   // 健康档跟随当前主题色，橙/红保持语义警示色
    var ORANGE = 'rgba(255, 152, 0, 0.85)';
    var RED = 'rgba(250, 81, 81, 0.85)';
    var colors = rows.map(function (r) {
      if (!hasBudget) return GREEN;
      var pct = r.kcal / b;
      if (pct > 1.05) return RED;
      if (pct >= 0.8) return ORANGE;
      return GREEN;
    });

    var t = theme();
    var options = baseOptions();
    options.plugins = {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: function () { return ''; },
          label: function (ctx) {
            var row = rows[ctx.dataIndex];
            return row.tip || (row.label + ' ' + row.kcal + ' 千卡');
          }
        }
      }
    };
    options.scales = {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: t.sub, font: { size: 11 }, maxRotation: 0, minRotation: 0 }
      },
      y: {
        beginAtZero: true,
        grid: { color: t.grid, borderDash: [4, 4] },
        border: { display: false },
        ticks: {
          color: t.sub,
          font: { size: 11 },
          callback: function (value) { return value; }
        }
      }
    };

    var config = {
      type: 'bar',
      data: {
        labels: rows.map(function (r) { return r.label; }),
        datasets: [{
          label: '热量',
          data: rows.map(function (r) { return r.kcal; }),
          backgroundColor: colors,
          hoverBackgroundColor: colors,
          borderRadius: 4,
          borderSkipped: false
        }]
      },
      options: options
    };

    try {
      var chart = new Chart(canvas, config);
      instances.set(canvas, chart);
    } catch (e) {
      console.warn('[charts] 热量趋势图渲染失败：', e);
      clearCanvas(canvas);
    }
  };

  /**
   * 销毁本模块创建的所有 Chart 实例（切换页面时由 app.js 调用）
   */
  Charts.destroyAll = function () {
    instances.forEach(function (inst) {
      try {
        inst.destroy();
      } catch (e) {
        // 销毁失败不中断页面
        console.warn('[charts] destroyAll 销毁实例失败：', e);
      }
    });
    instances.clear();
  };

  // 挂载到全局，供 app.js 使用
  window.Charts = Charts;
})();
