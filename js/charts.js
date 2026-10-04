/**
 * charts.js —— 图表模块（基于 Chart.js v4 UMD，全局变量 Chart）
 *
 * 暴露全局对象 Charts，供 app.js 调用：
 *   Charts.renderCategoryPie(canvas, items, opts)   分类占比环形图
 *       opts: { title?, count?, kind? }  环心三行文本：标题 / 金额 / 笔数
 *   Charts.renderDailyTrend(canvas, days)           每日趋势（支出/收入双系列）
 *   Charts.renderMonthlyTrend(canvas, months)       近 N 个月趋势（双系列）
 *   Charts.renderCalorieTrend(canvas, days, budget) 近 7 天热量柱状图（饮食页，含预算参考线）
 *   Charts.renderLineTrend(canvas, rows)            近 N 天走势折线图（双系列）
 *   Charts.destroyAll()                             销毁本模块创建的所有图表实例
 *
 * 设计约定（与全站视觉一致）：
 *   1. 颜色一律从 CSS 变量读取（主题色板 × 明暗模式自动跟随），不写死色值；
 *      系列色用语义 token：--chart-expense（支出）、--positive（收入）、
 *      --chart-warn / --danger（热量档位），换色板不会让"支出/收入"变样。
 *   2. 去网格：横向网格线全部关掉，只留 x 轴基线；刻度最多 4 档、金额过万折成"万"。
 *   3. 柱状：圆角柱 + 上浓下淡的竖向渐变；折线：平滑曲线 + 面渐变 + 末点高亮。
 *   4. 数据浮层是 HTML 卡片（.chart-tip，跟随手指），不是 canvas 内置 tooltip，
 *      因此能用上等宽数字与站内排版；文案由各图表自己的 tipRows 构造。
 *   5. 只使用调用方传入的 canvas；浮层元素是本模块自己的单例（懒创建 + 滚动即隐藏）。
 */
(function () {
  'use strict';

  // ==================== 内部工具 ====================

  /** 读取 CSS 变量失败时的兜底色（浅色主题） */
  var FALLBACK = {
    text: '#333333', sub: '#6E7973', line: '#E4ECE7', surface: '#FFFFFF',
    expense: '#F0663C', income: '#0C8049', warn: '#FF9A2E', danger: '#FA5151'
  };

  /** 系统默认字体族，保证中文正常显示 */
  var FONT_FAMILY = "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif";

  /** 读一个 CSS 变量并去掉首尾空白 */
  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.body).getPropertyValue(name);
      v = (v || '').trim();
      return v || fallback;
    } catch (e) {
      return fallback;
    }
  }

  /** 当前主题色（跟随 body 上的 CSS 变量，深浅模式与八套色板自动生效） */
  function theme() {
    return {
      text: cssVar('--text-main', FALLBACK.text),
      sub: cssVar('--text-grey', FALLBACK.sub),
      line: cssVar('--line', FALLBACK.line),
      surface: cssVar('--surface', FALLBACK.surface),
      expense: cssVar('--chart-expense', FALLBACK.expense),
      income: cssVar('--positive', FALLBACK.income),
      warn: cssVar('--chart-warn', FALLBACK.warn),
      danger: cssVar('--danger', FALLBACK.danger)
    };
  }

  /**
   * 给颜色加透明度：支持 #RGB / #RRGGBB / rgb() / rgba()
   * 其它写法（关键字、color-mix 等）原样返回，不影响可用性
   */
  function withAlpha(color, alpha) {
    var c = String(color == null ? '' : color).trim();
    var hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(c);
    if (hex) {
      var h = hex[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' +
             parseInt(h.slice(4, 6), 16) + ',' + alpha + ')';
    }
    var rgb = /^rgba?\(([^)]+)\)$/i.exec(c);
    if (rgb) {
      var p = rgb[1].split(',');
      return 'rgba(' + p[0].trim() + ',' + (p[1] || '0').trim() + ',' + (p[2] || '0').trim() + ',' + alpha + ')';
    }
    return c;
  }

  /**
   * 竖向渐变（柱体/折线面积用）。Chart.js 的 scriptable 选项里调用：
   *   backgroundColor: function (context) { return vGradient(context, color, 1, 0.5); }
   * chartArea 尚未就绪时（首帧）退回纯色，避免抛异常。
   */
  function vGradient(context, color, topAlpha, bottomAlpha) {
    var area = context && context.chart && context.chart.chartArea;
    if (!area) return withAlpha(color, topAlpha);
    var g = context.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, withAlpha(color, topAlpha));
    g.addColorStop(1, withAlpha(color, bottomAlpha));
    return g;
  }

  /** HTML 转义（浮层文案里有用户填的分类名/备注） */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

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
    var intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (negative ? '-' : '') + intPart + '.' + parts[1];
  }

  /** 坐标轴上的紧凑金额：过万折成"万"，避免刻度互相挤压（12000 → 1.2万） */
  function compactMoney(v) {
    var n = Number(v) || 0;
    var abs = Math.abs(n);
    if (abs >= 100000) return (n / 10000).toFixed(0) + '万';
    if (abs >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    return String(Math.round(n));
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

  // ==================== 数据浮层（HTML 卡片，替代 canvas 内置 tooltip） ====================

  /** 浮层元素：全模块共用一个，懒创建（不污染调用方的 DOM 结构） */
  var tipEl = null;

  function tipElement() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'chart-tip hidden';
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }

  /** 隐藏浮层（图表销毁、页面滚动时调用，避免浮层留在屏幕上） */
  function hideTip() {
    if (tipEl) {
      tipEl.classList.add('hidden');
    }
  }

  /**
   * Chart.js 的 external 处理器：把 tooltip 模型画成一张 HTML 卡片。
   * 文案取自 chart.$tipRows（各图表创建时挂上的构造函数），
   * 缺省时退化为「标题 + 每行 body 文本」。
   */
  function externalTooltip(context) {
    var chart = context.chart;
    var model = context.tooltip;
    var el = tipElement();

    if (!model || model.opacity === 0 || !model.dataPoints || model.dataPoints.length === 0) {
      el.classList.add('hidden');
      return;
    }

    var view = null;
    try {
      view = chart.$tipRows ? chart.$tipRows(model) : null;
    } catch (e) {
      view = null;
    }
    if (!view) {
      var lines = [];
      for (var i = 0; i < (model.body || []).length; i++) {
        var ls = model.body[i].lines || [];
        for (var j = 0; j < ls.length; j++) {
          lines.push({ color: (model.labelColors[i] || {}).backgroundColor, label: ls[j], value: '' });
        }
      }
      view = { title: (model.title || [])[0] || '', rows: lines };
    }

    var html = view.title ? '<div class="chart-tip-title">' + esc(view.title) + '</div>' : '';
    for (var k = 0; k < view.rows.length; k++) {
      var r = view.rows[k];
      html += '<div class="chart-tip-row">' +
        (r.color ? '<span class="chart-tip-dot" style="background:' + esc(r.color) + '"></span>' : '') +
        '<span class="chart-tip-label">' + esc(r.label) + '</span>' +
        (r.value ? '<span class="chart-tip-value">' + esc(r.value) + '</span>' : '') +
        '</div>';
    }
    el.innerHTML = html;
    el.classList.remove('hidden');

    // 定位：以手指/光标位置为基准，优先放在上方，顶部放不下就翻到下方
    var rect = chart.canvas.getBoundingClientRect();
    var x = rect.left + model.caretX;
    var y = rect.top + model.caretY;
    var w = el.offsetWidth;
    var h = el.offsetHeight;
    var half = w / 2;
    x = Math.max(half + 8, Math.min(window.innerWidth - half - 8, x));
    if (y - 14 - h < 8) {
      el.classList.add('below');
      el.style.left = x + 'px';
      el.style.top = (y + 20) + 'px';
    } else {
      el.classList.remove('below');
      el.style.left = x + 'px';
      el.style.top = (y - 14) + 'px';
    }
  }

  // 滚动时浮层会与图表脱节（fixed 定位），挂到真正的滚动容器上收起来。
  // 注意：不能用 document 捕获所有 scroll —— 洞察卡轮播之类的横向滚动
  // 每几秒就冒一次泡，会把正在看的浮层误关掉。
  (function bindScrollHide() {
    function bind() {
      var main = document.getElementById('app-main');
      if (main) {
        main.addEventListener('scroll', hideTip, { passive: true });
      }
      window.addEventListener('scroll', hideTip, { passive: true });
    }
    if (document.body) bind();
    else document.addEventListener('DOMContentLoaded', bind);
  })();

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
    hideTip();
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

  // ==================== 环形图中心文本插件 ====================

  /**
   * 在环心绘制三行文本（标题 / 金额 / 笔数），字号与颜色取自当前主题。
   * 选项从 options.plugins.pieCenterText 读取：{ title, amount, count }
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
      var arc = meta.data[0];  // 以第一个扇区的圆心作为环心
      if (!arc) {
        return;
      }
      var t = theme();
      var ctx = chart.ctx;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (opts.title) {
        ctx.font = '12px ' + FONT_FAMILY;
        ctx.fillStyle = t.sub;
        ctx.fillText(opts.title, arc.x, arc.y - 20);
      }
      ctx.font = '700 21px ' + FONT_FAMILY;
      ctx.fillStyle = t.text;
      ctx.fillText('¥' + opts.amount, arc.x, arc.y + 1);
      if (opts.count) {
        ctx.font = '12px ' + FONT_FAMILY;
        ctx.fillStyle = t.sub;
        ctx.fillText(opts.count, arc.x, arc.y + 21);
      }
      ctx.restore();
    }
  };

  // ==================== 参考线插件（热量图的每日预算） ====================

  /** 在 y = value 处画一条虚线参考线，并标注文字（选项：{ value, label, color }） */
  var refLinePlugin = {
    id: 'refLine',
    afterDatasetsDraw: function (chart, args, opts) {
      var value = opts && Number(opts.value);
      if (!isFinite(value) || value <= 0) {
        return;
      }
      var yScale = chart.scales && chart.scales.y;
      var area = chart.chartArea;
      if (!yScale || !area) {
        return;
      }
      var y = yScale.getPixelForValue(value);
      if (y < area.top || y > area.bottom) {
        return;                       // 参考线落在可视区之外就不画
      }
      var ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = withAlpha(opts.color, 0.7);
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(area.left, y);
      ctx.lineTo(area.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '11px ' + FONT_FAMILY;
      ctx.fillStyle = opts.color;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(opts.label || '预算', area.right - 2, y - 4);
      ctx.restore();
    }
  };

  // ==================== 公共配置 ====================

  /** 公共 options：容器高度由 CSS 控制；动画稍长一点，让柱体"长起来" */
  function baseOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 520, easing: 'easeOutQuart' },
      layout: { padding: { top: 8, right: 6, bottom: 2, left: 2 } },
      font: { family: FONT_FAMILY }
    };
  }

  /**
   * 直角坐标系公共尺度：关掉全部横向网格，只留 x 轴基线
   * @param {number} xTicks x 轴最多显示多少个刻度
   */
  function baseScales(t, xTicks) {
    return {
      x: {
        grid: { display: false },
        border: { display: true, color: t.line, width: 1 },   // 只保留这条基线
        ticks: {
          color: t.sub,
          font: { size: 11 },
          padding: 6,
          autoSkip: true,
          maxTicksLimit: xTicks,
          maxRotation: 0,
          minRotation: 0
        }
      },
      y: {
        beginAtZero: true,
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: t.sub,
          font: { size: 11 },
          padding: 6,
          maxTicksLimit: 4,
          callback: function (value) { return '¥' + compactMoney(value); }
        }
      }
    };
  }

  /** 圆形图例点（支出/收入两系列共用），避免默认的方块色块 */
  function legendConfig(t, show) {
    return {
      display: !!show,
      position: 'top',
      align: 'end',
      labels: {
        color: t.sub,
        usePointStyle: true,
        pointStyle: 'circle',
        boxWidth: 7,
        boxHeight: 7,
        padding: 14,
        font: { size: 12 }
      }
    };
  }

  /** tooltip 公共部分：关掉 canvas 内置绘制，改走 HTML 浮层 */
  function tooltipConfig(mode, intersect) {
    return {
      enabled: false,
      external: externalTooltip,
      mode: mode || 'nearest',
      intersect: intersect === undefined ? false : intersect
    };
  }

  // ==================== 对外 API ====================

  var Charts = {};

  /**
   * 渲染「分类占比」环形图（圆角扇区 + 环心总额/笔数；图例由调用方用 HTML 渲染）
   * @param {HTMLCanvasElement} canvas 画布元素
   * @param {Array<{name:string, value:number, color:string}>} items 分类数组
   * @param {{title?:string, count?:string, kind?:string}=} opts 环心文案；传字符串等价于 {title}
   */
  Charts.renderCategoryPie = function (canvas, items, opts) {
    if (!libReady()) {
      return;
    }
    if (!canvas) {
      console.warn('[charts] renderCategoryPie：未传入 canvas');
      return;
    }
    items = Array.isArray(items) ? items : [];
    if (typeof opts === 'string') {
      opts = { title: opts };          // 兼容旧签名 (canvas, items, title)
    }
    opts = opts || {};

    destroyChart(canvas);

    if (items.length === 0) {
      clearCanvas(canvas);
      return;
    }

    var data = items.map(function (it) {
      return {
        name: it && it.name ? String(it.name) : '未分类',
        value: Number(it && it.value) || 0,
        color: it && it.color ? it.color : '#999'
      };
    });

    var total = 0;
    data.forEach(function (it) {
      total += it.value;
    });

    var t = theme();
    var config = {
      type: 'doughnut',
      data: {
        labels: data.map(function (it) { return it.name; }),
        datasets: [{
          data: data.map(function (it) { return it.value; }),
          backgroundColor: data.map(function (it) { return it.color; }),
          hoverBackgroundColor: data.map(function (it) { return it.color; }),
          borderWidth: 0,
          spacing: 2,                 // 扇区之间留缝（用卡片底色当分隔）
          borderRadius: 6,            // 圆角扇区
          hoverOffset: 6
        }]
      },
      options: (function () {
        var options = baseOptions();
        options.cutout = '66%';       // 内径加大，给环心三行文本让位
        options.plugins = {
          legend: { display: false },                        // 图例改由页面用 HTML 渲染
          tooltip: tooltipConfig('nearest', true),
          pieCenterText: {
            title: opts.title || '本月支出',
            amount: formatMoney(total),
            count: opts.count || ''
          }
        };
        return options;
      })(),
      plugins: [pieCenterTextPlugin]
    };

    try {
      var chart = new Chart(canvas, config);
      // 浮层文案：分类名 + 金额 + 占比
      chart.$tipRows = function (model) {
        var i = model.dataPoints[0].dataIndex;
        var it = data[i];
        if (!it) return null;
        var pct = total > 0 ? (it.value / total) * 100 : 0;
        return {
          title: it.name,
          rows: [
            { color: it.color, label: '金额', value: '¥' + formatMoney(it.value) },
            { label: '占比', value: formatPercent(pct) + '%' }
          ]
        };
      };
      instances.set(canvas, chart);
    } catch (e) {
      console.warn('[charts] 分类占比图渲染失败：', e);
      clearCanvas(canvas);
    }
  };

  /**
   * 构建双系列（支出/收入）柱状图配置
   * @param {Array<{label:string, expense:number, income:number}>} rows
   * @param {Object} opts { tipTitle: function(row), tipLabel: function(row) }
   */
  function dualBarConfig(rows, opts) {
    var t = theme();
    var hasIncome = rows.some(function (r) { return Number(r.income) > 0; });
    var datasets = [{
      label: '支出',
      data: rows.map(function (r) { return Number(r.expense) || 0; }),
      backgroundColor: function (context) { return vGradient(context, t.expense, 1, 0.45); },
      hoverBackgroundColor: t.expense,
      borderColor: t.expense,            // 图例圆点取这个色
      borderWidth: 0,
      borderRadius: 6,
      maxBarThickness: 26,
      barPercentage: 0.74,
      categoryPercentage: 0.7
    }];
    if (hasIncome) {
      datasets.push({
        label: '收入',
        data: rows.map(function (r) { return Number(r.income) || 0; }),
        backgroundColor: function (context) { return vGradient(context, t.income, 1, 0.45); },
        hoverBackgroundColor: t.income,
        borderColor: t.income,
        borderWidth: 0,
        borderRadius: 6,
        maxBarThickness: 26,
        barPercentage: 0.74,
        categoryPercentage: 0.7
      });
    }

    var options = baseOptions();
    options.interaction = { mode: 'index', intersect: false };
    options.plugins = {
      legend: legendConfig(t, hasIncome),      // 只有支出时不显示图例
      tooltip: tooltipConfig('index', false)
    };
    options.scales = baseScales(t, 12);
    return {
      type: 'bar',
      data: { labels: rows.map(function (r) { return r.label; }), datasets: datasets },
      options: options,
      tip: {
        title: function (row) { return opts && opts.tipTitle ? opts.tipTitle(row) : (row ? row.label : ''); },
        rows: function (row) {
          if (!row) return [];
          var out = [{ color: t.expense, label: '支出', value: '¥' + formatMoney(row.expense) }];
          if (hasIncome) out.push({ color: t.income, label: '收入', value: '¥' + formatMoney(row.income) });
          return out;
        }
      }
    };
  }

  /** 把双系列柱状图的配置渲染出来（含浮层文案挂载） */
  function renderDualBar(canvas, days, opts) {
    destroyChart(canvas);
    if (days.length === 0) {
      clearCanvas(canvas);
      return;
    }
    var rows = days;
    var config = dualBarConfig(rows, opts);
    var tip = config.tip;
    delete config.tip;
    try {
      var chart = new Chart(canvas, config);
      chart.$tipRows = function (model) {
        var row = rows[model.dataPoints[0].dataIndex];
        return { title: tip.title(row), rows: tip.rows(row) };
      };
      instances.set(canvas, chart);
    } catch (e) {
      console.warn('[charts] 柱状图渲染失败：', e);
      clearCanvas(canvas);
    }
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

    // 清洗数据（兼容旧 {label, value} 结构：value 视为支出）
    var rows = days.map(function (d) {
      return {
        label: d && d.label !== undefined ? String(d.label) : '',
        expense: Number(d && (d.expense !== undefined ? d.expense : d.value)) || 0,
        income: Number(d && d.income) || 0
      };
    });

    renderDualBar(canvas, rows, { tipTitle: function (row) { return toChineseDate(row.label); } });
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

    var rows = months.map(function (m) {
      return {
        label: m && m.label !== undefined ? String(m.label) : (m && m.ym ? m.ym : ''),
        expense: Number(m && m.expense) || 0,
        income: Number(m && m.income) || 0
      };
    });

    renderDualBar(canvas, rows, {
      tipTitle: function (row) {
        var m = /^(\d{1,4})-(\d{1,2})$/.exec(row.label);
        return m ? (parseInt(m[1], 10) + '年' + parseInt(m[2], 10) + '月') : row.label;
      }
    });
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
    // 末点高亮：只有最后一个点画实心圆（其余靠 hover 才出现）
    function lastPointRadius(context) {
      var data = context.dataset.data || [];
      return context.dataIndex === data.length - 1 ? 3.5 : 0;
    }
    var datasets = [{
      label: '支出',
      data: rows.map(function (r) { return Number(r.expense) || 0; }),
      borderColor: t.expense,
      backgroundColor: function (context) { return vGradient(context, t.expense, 0.28, 0); },
      fill: true,
      tension: 0.4,
      borderWidth: 2,
      pointRadius: lastPointRadius,
      pointBackgroundColor: t.expense,
      pointBorderColor: t.surface,
      pointBorderWidth: 2,
      pointHoverRadius: 5
    }];
    if (hasIncome) {
      datasets.push({
        label: '收入',
        data: rows.map(function (r) { return Number(r.income) || 0; }),
        borderColor: t.income,
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.4,
        borderWidth: 2,
        pointRadius: lastPointRadius,
        pointBackgroundColor: t.income,
        pointBorderColor: t.surface,
        pointBorderWidth: 2,
        pointHoverRadius: 5
      });
    }

    var options = baseOptions();
    options.interaction = { mode: 'index', intersect: false };
    options.plugins = {
      legend: legendConfig(t, hasIncome),
      tooltip: tooltipConfig('index', false)
    };
    options.scales = baseScales(t, 8);

    try {
      var chart = new Chart(canvas, {
        type: 'line',
        data: { labels: rows.map(function (r) { return r.label; }), datasets: datasets },
        options: options
      });
      chart.$tipRows = function (model) {
        var row = rows[model.dataPoints[0].dataIndex];
        if (!row) return null;
        var out = [{ color: t.expense, label: '支出', value: '¥' + formatMoney(row.expense) }];
        if (hasIncome) out.push({ color: t.income, label: '收入', value: '¥' + formatMoney(row.income) });
        return { title: toChineseDate(row.label), rows: out };
      };
      instances.set(canvas, chart);
    } catch (e) {
      console.warn('[charts] 走势折线图渲染失败：', e);
      clearCanvas(canvas);
    }
  };

  /**
   * 渲染「近 7 天热量」柱状图（饮食页专用，单位千卡）。
   * 有预算时按当日摄入占比着色：<80% 绿 / 80%~105% 橙 / >105% 红，
   * 并画一条虚线参考线标出预算；无预算时全部绿色。空数据只清空画布。
   * @param {HTMLCanvasElement} canvas 画布元素
   * @param {Array<{label:string, kcal:number, tip:string}>} days 按日期升序
   * @param {number=} budget 每日热量预算（用于着色与参考线，缺省/非法视为无预算）
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

    var t = theme();
    // 档位色：达标=固定绿、接近=琥珀、超标=警示红（与支出/收入语义同一套 token）
    function levelColor(kcal) {
      if (!hasBudget) return t.income;
      var pct = kcal / b;
      if (pct > 1.05) return t.danger;
      if (pct >= 0.8) return t.warn;
      return t.income;
    }
    var colors = rows.map(function (r) { return levelColor(r.kcal); });

    var options = baseOptions();
    options.plugins = {
      legend: { display: false },
      tooltip: tooltipConfig('index', false),
      refLine: {
        value: hasBudget ? b : 0,
        color: t.sub,
        label: '预算 ' + Math.round(b)
      }
    };
    options.scales = baseScales(t, 7);
    options.scales.y.suggestedMax = hasBudget ? Math.round(b * 1.12) : undefined;
    options.scales.y.ticks.callback = function (value) { return compactMoney(value); };  // 千卡不带 ¥

    var config = {
      type: 'bar',
      data: {
        labels: rows.map(function (r) { return r.label; }),
        datasets: [{
          label: '热量',
          data: rows.map(function (r) { return r.kcal; }),
          backgroundColor: function (context) {
            return vGradient(context, colors[context.dataIndex] || t.income, 1, 0.55);
          },
          hoverBackgroundColor: function (context) { return colors[context.dataIndex] || t.income; },
          borderWidth: 0,
          borderRadius: 6,
          maxBarThickness: 30,
          barPercentage: 0.7,
          categoryPercentage: 0.72
        }]
      },
      options: options,
      plugins: [refLinePlugin]
    };

    try {
      var chart = new Chart(canvas, config);
      chart.$tipRows = function (model) {
        var i = model.dataPoints[0].dataIndex;
        var row = rows[i];
        if (!row) return null;
        // tip 形如「10月2日 · 1234 千卡」，标题只取日期部分，数字交给下面的行
        var title = row.tip ? String(row.tip).split(' · ')[0] : row.label;
        var out = [{ color: colors[i], label: '摄入', value: Math.round(row.kcal) + ' 千卡' }];
        if (hasBudget) out.push({ label: '预算', value: Math.round(b) + ' 千卡' });
        return { title: title, rows: out };
      };
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
    hideTip();
  };

  /** 收起数据浮层（浮层挂在 body 上，不随视图隐藏，切页时要显式收掉） */
  Charts.hideTip = hideTip;

  // 挂载到全局，供 app.js 使用
  window.Charts = Charts;
})();
