/**
 * core.js —— 小账本 · 数据层模块
 *
 * 暴露全局对象 Store（普通 <script> 引入，无模块系统，不依赖任何外部库）。
 * 数据统一持久化在 localStorage，键名为 jz_data_v1。
 *
 * 数据结构：
 *   {
 *     records: [      // 账单记录（type: 'expense' 支出 / 'income' 收入）
 *       { id:'r1696...', type:'expense', amount:25.5, categoryId:'canyin',
 *         date:'2026-10-01', note:'午餐', createdAt:16961...,
 *         items:[{name:'苹果', qty:1, price:5.5}] }
 *         // ↑ items 可选：商品明细（逐条清洗后挂载，无明细的记录没有该键）。
 *         //   约定：amount 与 items 相互独立，不强制 sum(qty*price) === amount，
 *         //   账单金额以 amount 为准，items 仅作明细展示
 *     ],
 *     categories: [   // 分类（16 个默认预设 + 用户自建，kind 区分支出/收入两组）
 *       { id:'canyin', name:'餐饮', icon:'🍜', color:'#FF7043', kind:'expense', custom:false, sort:1 }
 *     ],
 *     budgets: { monthly: null },  // 每月预算，Number | null
 *     diet: {                      // 饮食模块数据域（旧数据缺失时自动补默认值）
 *       profile: null,             // 个人资料 {sex,age,height,weight,activity,goal,
 *                                  //   calorieBudget} | null（未设置）
 *       entries: [],               // 饮食记录（营养数值写入时快照，不随后续食物库变动）
 *       customFoods: [],           // 自定义食物（每 100g 营养 + 默认份量）
 *       favorites: [],             // 收藏的食物 id（字符串数组，最多 12 个）
 *       combos: []                 // 常用组合 {id,name,items[],createdAt}（最多 10 个）
 *     },
 *     lastBackupAt: 16961...       // 上次备份（导出 JSON）的毫秒时间戳，Number | null
 *   }
 *
 * 对外 API 一览：
 *   load()  save(data)
 *   getRecords()  getMonthRecords(ym, type)  getRecord(id)
 *   addRecord({type,amount,categoryId,date,note,items})  updateRecord(id,patch)  deleteRecord(id)
 *   searchRecords({q,scope,ym})
 *   getCategories(kind)  addCategory({name,icon,kind})  updateCategory(id,{name,icon})  deleteCategory(id)
 *   getBudget()  setBudget(amount)
 *   getDiet()  addDietEntry({date,meal,name,grams,kcal,...})  deleteDietEntry(id)
 *   setDietProfile(profile)  addCustomFood({name,k,p,f,c,g})  deleteCustomFood(id)
 *   toggleFavorite(foodId)  addCombo(name, items)  deleteCombo(id)
 *   getMonthSummary(ym)  getMonthlyTrend(n)  getBudgetStatus(ym)
 *   exportJSON()  importJSON(text)  exportCSV(ym)
 *   formatAmount(n)  todayStr()  ymOf(dateStr)  currentYm()
 *
 * 约定：不操作 DOM；日期一律使用本地时区（手动拼接年月日，
 *       不用 toISOString，避免 UTC 偏移导致日期错一天）。
 */
var Store = (function () {
  'use strict';

  // ==================== 常量 ====================

  // ==================== 账户命名空间 ====================
  // 多账户：每个账户的数据存在独立的 localStorage 键下。
  // 未绑定账户时使用旧版单用户键 jz_data_v1（兼容历史数据）。

  /** 当前绑定的账户名（null 表示未绑定，用旧版键） */
  var _username = null;

  /** 当前生效的 localStorage 键名 */
  function storageKey() {
    return _username ? 'jz_data_v1::' + _username : 'jz_data_v1';
  }

  /**
   * 绑定数据所属账户（登录/切换账户后由 app.js 调用），并清空内存缓存，
   * 之后的读写都指向该账户独立的数据空间。
   * @param {string|null} username 账户名；null 表示回到旧版单用户空间
   */
  function setUser(username) {
    _username = username || null;
    _data = null;
  }

  /** 当前绑定的账户名，未绑定时返回 null */
  function storageUser() {
    return _username;
  }

  /** 默认预设支出分类（首次 load 时初始化写入） */
  var DEFAULT_CATEGORIES = [
    { id: 'canyin',   name: '餐饮', icon: '🍜', color: '#FF7043', kind: 'expense', custom: false, sort: 1 },
    { id: 'jiaotong', name: '交通', icon: '🚇', color: '#42A5F5', kind: 'expense', custom: false, sort: 2 },
    { id: 'gouwu',    name: '购物', icon: '🛍️', color: '#AB47BC', kind: 'expense', custom: false, sort: 3 },
    { id: 'yule',     name: '娱乐', icon: '🎮', color: '#FFA726', kind: 'expense', custom: false, sort: 4 },
    { id: 'riyong',   name: '日用', icon: '🧴', color: '#26A69A', kind: 'expense', custom: false, sort: 5 },
    { id: 'juzhu',    name: '居住', icon: '🏠', color: '#8D6E63', kind: 'expense', custom: false, sort: 6 },
    { id: 'yiliao',   name: '医疗', icon: '💊', color: '#EF5350', kind: 'expense', custom: false, sort: 7 },
    { id: 'xuexi',    name: '学习', icon: '📚', color: '#5C6BC0', kind: 'expense', custom: false, sort: 8 },
    { id: 'renqing',  name: '人情', icon: '🎁', color: '#EC407A', kind: 'expense', custom: false, sort: 9 },
    { id: 'qita',     name: '其他', icon: '📦', color: '#78909C', kind: 'expense', custom: false, sort: 10 }
  ];

  /** 默认预设收入分类（首次初始化包含；旧数据迁移时自动补挂） */
  var DEFAULT_INCOME_CATEGORIES = [
    { id: 'gongzi',     name: '工资',   icon: '💰', color: '#26A69A', kind: 'income', custom: false, sort: 11 },
    { id: 'jianzhi',    name: '兼职',   icon: '💼', color: '#5C6BC0', kind: 'income', custom: false, sort: 12 },
    { id: 'licai',      name: '理财',   icon: '📈', color: '#FFA726', kind: 'income', custom: false, sort: 13 },
    { id: 'hongbao',    name: '红包',   icon: '🧧', color: '#EC407A', kind: 'income', custom: false, sort: 14 },
    { id: 'tuikuan',    name: '退款',   icon: '💸', color: '#42A5F5', kind: 'income', custom: false, sort: 15 },
    { id: 'qitashouru', name: '其他收入', icon: '🪙', color: '#78909C', kind: 'income', custom: false, sort: 16 }
  ];

  /** 内置 10 色调色板：新增分类按 sort 顺延取色，取完一轮后循环复用 */
  var PALETTE = [
    '#FF7043', '#42A5F5', '#AB47BC', '#FFA726', '#26A69A',
    '#8D6E63', '#EF5350', '#5C6BC0', '#EC407A', '#78909C'
  ];

  /** 分类信息缺失时的兜底显示（例如导入数据里指向了不存在的分类） */
  var FALLBACK_CATEGORY = { name: '未知分类', icon: '🏷️', color: '#90A4AE' };

  /** 合法日期字符串：YYYY-MM-DD，且月/日取值范围正确 */
  var DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

  /** 合法颜色字符串：#RGB / #RRGGBB / #RRGGBBAA */
  var COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

  // ==================== 内部状态 ====================

  /** 内存缓存。首次调用任一 API 时自动 load；所有读写都经过它 */
  var _data = null;

  // ==================== 内部工具 ====================

  /**
   * 判断对象自身是否拥有某属性
   * @param {Object} obj
   * @param {string} key
   * @returns {boolean}
   */
  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  /**
   * 浅拷贝一个纯数据对象（用于对外返回副本，避免外部改动污染内部缓存）
   * @param {Object} o
   * @returns {Object}
   */
  function copyObj(o) {
    var c = {};
    for (var k in o) {
      if (hasOwn(o, k)) {
        c[k] = o[k];
      }
    }
    return c;
  }

  /**
   * 深拷贝一条账单记录：字段浅拷贝 + items 商品明细逐条拷贝，
   * 保证外部改动（含修改返回的 items 数组/条目）不会污染内部缓存
   * @param {Object} r
   * @returns {Object}
   */
  function copyRecord(r) {
    var c = copyObj(r);
    if (Array.isArray(c.items)) {
      c.items = c.items.map(copyObj);
    }
    return c;
  }

  /**
   * 金额四舍五入保留两位小数
   * @param {number} n
   * @returns {number}
   */
  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /**
   * 个位数补零：9 → '09'
   * @param {number} n
   * @returns {string}
   */
  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /**
   * Date 对象 → 本地时区 'YYYY-MM-DD'（手动拼接，不用 toISOString）
   * @param {Date} d
   * @returns {string}
   */
  function dateToStr(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /**
   * 年月偏移：'2026-10' 偏移 -1 → '2026-09'（跨年自动进位，本地时区）
   * @param {string} ym 'YYYY-MM'
   * @param {number} delta 偏移月数，可为负
   * @returns {string} 'YYYY-MM'
   */
  function ymShift(ym, delta) {
    var y = parseInt(ym.slice(0, 4), 10);
    var m = parseInt(ym.slice(5, 7), 10) - 1 + delta;
    var d = new Date(y, m, 1);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  /**
   * 校验并规范日期字符串：形如 YYYY-MM-DD 才认可，否则返回空串
   * @param {*} v
   * @returns {string} 合法返回原串，非法返回 ''
   */
  function normalizeDateStr(v) {
    if (typeof v === 'string' && DATE_RE.test(v.trim())) {
      return v.trim();
    }
    return '';
  }

  /**
   * 规范备注：转字符串、去首尾空格，可为空字符串
   * @param {*} v
   * @returns {string}
   */
  function normalizeNote(v) {
    if (v === null || v === undefined) {
      return '';
    }
    return String(v).trim();
  }

  /**
   * 规范分类 id：非空字符串才认可，否则回退到「其他」
   * @param {*} v
   * @returns {string}
   */
  function normalizeCategoryId(v) {
    if (typeof v === 'string' && v.trim()) {
      return v.trim();
    }
    return 'qita';
  }

  /**
   * 校验金额：必须是有限正数（数字或数字字符串均可），非法抛异常
   * @param {*} v
   * @returns {number} 保留两位小数
   * @throws {Error} '金额不合法'
   */
  function parsePositiveAmount(v) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) {
      throw new Error('金额不合法');
    }
    return round2(n);
  }

  /**
   * 生成唯一 id：前缀 + 时间戳 + 随机数（可传入已有 id 集合保证不重复）
   * @param {string} prefix 'r' | 'c'
   * @param {Object=} seen  已存在 id 的集合（可选）
   * @param {number=} extra  附加后缀（导入批量补 id 时用于强制唯一）
   * @returns {string}
   */
  function makeUniqueId(prefix, seen, extra) {
    var id;
    do {
      id = prefix + Date.now() + Math.random().toString(36).slice(2, 8) +
        (extra === undefined ? '' : '_' + extra);
    } while (seen && seen[id]);
    if (seen) {
      seen[id] = true;
    }
    return id;
  }

  /**
   * 按 sort 序号从调色板取色（序号超出调色板长度后循环复用）
   * @param {number} sort
   * @returns {string}
   */
  function paletteColor(sort) {
    var i = Math.floor(Number(sort) || 1) - 1;
    if (i < 0) {
      i = 0;
    }
    return PALETTE[i % PALETTE.length];
  }

  /**
   * 记录排序（不影响原数组）：date 倒序，同日按 createdAt 倒序
   * @param {Array} list
   * @returns {Array} 排好序的浅拷贝数组
   */
  function sortRecordsForRead(list) {
    var arr = list.slice();
    arr.sort(function (a, b) {
      if (a.date === b.date) {
        return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
      }
      return a.date > b.date ? -1 : 1;
    });
    return arr.map(copyRecord); // 逐条深拷贝（含可选 items 明细）
  }

  // ==================== 数据规范（读取/保存时的容错清洗） ====================

  /**
   * 规范预算对象：monthly 只可能是正数（两位小数）或 null
   * @param {*} b
   * @returns {{monthly: (number|null)}}
   */
  function normalizeBudgets(b) {
    var out = { monthly: null };
    if (b && typeof b === 'object' && !Array.isArray(b)) {
      if (b.monthly === null) {
        out.monthly = null;
      } else {
        var n = Number(b.monthly);
        if (isFinite(n) && n > 0) {
          out.monthly = round2(n);
        }
        // 非法预算容错：视为未设置
      }
    }
    return out;
  }

  // ==================== 商品明细（record.items）规范 ====================

  /** 单条明细名称的最大长度（字符数，超出视为非法条目） */
  var ITEM_NAME_MAX = 30;

  /** 单条记录最多保留的明细条数，超出截断 */
  var ITEM_COUNT_MAX = 50;

  /**
   * 规范一条商品明细；非法返回 null（由调用方丢弃）：
   *   name  必须是字符串，trim 后 1~30 字、非空（超长不截断，整条判非法）
   *   qty   数字 >0、最多两位小数；缺失/为空时缺省 1，非法（0/负数/非数字）判非法
   *   price 数字 >=0、两位小数；缺失/负数判非法（0 表示免费，允许）
   * @param {*} it
   * @returns {Object|null} {name, qty, price}
   */
  function normalizeRecordItem(it) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) {
      return null;
    }
    var name = (typeof it.name === 'string') ? it.name.trim() : '';
    if (!name || name.length > ITEM_NAME_MAX) {
      return null;
    }
    var qty;
    if (it.qty === undefined || it.qty === null || it.qty === '') {
      qty = 1; // 数量缺省 1
    } else {
      qty = round2(Number(it.qty));
      if (!isFinite(qty) || qty <= 0) {
        return null;
      }
    }
    if (it.price === null || it.price === undefined || it.price === '') {
      return null; // 价格缺失：无缺省值，整条判非法
    }
    var price = round2(Number(it.price));
    if (!isFinite(price) || price < 0) {
      return null;
    }
    return { name: name, qty: qty, price: price };
  }

  /**
   * 规范一组商品明细（清洗层与 type/amount 校验同层，绝不抛异常）：
   *   - 缺失/非数组 → 返回 null（记录保持无 items 键）
   *   - 逐条清洗、丢弃非法条目，最多保留 50 条（超出截断）
   *   - 清洗后为空数组 → 返回 null（同样不设置 items）
   * 约定：amount 与 items 相互独立，不强制 sum(qty*price) === amount。
   * @param {*} items
   * @returns {Array|null}
   */
  function normalizeRecordItems(items) {
    if (!Array.isArray(items)) {
      return null;
    }
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = normalizeRecordItem(items[i]);
      if (it) {
        out.push(it);
        if (out.length >= ITEM_COUNT_MAX) {
          break; // 最多 50 条，超出截断
        }
      }
    }
    return out.length ? out : null;
  }

  // ==================== 饮食数据域（diet）规范 ====================

  /** 餐次白名单（与 diet.js 的 Diet.MEALS 保持一致） */
  var DIET_MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];

  /**
   * 规范个人资料：年龄/身高/体重任一非法即视为「未设置」，返回 null
   * @param {*} p
   * @returns {Object|null}
   */
  function normalizeDietProfile(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      return null;
    }
    var age = Number(p.age);
    var height = Number(p.height);
    var weight = Number(p.weight);
    if (!isFinite(age) || age < 1 || age > 120) return null;
    if (!isFinite(height) || height < 80 || height > 250) return null;
    if (!isFinite(weight) || weight < 20 || weight > 300) return null;
    // 自定义热量预算：可选，500~10000 之外视为未设置
    var calorieBudget = null;
    if (p.calorieBudget !== null && p.calorieBudget !== undefined && p.calorieBudget !== '') {
      var cb = Number(p.calorieBudget);
      if (isFinite(cb) && cb >= 500 && cb <= 10000) {
        calorieBudget = Math.round(cb);
      }
    }
    return {
      sex: p.sex === 'female' ? 'female' : 'male',
      age: Math.round(age),
      height: Math.round(height),
      weight: Math.round(weight * 10) / 10,
      activity: [1, 2, 3, 4].indexOf(Number(p.activity)) !== -1 ? Number(p.activity) : 1,
      goal: ['lose', 'keep', 'gain'].indexOf(p.goal) !== -1 ? p.goal : 'keep',
      calorieBudget: calorieBudget
    };
  }

  /**
   * 规范一条饮食记录；克数/热量彻底非法的记录丢弃
   * @param {*} e
   * @param {number} i 用于补 id
   * @returns {Object|null}
   */
  function normalizeDietEntry(e, i) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      return null;
    }
    var grams = Number(e.grams);
    var kcal = Number(e.kcal);
    if (!isFinite(grams) || grams <= 0 || grams > 20000) return null;
    if (!isFinite(kcal) || kcal < 0 || kcal > 20000) return null;
    var createdAt = Number(e.createdAt);
    function macro(v) {
      var n = Number(v);
      return (isFinite(n) && n >= 0) ? Math.round(n * 10) / 10 : 0;
    }
    return {
      id: (typeof e.id === 'string' && e.id) ? e.id : makeUniqueId('d', null, i),
      date: normalizeDateStr(e.date) || todayStr(),
      meal: DIET_MEALS.indexOf(e.meal) !== -1 ? e.meal : 'snack',
      foodId: (typeof e.foodId === 'string' && e.foodId) ? e.foodId : '',
      name: (typeof e.name === 'string' && e.name.trim()) ? e.name.trim().slice(0, 30) : '未知食物',
      cat: (typeof e.cat === 'string' && e.cat) ? e.cat : '',
      grams: Math.round(grams * 10) / 10,
      kcal: Math.round(kcal),
      protein: macro(e.protein),
      fat: macro(e.fat),
      carb: macro(e.carb),
      note: normalizeNote(e.note),
      createdAt: isFinite(createdAt) ? createdAt : Date.now()
    };
  }

  /**
   * 规范一种自定义食物（每 100g 营养）；名称为空的丢弃
   * @param {*} fd
   * @param {number} i 用于补 id
   * @returns {Object|null}
   */
  function normalizeCustomFood(fd, i) {
    if (!fd || typeof fd !== 'object' || Array.isArray(fd)) {
      return null;
    }
    var name = (typeof fd.name === 'string') ? fd.name.trim() : '';
    if (!name) {
      return null;
    }
    function macro(v) {
      var n = Number(v);
      return (isFinite(n) && n >= 0) ? Math.round(n * 10) / 10 : 0;
    }
    var g = Number(fd.g);
    var units = Array.isArray(fd.units) ? fd.units.filter(function (u) {
      return Array.isArray(u) && typeof u[0] === 'string' &&
        isFinite(Number(u[1])) && Number(u[1]) > 0;
    }).map(function (u) {
      return [u[0], Math.round(Number(u[1]))];
    }).slice(0, 6) : [];
    return {
      id: (typeof fd.id === 'string' && fd.id) ? fd.id : makeUniqueId('cf', null, i),
      name: name.slice(0, 20),
      k: macro(fd.k),
      p: macro(fd.p),
      f: macro(fd.f),
      c: macro(fd.c),
      g: (isFinite(g) && g > 0 && g <= 5000) ? Math.round(g) : 100,
      units: units
    };
  }

  /** 收藏的食物 id 上限（超出丢弃最旧的） */
  var FAVORITES_MAX = 12;

  /** 常用组合数量上限 / 单个组合条目上限 */
  var COMBOS_MAX = 10;
  var COMBO_ITEMS_MAX = 20;

  /**
   * 规范收藏列表：仅保留非空字符串 id，去重，最多 12 个
   * @param {*} list
   * @returns {Array<string>}
   */
  function normalizeFavorites(list) {
    var out = [];
    if (!Array.isArray(list)) {
      return out;
    }
    list.forEach(function (id) {
      if (typeof id === 'string' && id && out.indexOf(id) === -1 && out.length < FAVORITES_MAX) {
        out.push(id);
      }
    });
    return out;
  }

  /**
   * 规范组合内一条食物快照（结构与饮食记录一致但无 id/date/createdAt）；
   * 克数/热量非法的条目丢弃
   * @param {*} it
   * @returns {Object|null}
   */
  function normalizeComboItem(it) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) {
      return null;
    }
    var grams = Number(it.grams);
    var kcal = Number(it.kcal);
    if (!isFinite(grams) || grams <= 0 || grams > 20000) return null;
    if (!isFinite(kcal) || kcal < 0 || kcal > 20000) return null;
    function macro(v) {
      var n = Number(v);
      return (isFinite(n) && n >= 0) ? Math.round(n * 10) / 10 : 0;
    }
    return {
      foodId: (typeof it.foodId === 'string' && it.foodId) ? it.foodId : '',
      name: (typeof it.name === 'string' && it.name.trim()) ? it.name.trim().slice(0, 30) : '未知食物',
      cat: (typeof it.cat === 'string' && it.cat) ? it.cat : '',
      grams: Math.round(grams * 10) / 10,
      kcal: Math.round(kcal),
      protein: macro(it.protein),
      fat: macro(it.fat),
      carb: macro(it.carb),
      meal: DIET_MEALS.indexOf(it.meal) !== -1 ? it.meal : 'snack'
    };
  }

  /**
   * 规范组合列表：名称为空/无有效条目的丢弃，数量超出上限截断
   * @param {*} list
   * @returns {Array}
   */
  function normalizeCombos(list) {
    var out = [];
    if (!Array.isArray(list)) {
      return out;
    }
    list.forEach(function (c, i) {
      if (!c || typeof c !== 'object' || Array.isArray(c) || out.length >= COMBOS_MAX) {
        return;
      }
      var name = (typeof c.name === 'string') ? c.name.trim() : '';
      if (!name) {
        return;
      }
      var items = [];
      if (Array.isArray(c.items)) {
        c.items.forEach(function (it) {
          if (items.length >= COMBO_ITEMS_MAX) {
            return;
          }
          var ni = normalizeComboItem(it);
          if (ni) items.push(ni);
        });
      }
      if (!items.length) {
        return;
      }
      var createdAt = Number(c.createdAt);
      out.push({
        id: (typeof c.id === 'string' && c.id) ? c.id : makeUniqueId('cb', null, i),
        name: name.slice(0, 20),
        items: items,
        createdAt: isFinite(createdAt) ? createdAt : Date.now()
      });
    });
    return out;
  }

  /**
   * 清洗饮食数据域：结构不完整时逐项兜底，绝不抛异常
   * @param {*} d
   * @returns {{profile:(Object|null), entries:Array, customFoods:Array,
   *            favorites:Array, combos:Array}}
   */
  function sanitizeDiet(d) {
    var out = { profile: null, entries: [], customFoods: [], favorites: [], combos: [] };
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      return out;
    }
    out.profile = normalizeDietProfile(d.profile);
    if (Array.isArray(d.entries)) {
      d.entries.forEach(function (e, i) {
        var ne = normalizeDietEntry(e, i);
        if (ne) out.entries.push(ne);
      });
    }
    if (Array.isArray(d.customFoods)) {
      d.customFoods.forEach(function (cf, i) {
        var nf = normalizeCustomFood(cf, i);
        if (nf) out.customFoods.push(nf);
      });
    }
    out.favorites = normalizeFavorites(d.favorites);
    out.combos = normalizeCombos(d.combos);
    return out;
  }

  /**
   * 清洗一份数据对象：结构不完整/字段非法时做兜底，绝不让页面崩溃。
   * 个别彻底无法使用的脏记录/脏分类会被丢弃（金额非法、名称为空）。
   * record.type / category.kind 均按白名单校验，非法回落 'expense'；
   * 记录可选携带商品明细 items（逐条清洗，非法条目丢弃，清洗后为空则不设该键）；
   * lastBackupAt 缺失或非法补 null；diet 缺失（旧数据）补空默认值。
   * @param {*} parsed 从 localStorage 或导入文件解析出的对象
   * @returns {{records:Array, categories:Array, budgets:{monthly:(number|null)},
   *            diet:{profile:(Object|null), entries:Array, customFoods:Array},
   *            lastBackupAt:(number|null)}}
   */
  function sanitizeData(parsed) {
    var out = { records: [], categories: [], budgets: { monthly: null },
      diet: { profile: null, entries: [], customFoods: [] }, lastBackupAt: null };
    if (!parsed || typeof parsed !== 'object') {
      return out;
    }

    // ---- 记录 ----
    if (Array.isArray(parsed.records)) {
      parsed.records.forEach(function (r, i) {
        if (!r || typeof r !== 'object' || Array.isArray(r)) {
          return;
        }
        var amount = Number(r.amount);
        if (!isFinite(amount) || amount <= 0) {
          return; // 金额非法的记录无法使用，丢弃
        }
        var createdAt = Number(r.createdAt);
        var rec = {
          id: (typeof r.id === 'string' && r.id) ? r.id : makeUniqueId('r', null, i),
          type: (r.type === 'expense' || r.type === 'income') ? r.type : 'expense', // 白名单校验，非法回落支出
          amount: round2(amount),
          categoryId: normalizeCategoryId(r.categoryId),
          date: normalizeDateStr(r.date) || todayStr(),
          note: normalizeNote(r.note),
          createdAt: isFinite(createdAt) ? createdAt : Date.now()
        };
        // 可选商品明细：缺失/非数组/清洗后为空时不设置 items 键（保持旧记录形状）
        var recItems = normalizeRecordItems(r.items);
        if (recItems) {
          rec.items = recItems;
        }
        out.records.push(rec);
      });
    }

    // ---- 分类 ----
    if (Array.isArray(parsed.categories)) {
      parsed.categories.forEach(function (c, i) {
        if (!c || typeof c !== 'object' || Array.isArray(c)) {
          return;
        }
        var name = (typeof c.name === 'string') ? c.name.trim() : '';
        if (!name) {
          return; // 无名分类无法使用，丢弃
        }
        var sort = Number(c.sort);
        if (!isFinite(sort) || sort <= 0) {
          sort = i + 1;
        }
        var icon = (typeof c.icon === 'string' && c.icon.trim()) ? c.icon.trim() : '🏷️';
        var color = (typeof c.color === 'string' && COLOR_RE.test(c.color.trim()))
          ? c.color.trim() : paletteColor(sort);
        out.categories.push({
          id: (typeof c.id === 'string' && c.id) ? c.id : makeUniqueId('c', null, i),
          name: name,
          icon: icon,
          color: color,
          kind: (c.kind === 'expense' || c.kind === 'income') ? c.kind : 'expense', // 缺失/非法补 'expense'
          custom: (typeof c.custom === 'boolean') ? c.custom : false,
          sort: sort
        });
      });
    }

    // ---- 预算 ----
    out.budgets = normalizeBudgets(parsed.budgets);

    // ---- 饮食（旧数据无 diet 字段时得到空默认值） ----
    out.diet = sanitizeDiet(parsed.diet);

    // ---- 备份时间 ----
    // 仅接受有限的数字毫秒时间戳；缺失/非法（旧格式数据）一律补 null
    if (typeof parsed.lastBackupAt === 'number' && isFinite(parsed.lastBackupAt)) {
      out.lastBackupAt = parsed.lastBackupAt;
    }
    return out;
  }

  /**
   * 生成一份全新的默认数据（含 16 个预设分类：10 支出 + 6 收入）
   * @returns {{records:Array, categories:Array, budgets:{monthly:null}, lastBackupAt:null}}
   */
  function defaultData() {
    return {
      records: [],
      categories: DEFAULT_CATEGORIES.concat(DEFAULT_INCOME_CATEGORIES).map(copyObj),
      budgets: { monthly: null },
      diet: { profile: null, entries: [], customFoods: [], favorites: [], combos: [] },
      lastBackupAt: null
    };
  }

  /**
   * 旧数据迁移：若分类中不存在任何收入分类（说明是旧版数据），
   * 则把 6 个默认收入分类追加进去（sort 从现有最大 sort + 1 顺延；
   * id 已被占用的跳过，避免与用户已有分类重复）。
   * 只新增分类，绝不改动或丢失用户已有的记录与分类。
   * @param {Object} data 内部数据对象（会被就地修改）
   * @returns {boolean} 是否追加了收入分类
   */
  function ensureIncomeCategories(data) {
    var hasIncome = data.categories.some(function (c) {
      return c.kind === 'income';
    });
    if (hasIncome) {
      return false;
    }
    var existIds = {};
    var maxSort = 0;
    data.categories.forEach(function (c) {
      existIds[c.id] = true;
      var s = Number(c.sort);
      if (isFinite(s) && s > maxSort) {
        maxSort = s;
      }
    });
    var added = false;
    DEFAULT_INCOME_CATEGORIES.forEach(function (def) {
      if (existIds[def.id]) {
        return; // 该 id 已被用户数据占用，跳过
      }
      maxSort += 1;
      var c = copyObj(def);
      c.sort = maxSort;
      data.categories.push(c);
      added = true;
    });
    return added;
  }

  /**
   * 把内存缓存写入 localStorage（失败只警告，不抛异常）
   * @returns {boolean} 是否写入成功
   */
  function persist() {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(_data));
      return true;
    } catch (e) {
      console.warn('[core.js] 写入 localStorage 失败：', e);
      return false;
    }
  }

  /**
   * 取内部数据（惰性初始化：未 load 时自动 load 一次）
   * @returns {{records:Array, categories:Array, budgets:Object}}
   */
  function getData() {
    if (!_data) {
      load();
    }
    return _data;
  }

  /**
   * 深拷贝一份数据对外返回（records/categories 均为逐条浅拷贝），
   * 保证外部改动不会污染内部缓存。
   */
  function cloneData(d) {
    return {
      records: d.records.map(copyRecord), // 记录深拷贝，含 items 明细
      categories: d.categories.map(copyObj),
      budgets: { monthly: d.budgets.monthly },
      diet: {
        profile: d.diet.profile ? copyObj(d.diet.profile) : null,
        entries: d.diet.entries.map(copyObj),
        customFoods: d.diet.customFoods.map(copyObj),
        favorites: d.diet.favorites.slice(),
        // 组合内嵌 items 条目，需逐条拷贝避免外部改动污染缓存
        combos: d.diet.combos.map(function (c) {
          var cc = copyObj(c);
          cc.items = c.items.map(copyObj);
          return cc;
        })
      },
      lastBackupAt: d.lastBackupAt
    };
  }

  // ==================== 对外 API：加载与保存 ====================

  /**
   * 加载完整数据对象。
   * localStorage 无数据或解析失败时，初始化默认数据（含预设分类）并保存；
   * 解析失败只 console.warn 并重置为默认，绝不抛异常导致页面崩溃。
   * 旧版数据（无收入分类）载入后自动补挂 6 个默认收入分类并保存一次。
   * @returns {{records:Array, categories:Array, budgets:{monthly:(number|null)},
   *            lastBackupAt:(number|null)}}
   */
  function load() {
    var raw = null;
    try {
      raw = localStorage.getItem(storageKey());
    } catch (e) {
      console.warn('[core.js] 读取 localStorage 失败，将使用默认数据：', e);
    }

    if (raw) {
      try {
        _data = sanitizeData(JSON.parse(raw));
      } catch (e) {
        console.warn('[core.js] 本地数据解析失败，已重置为默认数据：', e);
        _data = defaultData();
        persist();
      }
    } else {
      _data = defaultData();
      persist();
    }
    // 旧数据迁移：没有任何收入分类说明是旧版数据，自动补挂默认收入分类
    if (ensureIncomeCategories(_data)) {
      persist(); // 迁移只追加分类，用户已有记录与分类保持原样
    }
    return cloneData(_data);
  }

  /**
   * 保存完整数据对象到 localStorage（会先做一次结构清洗，保证内部数据形状正确）
   * @param {{records:Array, categories:Array, budgets:Object}} data
   * @returns {boolean} 是否写入成功
   */
  function save(data) {
    if (!data || typeof data !== 'object') {
      console.warn('[core.js] save 参数必须是完整数据对象，已忽略本次保存');
      return false;
    }
    _data = sanitizeData(data);
    return persist();
  }

  // ==================== 对外 API：账单记录 ====================

  /**
   * 所有记录，按 date 倒序、同日按 createdAt 倒序。
   * 返回副本数组，记录含可选 items 商品明细（深拷贝，外部修改不污染内部）
   * @returns {Array}
   */
  function getRecords() {
    return sortRecordsForRead(getData().records);
  }

  /**
   * 某个月的记录（ym 形如 '2026-10'），排序规则同 getRecords
   * @param {string=} ym 缺省时取当前月
   * @param {string=} type 'expense'|'income'，传入则只返回该类型；
   *                       缺省/非法时返回全部类型（兼容旧行为）
   * @returns {Array} 记录副本（含可选 items 明细深拷贝）
   */
  function getMonthRecords(ym, type) {
    var month = ym || currentYm();
    var filterType = (type === 'expense' || type === 'income') ? type : null;
    var list = getData().records.filter(function (r) {
      if (ymOf(r.date) !== month) {
        return false;
      }
      return !filterType || r.type === filterType;
    });
    return sortRecordsForRead(list);
  }

  /**
   * 按 id 查记录
   * @param {string} id
   * @returns {Object|null} 记录副本（含可选 items 明细深拷贝）
   */
  function getRecord(id) {
    var records = getData().records;
    for (var i = 0; i < records.length; i++) {
      if (records[i].id === id) {
        return copyRecord(records[i]); // 深拷贝，含 items 明细副本
      }
    }
    return null;
  }

  /**
   * 新增一笔记录（支出或收入）
   * @param {{type:string=, amount:*, categoryId:string, date:string, note:string=,
   *          items:Array=}} input
   *        type 缺省为 'expense'，只允许 'expense'|'income'；
   *        items 可选商品明细 [{name,qty,price}]，逐条清洗；
   *        缺失/非数组/全部非法时不设置 items 键。
   *        约定：amount 与 items 相互独立，不强制 sum(qty*price) === amount，
   *        账单金额以 amount 为准，items 仅作明细展示
   * @returns {Object} 新记录
   * @throws {Error} '记录类型不合法' / '金额不合法'
   */
  function addRecord(input) {
    var opts = input || {};
    var type = (opts.type === undefined || opts.type === null || opts.type === '')
      ? 'expense' : opts.type; // type 可选，缺省视为支出
    if (type !== 'expense' && type !== 'income') {
      throw new Error('记录类型不合法');
    }
    var amount = parsePositiveAmount(opts.amount); // 再校验金额，非法直接抛错、不动数据
    var data = getData();
    var seen = {};
    data.records.forEach(function (r) { seen[r.id] = true; });

    var rec = {
      id: makeUniqueId('r', seen),      // 'r' + 时间戳 + 随机数
      type: type,                        // 'expense' | 'income'
      amount: amount,                    // 两位小数
      categoryId: normalizeCategoryId(opts.categoryId),
      date: normalizeDateStr(opts.date) || todayStr(), // 日期缺省/非法时记今天
      note: normalizeNote(opts.note),    // 去空格，可为空字符串
      createdAt: Date.now()
    };
    // 可选商品明细：逐条清洗；缺失/非数组/清洗后为空时不设置 items 键
    var recItems = normalizeRecordItems(opts.items);
    if (recItems) {
      rec.items = recItems;
    }
    data.records.push(rec);
    persist();
    return copyRecord(rec);
  }

  /**
   * 按 id 合并更新记录（处理 amount/categoryId/date/note/items 这几个字段）
   * @param {string} id
   * @param {Object} patch 要更新的字段。
   *        items 传数组时整体替换为清洗结果（并非与旧明细逐条合并）；
   *        传 []（或数组清洗后为空）清空明细，即移除 items 键；
   *        传非数组值（如 null/字符串）视为未提供，保持原明细不变
   * @returns {Object|null} 更新后的记录；id 不存在返回 null
   * @throws {Error} '金额不合法'
   */
  function updateRecord(id, patch) {
    var data = getData();
    var rec = null;
    for (var i = 0; i < data.records.length; i++) {
      if (data.records[i].id === id) {
        rec = data.records[i];
        break;
      }
    }
    if (!rec) {
      return null;
    }

    var p = patch || {};
    // 金额先整体校验，非法时不做任何修改
    var newAmount = hasOwn(p, 'amount') ? parsePositiveAmount(p.amount) : null;

    if (newAmount !== null) {
      rec.amount = newAmount;
    }
    if (hasOwn(p, 'categoryId')) {
      rec.categoryId = normalizeCategoryId(p.categoryId);
    }
    if (hasOwn(p, 'date')) {
      var d = normalizeDateStr(p.date);
      if (d) {
        rec.date = d; // 传入的日期非法/为空时保持原值
      }
    }
    if (hasOwn(p, 'note')) {
      rec.note = normalizeNote(p.note);
    }
    // 商品明细：仅当传入数组时处理——整体替换为清洗结果；
    // 清洗后为空（含传 []）则移除 items 键（清空语义）
    if (hasOwn(p, 'items') && Array.isArray(p.items)) {
      var recItems = normalizeRecordItems(p.items);
      if (recItems) {
        rec.items = recItems;
      } else {
        delete rec.items;
      }
    }
    persist();
    return copyRecord(rec);
  }

  /**
   * 按 id 删除记录
   * @param {string} id
   * @returns {true}
   */
  function deleteRecord(id) {
    var data = getData();
    data.records = data.records.filter(function (r) {
      return r.id !== id;
    });
    persist();
    return true;
  }

  // ==================== 对外 API：搜索 ====================

  /**
   * 按关键词搜索记录。
   * 匹配范围：备注、分类名称、金额字符串（两位小数，如 '12.5' 命中 12.50，
   * '12' 也能命中），均不区分大小写；关键词为空串时返回范围内全部记录。
   * @param {{q:string=, scope:string=, ym:string=}} opts
   *        q 关键词，缺省为空串；
   *        scope：'month' 只搜 ym 所指月份（缺省）；'3m' 搜 ym 及其前两个月；
   *        'all' 全部记录；非法值按 'month' 处理；
   *        ym 形如 '2026-10'，缺省取当前月。
   * @returns {Array} 命中的记录（副本），排序规则同 getRecords
   */
  function searchRecords(opts) {
    var o = opts || {};
    var q = (o.q === null || o.q === undefined) ? '' : String(o.q).trim().toLowerCase();
    var scope = (o.scope === '3m' || o.scope === 'all') ? o.scope : 'month';
    var month = o.ym || currentYm();

    // 目标月份集合：'month' 一个月，'3m' 三个月，'all' 不限（null）
    var ymSet = null;
    if (scope === 'month') {
      ymSet = {};
      ymSet[month] = true;
    } else if (scope === '3m') {
      ymSet = {};
      ymSet[month] = true;
      ymSet[ymShift(month, -1)] = true;
      ymSet[ymShift(month, -2)] = true;
    }

    // 分类 id -> 分类对象 查找表（用于匹配分类名称）
    var catMap = {};
    var cats = getData().categories;
    for (var i = 0; i < cats.length; i++) {
      catMap[cats[i].id] = cats[i];
    }

    var list = getData().records.filter(function (r) {
      if (ymSet && !ymSet[ymOf(r.date)]) {
        return false;
      }
      if (!q) {
        return true; // 空关键词：范围内全部命中
      }
      var cat = catMap[r.categoryId] || FALLBACK_CATEGORY;
      return normalizeNote(r.note).toLowerCase().indexOf(q) !== -1 ||
        cat.name.toLowerCase().indexOf(q) !== -1 ||
        formatAmount(r.amount).indexOf(q) !== -1;
    });
    return sortRecordsForRead(list);
  }

  // ==================== 对外 API：分类 ====================

  /**
   * 全部分类或某一组分类，按 sort 升序
   * @param {string=} kind 'expense'|'income'，传入则只返回该组；
   *                       缺省/非法时返回全部（兼容旧行为）
   * @returns {Array}
   */
  function getCategories(kind) {
    var list = getData().categories.slice();
    if (kind === 'expense' || kind === 'income') {
      list = list.filter(function (c) {
        return c.kind === kind;
      });
    }
    list.sort(function (a, b) {
      return (Number(a.sort) || 0) - (Number(b.sort) || 0);
    });
    return list.map(copyObj);
  }

  /**
   * 新增自定义分类
   * @param {{name:string, icon:string=, kind:string=}} input
   *        kind 缺省为 'expense'，只允许 'expense'|'income'
   * @returns {Object} 新分类
   * @throws {Error} '分类名称不能为空' / '分类已存在' / '分类类型不合法'
   */
  function addCategory(input) {
    var opts = input || {};
    var name = (typeof opts.name === 'string') ? opts.name.trim() : '';
    if (!name) {
      throw new Error('分类名称不能为空');
    }
    var kind = (opts.kind === undefined || opts.kind === null || opts.kind === '')
      ? 'expense' : opts.kind; // kind 可选，缺省视为支出
    if (kind !== 'expense' && kind !== 'income') {
      throw new Error('分类类型不合法');
    }
    var data = getData();

    // 查重（按去空格后的名称精确比较）
    for (var i = 0; i < data.categories.length; i++) {
      if (data.categories[i].name === name) {
        throw new Error('分类已存在');
      }
    }

    // sort 顺延：当前最大 sort + 1
    var maxSort = 0;
    data.categories.forEach(function (c) {
      var s = Number(c.sort);
      if (isFinite(s) && s > maxSort) {
        maxSort = s;
      }
    });
    var sort = maxSort + 1;

    // id：'c' + 时间戳；同一毫秒内连续新增可能撞 id，此时追加随机数保证唯一
    var catId = 'c' + Date.now();
    var existIds = {};
    data.categories.forEach(function (c) { existIds[c.id] = true; });
    while (existIds[catId]) {
      catId = 'c' + Date.now() + Math.random().toString(36).slice(2, 6);
    }

    var cat = {
      id: catId,
      name: name,
      icon: (typeof opts.icon === 'string' && opts.icon.trim()) ? opts.icon.trim() : '🏷️',
      color: paletteColor(sort),            // 从调色板按 sort 顺延取色
      kind: kind,                           // 'expense' | 'income'
      custom: true,
      sort: sort
    };
    data.categories.push(cat);
    persist();
    return copyObj(cat);
  }

  /**
   * 更新分类（名称/图标）
   * @param {string} id
   * @param {{name:string=, icon:string=}} patch
   * @returns {Object|null} 更新后的分类；id 不存在返回 null
   * @throws {Error} '分类名称不能为空' / '分类已存在'
   */
  function updateCategory(id, patch) {
    var data = getData();
    var cat = null;
    for (var i = 0; i < data.categories.length; i++) {
      if (data.categories[i].id === id) {
        cat = data.categories[i];
        break;
      }
    }
    if (!cat) {
      return null;
    }

    var p = patch || {};
    var newName = null;
    if (hasOwn(p, 'name')) {
      newName = (typeof p.name === 'string') ? p.name.trim() : '';
      if (!newName) {
        throw new Error('分类名称不能为空');
      }
      // 查重时排除自身
      for (var j = 0; j < data.categories.length; j++) {
        if (data.categories[j].id !== id && data.categories[j].name === newName) {
          throw new Error('分类已存在');
        }
      }
    }
    if (newName !== null) {
      cat.name = newName;
    }
    if (hasOwn(p, 'icon')) {
      var icon = (typeof p.icon === 'string') ? p.icon.trim() : '';
      cat.icon = icon || '🏷️'; // 图标清空则回退默认
    }
    persist();
    return copyObj(cat);
  }

  /**
   * 删除分类（预设分类同样允许删除）。
   * 若仍有账单记录使用该分类，则拒绝删除。
   * @param {string} id
   * @returns {true}
   * @throws {Error} '该分类下还有账单记录，无法删除'
   */
  function deleteCategory(id) {
    var data = getData();
    var used = data.records.some(function (r) {
      return r.categoryId === id;
    });
    if (used) {
      throw new Error('该分类下还有账单记录，无法删除');
    }
    data.categories = data.categories.filter(function (c) {
      return c.id !== id;
    });
    persist();
    return true;
  }

  // ==================== 对外 API：预算 ====================

  /**
   * 当前每月预算
   * @returns {number|null}
   */
  function getBudget() {
    return getData().budgets.monthly;
  }

  /**
   * 设置每月预算
   * @param {number|string|null} amount null 表示清除预算；正数表示预算金额
   * @returns {number|null} 设置后的值
   * @throws {Error} '预算不合法'
   */
  function setBudget(amount) {
    var data = getData();
    if (amount === null) {
      data.budgets.monthly = null;
      persist();
      return null;
    }
    var n = Number(amount);
    if (!isFinite(n) || n <= 0) {
      throw new Error('预算不合法');
    }
    data.budgets.monthly = round2(n);
    persist();
    return data.budgets.monthly;
  }

  // ==================== 对外 API：饮食（diet） ====================

  /**
   * 饮食数据域（个人资料 / 饮食记录 / 自定义食物 / 收藏 / 组合），返回副本
   * @returns {{profile:(Object|null), entries:Array, customFoods:Array,
   *            favorites:Array, combos:Array}}
   */
  function getDiet() {
    var d = getData().diet;
    return {
      profile: d.profile ? copyObj(d.profile) : null,
      entries: d.entries.map(copyObj),
      customFoods: d.customFoods.map(copyObj),
      favorites: d.favorites.slice(),
      combos: d.combos.map(function (c) {
        var cc = copyObj(c);
        cc.items = c.items.map(copyObj);
        return cc;
      })
    };
  }

  /**
   * 新增一条饮食记录（营养数值由调用方按食物库预先算好并快照传入）
   * @param {{date:string=, meal:string, foodId:string=, name:string, cat:string=,
   *          grams:number, kcal:number, protein:number=, fat:number=,
   *          carb:number=, note:string=}} input
   *        date 缺省/非法时记今天；meal 必须是早/午/晚/加餐之一
   * @returns {Object} 新记录
   * @throws {Error} '餐次不合法' / '克数不合法' / '热量数值不合法' / '食物名称不能为空'
   */
  function addDietEntry(input) {
    var opts = input || {};
    if (DIET_MEALS.indexOf(opts.meal) === -1) {
      throw new Error('餐次不合法');
    }
    var grams = Number(opts.grams);
    if (!isFinite(grams) || grams <= 0 || grams > 20000) {
      throw new Error('克数不合法');
    }
    var kcal = Number(opts.kcal);
    if (!isFinite(kcal) || kcal < 0 || kcal > 20000) {
      throw new Error('热量数值不合法');
    }
    var name = (typeof opts.name === 'string') ? opts.name.trim() : '';
    if (!name) {
      throw new Error('食物名称不能为空');
    }
    function macro(v) {
      var n = Number(v);
      return (isFinite(n) && n >= 0) ? Math.round(n * 10) / 10 : 0;
    }
    var data = getData();
    var seen = {};
    data.diet.entries.forEach(function (e) { seen[e.id] = true; });

    var rec = {
      id: makeUniqueId('d', seen),
      date: normalizeDateStr(opts.date) || todayStr(),
      meal: opts.meal,
      foodId: (typeof opts.foodId === 'string' && opts.foodId) ? opts.foodId : '',
      name: name.slice(0, 30),
      cat: (typeof opts.cat === 'string' && opts.cat) ? opts.cat : '',
      grams: Math.round(grams * 10) / 10,
      kcal: Math.round(kcal),
      protein: macro(opts.protein),
      fat: macro(opts.fat),
      carb: macro(opts.carb),
      note: normalizeNote(opts.note),
      createdAt: Date.now()
    };
    data.diet.entries.push(rec);
    persist();
    return copyObj(rec);
  }

  /**
   * 按 id 删除饮食记录
   * @param {string} id
   * @returns {true}
   */
  function deleteDietEntry(id) {
    var data = getData();
    data.diet.entries = data.diet.entries.filter(function (e) {
      return e.id !== id;
    });
    persist();
    return true;
  }

  /**
   * 保存个人资料（整体替换；字段不合法时抛异常，旧资料保持不变）
   * @param {{sex:string, age:number, height:number, weight:number,
   *          activity:number, goal:string, calorieBudget:(number|string|null)}} profile
   * @returns {Object} 保存后的资料
   * @throws {Error} '资料不完整或不合法'
   */
  function setDietProfile(profile) {
    var p = normalizeDietProfile(profile);
    if (!p) {
      throw new Error('资料不完整或不合法');
    }
    getData().diet.profile = p;
    persist();
    return copyObj(p);
  }

  /**
   * 新增自定义食物（同名查重）
   * @param {{name:string, k:number, p:number, f:number, c:number,
   *          g:number=, units:Array=}} input 每 100g 营养 + 默认一份克数
   * @returns {Object} 新食物
   * @throws {Error} '食物名称不能为空' / '自定义食物已存在'
   */
  function addCustomFood(input) {
    var nf = normalizeCustomFood(input, 0);
    if (!nf) {
      throw new Error('食物名称不能为空');
    }
    var customs = getData().diet.customFoods;
    for (var i = 0; i < customs.length; i++) {
      if (customs[i].name === nf.name) {
        throw new Error('自定义食物已存在');
      }
    }
    // 生成保证不重复的 id
    var seen = {};
    customs.forEach(function (c) { seen[c.id] = true; });
    nf.id = makeUniqueId('cf', seen);
    customs.push(nf);
    persist();
    return copyObj(nf);
  }

  /**
   * 按 id 删除自定义食物
   * @param {string} id
   * @returns {true}
   */
  function deleteCustomFood(id) {
    var data = getData();
    data.diet.customFoods = data.diet.customFoods.filter(function (c) {
      return c.id !== id;
    });
    persist();
    return true;
  }

  /**
   * 切换食物收藏状态（已收藏则取消，未收藏则加到最前；最多保留 12 个）
   * @param {string} foodId 食物 id（内置或自定义）
   * @returns {boolean} 调用后是否处于已收藏状态
   * @throws {Error} '食物 id 不合法'
   */
  function toggleFavorite(foodId) {
    if (typeof foodId !== 'string' || !foodId) {
      throw new Error('食物 id 不合法');
    }
    var favs = getData().diet.favorites;
    var idx = favs.indexOf(foodId);
    if (idx !== -1) {
      favs.splice(idx, 1);
      persist();
      return false;
    }
    favs.unshift(foodId);
    if (favs.length > FAVORITES_MAX) {
      favs.length = FAVORITES_MAX;
    }
    persist();
    return true;
  }

  /**
   * 新增常用组合（食物营养快照数组，与饮食记录同构但无 id/date）
   * @param {string} name 组合名称（1~20 字）
   * @param {Array<{foodId:string=, name:string, cat:string=, grams:number,
   *          kcal:number, protein:number=, fat:number=, carb:number=,
   *          meal:string=}>} items 非空，最多 20 条
   * @returns {Object} 新组合（含生成的 id）
   * @throws {Error} '组合名称不能为空' / '组合内容不能为空' / '组合最多保存 10 个'
   */
  function addCombo(name, items) {
    var n = (typeof name === 'string') ? name.trim() : '';
    if (!n) {
      throw new Error('组合名称不能为空');
    }
    var list = Array.isArray(items) ? items : [];
    var cleaned = [];
    list.forEach(function (it) {
      if (cleaned.length >= COMBO_ITEMS_MAX) {
        return;
      }
      var ni = normalizeComboItem(it);
      if (ni) cleaned.push(ni);
    });
    if (!cleaned.length) {
      throw new Error('组合内容不能为空');
    }
    var data = getData();
    if (data.diet.combos.length >= COMBOS_MAX) {
      throw new Error('组合最多保存 10 个');
    }
    var seen = {};
    data.diet.combos.forEach(function (c) { seen[c.id] = true; });
    var combo = {
      id: makeUniqueId('cb', seen),
      name: n.slice(0, 20),
      items: cleaned,
      createdAt: Date.now()
    };
    data.diet.combos.push(combo);
    persist();
    var copy = copyObj(combo);
    copy.items = combo.items.map(copyObj);
    return copy;
  }

  /**
   * 按 id 删除常用组合
   * @param {string} id
   * @returns {true}
   */
  function deleteCombo(id) {
    var data = getData();
    data.diet.combos = data.diet.combos.filter(function (c) {
      return c.id !== id;
    });
    persist();
    return true;
  }

  // ==================== 对外 API：统计 ====================

  /**
   * 某月收支汇总
   * @param {string=} ym 形如 '2026-10'，缺省时取当前月
   * @returns {{ym:string, income:number, expense:number, balance:number,
   *            count:number, total:number,
   *            byCategory:Array<{id,name,icon,color,total}>,
   *            incomeByCategory:Array<{id,name,icon,color,total}>,
   *            daily:Array<{date:string, expense:number, income:number, total:number}>}}
   *          income/expense：当月收入/支出总额（两位小数）；balance = income - expense；
   *          count：当月全部记录笔数（含收入）；
   *          total：保留旧字段含义 = expense（向后兼容预算逻辑）；
   *          byCategory：支出分类聚合（只含有支出的分类，total 降序）；
   *          incomeByCategory：收入分类聚合（只含有收入的分类，total 降序，结构同 byCategory）；
   *          daily：按 date 升序，只含有任一非零金额的日期；
   *                 total 为当日支出（旧字段，向后兼容，等价于 expense）
   */
  function getMonthSummary(ym) {
    var month = ym || currentYm();
    var list = getMonthRecords(month); // 已按日期倒序的记录副本
    var data = getData();

    var income = 0;
    var expense = 0;
    var expCatSums = {};   // 支出：categoryId -> 合计
    var expCatOrder = [];  // 保持首次出现顺序
    var incCatSums = {};   // 收入：categoryId -> 合计
    var incCatOrder = [];  // 保持首次出现顺序
    var dateSums = {};     // date -> {expense, income}

    list.forEach(function (r) {
      var amt = Number(r.amount) || 0;
      var isIncome = r.type === 'income';
      if (isIncome) {
        income += amt;
      } else {
        expense += amt;
      }
      var sums = isIncome ? incCatSums : expCatSums;
      var order = isIncome ? incCatOrder : expCatOrder;
      if (!hasOwn(sums, r.categoryId)) {
        sums[r.categoryId] = 0;
        order.push(r.categoryId);
      }
      sums[r.categoryId] += amt;
      if (!hasOwn(dateSums, r.date)) {
        dateSums[r.date] = { expense: 0, income: 0 };
      }
      if (isIncome) {
        dateSums[r.date].income += amt;
      } else {
        dateSums[r.date].expense += amt;
      }
    });

    // 分类信息查找表（指向已删除/未知分类时用兜底信息展示）
    var catMap = {};
    data.categories.forEach(function (c) {
      catMap[c.id] = c;
    });

    // 聚合数组构造：按 total 降序
    function buildAggregation(order, sums) {
      return order.map(function (cid) {
        var c = catMap[cid] || FALLBACK_CATEGORY;
        return {
          id: cid,
          name: c.name,
          icon: c.icon,
          color: c.color,
          total: round2(sums[cid])
        };
      }).sort(function (a, b) {
        return b.total - a.total; // total 降序
      });
    }

    // Object.keys 对 'YYYY-MM-DD' 的字典序即为时间升序；
    // 只保留支出/收入任一非零的日期
    var daily = Object.keys(dateSums).sort().map(function (d) {
      return {
        date: d,
        expense: round2(dateSums[d].expense),
        income: round2(dateSums[d].income)
      };
    }).filter(function (d) {
      return d.expense !== 0 || d.income !== 0;
    }).map(function (d) {
      d.total = d.expense; // 旧字段：原为当日支出合计，保持含义不变
      return d;
    });

    return {
      ym: month,
      income: round2(income),
      expense: round2(expense),
      balance: round2(income - expense),
      count: list.length,
      total: round2(expense), // 旧字段：原为当月支出合计，保持含义不变（预算逻辑依赖）
      byCategory: buildAggregation(expCatOrder, expCatSums),
      incomeByCategory: buildAggregation(incCatOrder, incCatSums),
      daily: daily
    };
  }

  /**
   * 最近 n 个月的收支趋势（含当前月，按月份升序，无数据的月份补 0）
   * @param {number=} n 月数，缺省 6；非法或小于 1 时按 6 处理
   * @returns {Array<{ym:string, income:number, expense:number}>}
   */
  function getMonthlyTrend(n) {
    var months = Math.floor(Number(n));
    if (!isFinite(months) || months < 1) {
      months = 6;
    }

    // 生成最近 months 个月的 ym（升序，含当前月），并预置 0 值
    var cur = currentYm();
    var buckets = {};   // ym -> {income, expense}
    var order = [];
    var i, ym;
    for (i = months - 1; i >= 0; i--) {
      ym = ymShift(cur, -i);
      buckets[ym] = { income: 0, expense: 0 };
      order.push(ym);
    }

    // 一次遍历全部记录，落入对应月份桶
    var records = getData().records;
    for (i = 0; i < records.length; i++) {
      ym = ymOf(records[i].date);
      if (hasOwn(buckets, ym)) {
        if (records[i].type === 'income') {
          buckets[ym].income += Number(records[i].amount) || 0;
        } else {
          buckets[ym].expense += Number(records[i].amount) || 0;
        }
      }
    }

    return order.map(function (m) {
      return {
        ym: m,
        income: round2(buckets[m].income),
        expense: round2(buckets[m].expense)
      };
    });
  }

  /**
   * 某月预算使用状态
   * @param {string=} ym 形如 '2026-10'，缺省时取当前月
   * @returns {{budget:number|null, spent:number, remaining:number,
   *            usedPct:number, level:'none'|'ok'|'warn'|'over'}}
   *          level：未设预算 'none'；超支 'over'；已达 80% 'warn'；否则 'ok'
   */
  function getBudgetStatus(ym) {
    var budget = getBudget();
    var spent = getMonthSummary(ym).total; // total 恒等于当月支出合计，收入不占用预算
    if (budget === null) {
      // 未设置预算：usedPct、remaining 固定为 0
      return { budget: null, spent: spent, remaining: 0, usedPct: 0, level: 'none' };
    }
    return {
      budget: budget,
      spent: spent,
      remaining: round2(budget - spent),          // 可为负
      usedPct: Math.round(spent / budget * 100),  // 四舍五入取整百分比
      level: spent >= budget ? 'over'
        : (spent >= budget * 0.8 ? 'warn' : 'ok')
    };
  }

  // ==================== 对外 API：导入导出 ====================

  /**
   * 导出完整备份（美化格式 JSON 字符串）。
   * 导出即视为完成一次备份：生成 JSON 前把 lastBackupAt 记为当前时间并持久化。
   * 记录的可选商品明细（items）随记录一并导出。
   * @returns {string} { meta:{app,version,exportedAt}, records, categories,
   *                     budgets, lastBackupAt }
   */
  function exportJSON() {
    var data = getData();
    data.lastBackupAt = Date.now(); // 导出即备份：记录备份完成时间
    persist();
    return JSON.stringify({
      meta: {
        app: 'xiaozhangben',
        version: 1,
        exportedAt: new Date().toISOString() // 元信息用 ISO 时间，便于跨时区识别
      },
      records: data.records,
      categories: data.categories,
      budgets: data.budgets,
      diet: data.diet,
      lastBackupAt: data.lastBackupAt
    }, null, 2);
  }

  /**
   * 从 JSON 字符串导入并整体替换现有数据。
   * 先完整校验、构造好新数据后再替换保存；任何异常都不会破坏现有数据。
   * 元素缺字段时合理补全：record 补 id/createdAt/type（type 白名单校验，
   * 非法回落 'expense'；日期缺省补今天、categoryId 缺省补 'qita'、note 缺省补空串），
   * category 补 icon/color/sort/custom/kind，整体补 lastBackupAt。
   * 旧格式备份（无 lastBackupAt/kind）同样可导入，导入后按 load 规则执行
   * 收入分类迁移（无收入分类时自动补挂默认收入分类）。
   * @param {string} text
   * @returns {{ok:boolean, error?:string}} 失败时 error 固定为
   *          '文件格式不正确或数据已损坏'，绝不抛异常
   */
  function importJSON(text) {
    try {
      var parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('根节点必须是对象');
      }
      if (!Array.isArray(parsed.records) || !Array.isArray(parsed.categories)) {
        throw new Error('records/categories 必须是数组');
      }
      if (!parsed.budgets || typeof parsed.budgets !== 'object' || Array.isArray(parsed.budgets)) {
        throw new Error('budgets 必须是对象');
      }

      var i, c, n;

      // ---- 分类：先统计已有最大 sort，缺 sort 的依次顺延 ----
      var maxSort = 0;
      for (i = 0; i < parsed.categories.length; i++) {
        c = parsed.categories[i];
        if (!c || typeof c !== 'object' || Array.isArray(c)) {
          throw new Error('分类元素非法');
        }
        n = Number(c.sort);
        if (isFinite(n) && n > 0 && n > maxSort) {
          maxSort = n;
        }
      }
      var nextSort = maxSort;
      var catSeen = {};
      var categories = [];
      for (i = 0; i < parsed.categories.length; i++) {
        c = parsed.categories[i];
        var name = (typeof c.name === 'string') ? c.name.trim() : '';
        if (!name) {
          throw new Error('分类缺少有效名称');
        }
        n = Number(c.sort);
        var sort;
        if (isFinite(n) && n > 0) {
          sort = n;
        } else {
          nextSort += 1; // 缺 sort：顺延补全
          sort = nextSort;
        }
        var icon = (typeof c.icon === 'string' && c.icon.trim()) ? c.icon.trim() : '🏷️';
        var color = (typeof c.color === 'string' && COLOR_RE.test(c.color.trim()))
          ? c.color.trim() : paletteColor(sort);
        var cid = (typeof c.id === 'string' && c.id && !catSeen[c.id])
          ? c.id : makeUniqueId('c', catSeen, i);
        catSeen[cid] = true; // 外部提供的 id 也要登记，防止后续重复
        categories.push({
          id: cid,
          name: name,
          icon: icon,
          color: color,
          kind: (c.kind === 'expense' || c.kind === 'income') ? c.kind : 'expense', // 旧备份缺 kind 补 'expense'
          custom: (typeof c.custom === 'boolean') ? c.custom : true, // 缺省视为自定义分类
          sort: sort
        });
      }

      // ---- 记录 ----
      var recSeen = {};
      var records = [];
      for (i = 0; i < parsed.records.length; i++) {
        var r = parsed.records[i];
        if (!r || typeof r !== 'object' || Array.isArray(r)) {
          throw new Error('记录元素非法');
        }
        var amount = round2(Number(r.amount));
        if (!isFinite(amount) || amount <= 0) {
          throw new Error('记录金额非法'); // 金额无法凭空补全，视为数据损坏
        }
        var date;
        if (normalizeDateStr(r.date)) {
          date = normalizeDateStr(r.date);
        } else if (r.date === null || r.date === undefined || r.date === '') {
          date = todayStr(); // 缺日期：补今天
        } else {
          throw new Error('记录日期非法');
        }
        var createdAt = Number(r.createdAt);
        var rid = (typeof r.id === 'string' && r.id && !recSeen[r.id])
          ? r.id : makeUniqueId('r', recSeen, i);
        recSeen[rid] = true; // 外部提供的 id 也要登记，防止后续重复
        var rec = {
          id: rid,
          type: (r.type === 'expense' || r.type === 'income') ? r.type : 'expense', // 白名单校验，非法回落支出
          amount: amount,
          categoryId: normalizeCategoryId(r.categoryId),
          date: date,
          note: normalizeNote(r.note),
          createdAt: isFinite(createdAt) ? createdAt : Date.now()
        };
        // 可选商品明细：新备份带 items 走同一套清洗；
        // 旧备份（无 items）保持记录无 items 键，完全兼容
        var recItems = normalizeRecordItems(r.items);
        if (recItems) {
          rec.items = recItems;
        }
        records.push(rec);
      }

      // ---- 预算 ----
      var monthly = null;
      var mb = parsed.budgets.monthly;
      if (mb !== null && mb !== undefined) {
        var bn = Number(mb);
        if (!isFinite(bn) || bn <= 0) {
          throw new Error('预算数值非法');
        }
        monthly = round2(bn);
      }

      // ---- 饮食（旧格式备份无 diet 字段时得到空默认值） ----
      var diet = sanitizeDiet(parsed.diet);

      // ---- 校验全部通过，才整体替换并保存 ----
      _data = { records: records, categories: categories, budgets: { monthly: monthly },
        diet: diet, lastBackupAt: null };
      // 新格式备份自带 lastBackupAt；旧格式备份没有，保持 null
      if (typeof parsed.lastBackupAt === 'number' && isFinite(parsed.lastBackupAt)) {
        _data.lastBackupAt = parsed.lastBackupAt;
      }
      // 兼容旧备份：导入的数据不含收入分类时，自动补挂默认收入分类
      ensureIncomeCategories(_data);
      persist();
      return { ok: true };
    } catch (e) {
      console.warn('[core.js] 导入失败：', e && e.message ? e.message : e);
      return { ok: false, error: '文件格式不正确或数据已损坏' };
    }
  }

  /**
   * 商品明细 → CSV 单元格文本：「名称x数量(金额)」以「; 」连接，
   * 如 '苹果x1(5.50); 牛奶x2(12.80)'。金额取明细单价 price（两位小数），
   * 不是 qty*price，也与账单 amount 无关（约定二者相互独立）。
   * 无明细（items 缺失/为空）返回空串
   * @param {Array=} items
   * @returns {string}
   */
  function recordItemsText(items) {
    if (!Array.isArray(items) || !items.length) {
      return '';
    }
    return items.map(function (it) {
      return it.name + 'x' + String(Number(it.qty)) + '(' + formatAmount(it.price) + ')';
    }).join('; ');
  }

  /**
   * 导出某月账单 CSV（带 BOM，Excel 打开中文不乱码）
   * @param {string=} ym 形如 '2026-10'，缺省时取当前月
   * @returns {string} 首字符为 '\uFEFF'，表头：日期,类型,分类,金额,备注,商品明细
   *          类型列写「支出/收入」；金额恒为正数（收入同样输出正数）；
   *          表头升级（备注后新增「商品明细」列）：有明细填「名称x数量(金额)」
   *          以「; 」连接，无明细填空；含逗号/引号的单元格沿用 csvField 双引号转义
   */
  function exportCSV(ym) {
    var month = ym || currentYm();
    var data = getData();

    // 分类 id -> 名称 查找表
    var catMap = {};
    data.categories.forEach(function (c) {
      catMap[c.id] = c;
    });

    var lines = ['\uFEFF日期,类型,分类,金额,备注,商品明细']; // 表头升级：备注后新增「商品明细」列
    getMonthRecords(month).forEach(function (r) {
      var cat = catMap[r.categoryId];
      var catName = cat ? cat.name : FALLBACK_CATEGORY.name;
      lines.push(
        csvField(r.date) + ',' +
        csvField(r.type === 'income' ? '收入' : '支出') + ',' +
        csvField(catName) + ',' +
        formatAmount(r.amount) + ',' +
        csvField(r.note) + ',' +
        csvField(recordItemsText(r.items))
      );
    });
    return lines.join('\r\n');
  }

  /**
   * CSV 字段转义：含逗号/双引号/换行时用双引号包裹，内部双引号翻倍
   * @param {*} v
   * @returns {string}
   */
  function csvField(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  // ==================== 对外 API：格式化与日期工具 ====================

  /**
   * 金额格式化为两位小数字符串
   * @param {*} n
   * @returns {string} 如 '25.50'；非法输入兜底为 '0.00'
   */
  function formatAmount(n) {
    var num = Number(n);
    if (!isFinite(num)) {
      num = 0;
    }
    return num.toFixed(2);
  }

  /**
   * 本地时区今天，'YYYY-MM-DD'（手动拼接，避免 UTC 偏移）
   * @returns {string}
   */
  function todayStr() {
    return dateToStr(new Date());
  }

  /**
   * 从日期字符串取年月
   * @param {string|Date} dateStr '2026-10-01'（或 Date 对象）
   * @returns {string} '2026-10'；无法识别时返回空串
   */
  function ymOf(dateStr) {
    if (dateStr instanceof Date && !isNaN(dateStr.getTime())) {
      return dateStr.getFullYear() + '-' + pad2(dateStr.getMonth() + 1);
    }
    return String(dateStr === null || dateStr === undefined ? '' : dateStr).slice(0, 7);
  }

  /**
   * 当前年月，'2026-10'
   * @returns {string}
   */
  function currentYm() {
    return todayStr().slice(0, 7);
  }

  // ==================== 导出全局对象 ====================

  return {
    // 加载与保存
    load: load,
    save: save,
    // 多账户数据隔离
    setUser: setUser,
    storageUser: storageUser,
    // 账单记录
    getRecords: getRecords,
    getMonthRecords: getMonthRecords,
    getRecord: getRecord,
    addRecord: addRecord,
    updateRecord: updateRecord,
    deleteRecord: deleteRecord,
    // 搜索
    searchRecords: searchRecords,
    // 分类
    getCategories: getCategories,
    addCategory: addCategory,
    updateCategory: updateCategory,
    deleteCategory: deleteCategory,
    // 预算
    getBudget: getBudget,
    setBudget: setBudget,
    // 饮食（diet）
    getDiet: getDiet,
    addDietEntry: addDietEntry,
    deleteDietEntry: deleteDietEntry,
    setDietProfile: setDietProfile,
    addCustomFood: addCustomFood,
    deleteCustomFood: deleteCustomFood,
    toggleFavorite: toggleFavorite,
    addCombo: addCombo,
    deleteCombo: deleteCombo,
    // 统计
    getMonthSummary: getMonthSummary,
    getMonthlyTrend: getMonthlyTrend,
    getBudgetStatus: getBudgetStatus,
    // 导入导出
    exportJSON: exportJSON,
    importJSON: importJSON,
    exportCSV: exportCSV,
    // 工具
    formatAmount: formatAmount,
    todayStr: todayStr,
    ymOf: ymOf,
    currentYm: currentYm
  };
})();
