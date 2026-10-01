/**
 * charts.js —— 图表模块（基于 Chart.js v4 UMD，全局变量 Chart）
 *
 * 暴露全局对象 Charts，供 app.js 调用：
 *   Charts.renderCategoryPie(canvas, items)  分类占比环形图
 *   Charts.renderDailyTrend(canvas, days)    每日支出趋势柱状图
 *   Charts.destroyAll()                      销毁本模块创建的所有图表实例
 *
 * 约定：不主动操作 DOM（仅使用调用方传入的 canvas 元素）；
 *       容器高度由 CSS（.chart-box 260px）控制，图表只负责自适应填充。
 */
(function () {
  'use strict';

  // ==================== 内部工具 ====================

  /** 项目主题色常量 */
  var COLOR_TEXT_MAIN = '#333';   // 主文字
  var COLOR_TEXT_SUB = '#999';    // 辅助文字
  var COLOR_GRID = '#eee';        // 网格线

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
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // 第一行：小字“本月支出”
      ctx.font = '12px ' + FONT_FAMILY;
      ctx.fillStyle = COLOR_TEXT_SUB;
      ctx.fillText(opts.title || '本月支出', arc.x, arc.y - 11);
      // 第二行：加粗总额
      ctx.font = 'bold 18px ' + FONT_FAMILY;
      ctx.fillStyle = COLOR_TEXT_MAIN;
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
   */
  Charts.renderCategoryPie = function (canvas, items) {
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
          borderColor: '#ffffff',        // 扇区间 2px 白色边框
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
              color: COLOR_TEXT_MAIN,
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
            title: '本月支出',
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
   * 渲染「每日趋势」柱状图
   * @param {HTMLCanvasElement} canvas 画布元素
   * @param {Array<{label:string, value:number}>} days 按日期升序的每日支出
   */
  Charts.renderDailyTrend = function (canvas, days) {
    // 容错：图表库未加载时直接返回，绝不抛异常
    if (!libReady()) {
      return;
    }
    if (!canvas) {
      console.warn('[charts] renderDailyTrend：未传入 canvas');
      return;
    }
    days = Array.isArray(days) ? days : [];

    // 先销毁该画布上的旧实例
    destroyChart(canvas);

    // 空数据：只销毁并清空画布，不画任何东西
    if (days.length === 0) {
      clearCanvas(canvas);
      return;
    }

    // 清洗数据
    var labels = [];
    var values = [];
    days.forEach(function (d) {
      labels.push(d && d.label !== undefined ? String(d.label) : '');
      values.push(Number(d && d.value) || 0);
    });

    var config = {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: '每日支出',
          data: values,
          backgroundColor: 'rgba(0,181,120,0.75)',   // 薄荷绿柱色
          hoverBackgroundColor: 'rgba(0,149,98,1)',  // hover 加深
          borderRadius: 4,                            // 圆角柱
          borderSkipped: false
        }]
      },
      options: (function () {
        var options = baseOptions();
        options.plugins = {
          legend: { display: false },   // 单数据集不需要图例
          tooltip: {
            callbacks: {
              title: function () {
                return '';              // 不显示标题行，全部信息放单行 label
              },
              // M月D日: ¥金额
              label: function (ctx) {
                var dateStr = toChineseDate(labels[ctx.dataIndex]);
                return dateStr + ': ¥' + formatMoney(ctx.parsed.y);
              }
            }
          }
        };
        options.scales = {
          x: {
            grid: { display: false },   // 无竖向网格线
            border: { display: false },
            ticks: {
              color: COLOR_TEXT_SUB,
              font: { size: 11 },
              autoSkip: true,           // 标签多时自动跳隔显示
              maxTicksLimit: 10,
              maxRotation: 0,
              minRotation: 0
            }
          },
          y: {
            beginAtZero: true,          // y 轴从 0 开始
            grid: {
              color: COLOR_GRID,        // 横网格线 #eee
              borderDash: [4, 4]        // 虚线
            },
            border: { display: false },
            ticks: {
              color: COLOR_TEXT_SUB,
              font: { size: 11 },
              callback: function (value) {
                return '¥' + value;     // 刻度前缀 ¥
              }
            }
          }
        };
        return options;
      })()
    };

    try {
      var chart = new Chart(canvas, config);
      instances.set(canvas, chart);
    } catch (e) {
      // 渲染失败不拖垮页面
      console.warn('[charts] 每日趋势图渲染失败：', e);
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
