/**
 * diet-nlp.js —— 小账本 · 自然语言记餐解析模块（v2）
 *
 * 暴露全局对象 DietNLP（普通 <script> 引入，无模块系统，不操作 DOM）。
 * 依赖：core.js（Store）、food-db.js（FOOD_DB）、diet.js（Diet）。
 * 用途：把用户随手敲的一句话（如「早上一碗粥一个鸡蛋一杯豆浆」）
 *       解析成多条可直接入库的饮食记录。
 *
 * 对外 API：
 *   DietNLP.parse(text) —— 解析结果对象：
 *     {
 *       ok: Boolean,          // 至少解析出一种可识别食物才为 true
 *       meal: String,         // 餐次 'breakfast'|'lunch'|'dinner'|'snack'
 *                             //（文本提到早/午/晚/加餐时采用，否则按当前小时推断）
 *       items: [              // 按出现顺序
 *         { matched:true,  foodId, name, cat, count, unitName,
 *           grams, kcal, protein, fat, carb },   // 已识别：营养已按克数算好
 *         { matched:false, name }                  // 未识别：保留原文供提示
 *       ]
 *     }
 *   text 非法（空/非字符串）时返回 { ok:false, meal:按小时, items:[] }。
 *
 * 解析规则（纯本地，词典 + 正则，无任何 AI）：
 *   1. 餐次：早上/早餐/午饭/中午/晚餐/晚上/夜宵/下午茶 等关键词，命中即剔除；
 *   2. 分段：用「数量+量词」（一碗/2个/半块…）作为分段锚点把句子切开，
 *      第一段（无数量词的前置文本，如「喝了牛奶」）按 1 份处理；
 *   3. 数量：中文数字（一两…十/半）与阿拉伯数字均可；「份」或未知量词
 *      回落到食物默认一份克数；
 *   4. 食物匹配：名称精确 → 别名表（西红柿→番茄等）→ 前缀 → 食物名包含于
 *      文本（取最长最具体）→ 文本包含食物名（取最短），自定义食物优先；
 *   5. 清洗：剔除「吃了/喝了/再/和/跟」等连接词与首尾标点。
 *
 * 已知边界（有意不支持，保持实现简单可靠）：
 *   - 复合菜名描述（「番茄炒蛋不放盐」）按包含匹配尽力识别，不拆分修饰词；
 *   - 「十个饺子」以上中文数字（十一、二十）不解析，请用阿拉伯数字；
 *   - 小数中文数量（一个半）不解析；
 *   - 量词与食物库单位不一致时回落到食物默认一份克数（如「一根香蕉」
 *     命中「根」单位则用 120g，写「一条香蕉」则回落默认 120g）。
 */
var DietNLP = (function () {
  'use strict';

  /* ==================== 常量 ==================== */

  /** 餐次关键词（命中后从原文剔除；同一餐次多个词取最靠前最长的） */
  var MEAL_WORDS = {
    breakfast: ['早上', '早晨', '清早', '早餐', '早饭'],
    lunch: ['中午', '午间', '午餐', '午饭'],
    dinner: ['晚上', '晚间', '晚餐', '晚饭'],
    snack: ['加餐', '夜宵', '宵夜', '下午茶', '零食']
  };

  /** 中文数字 → 数值（「十」只按 10 处理，不支持「十一/二十」） */
  var NUM_MAP = {
    '一': 1, '壹': 1, '二': 2, '两': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '半': 0.5
  };

  /** 数量+量词锚点（分段用）：阿拉伯数字或中文数字 + 常见量词（含「克」直写） */
  var QTY_RE = /([0-9]+(?:\.[0-9]+)?|[一二两三四五六七八九十半])\s*(克|碗|个|根|杯|份|片|块|串|颗|只|盒|罐|瓶|包|勺|两|听|支|枚|粒)/g;

  /** 常见别名 → 食物库标准名（仅收录叫法差异大的少量词） */
  var ALIAS = {
    '西红柿': '番茄',
    '蕃茄': '番茄',
    '地瓜': '红薯',
    '番薯': '红薯',
    '洋芋': '土豆',
    '包谷': '玉米',
    '马铃薯': '土豆',
    '鸡旦': '鸡蛋',
    '生菜叶': '生菜'
  };

  /** 食物名前后需要剔除的连接词/动词/语气词 */
  var EDGE_WORDS_RE = /^(?:了|再|来|吃|喝|加|点|还|先|又)+|(?:了|和|跟|与|还|再|以及|外加)+$/g;

  /* ==================== 内部工具 ==================== */

  /**
   * 从句子中识别餐次：取最靠前命中的关键词（同位置取最长词），
   * 命中的词从原文中剔除；未命中返回 null
   * @param {string} text 原文（会被就地改写）
   * @returns {{meal:(string|null), text:string}}
   */
  function extractMeal(text) {
    var best = null;
    Object.keys(MEAL_WORDS).forEach(function (meal) {
      MEAL_WORDS[meal].forEach(function (word) {
        var idx = text.indexOf(word);
        if (idx === -1) return;
        if (!best || idx < best.idx || (idx === best.idx && word.length > best.word.length)) {
          best = { meal: meal, idx: idx, word: word };
        }
      });
    });
    if (!best) {
      return { meal: null, text: text };
    }
    return { meal: best.meal, text: text.slice(0, best.idx) + text.slice(best.idx + best.word.length) };
  }

  /**
   * 中文/阿拉伯数字数量文本 → 数值；无法识别返回 null。
   * 「克」直写（200克鸡胸肉）数量上限放宽到 2000，其余量词上限 50
   * @param {string} raw
   * @param {string=} unit 量词（用于确定数量上限）
   * @returns {number|null}
   */
  function parseQty(raw, unit) {
    var max = unit === '克' ? 2000 : 50;
    if (/^[0-9]+(?:\.[0-9]+)?$/.test(raw)) {
      var n = parseFloat(raw);
      return (isFinite(n) && n > 0 && n <= max) ? n : null;
    }
    var v = Object.prototype.hasOwnProperty.call(NUM_MAP, raw) ? NUM_MAP[raw] : null;
    return (v !== null && v <= max) ? v : null;
  }

  /**
   * 清洗食物片段：去首尾标点/空白，剥掉首尾的动词与连接词
   * @param {string} s
   * @returns {string}
   */
  function cleanFoodText(s) {
    var t = String(s == null ? '' : s).replace(/[，,。；;！!？?、\s]+/g, ' ').trim();
    // 逐次剥边，处理「吃了和」这类叠加（循环次数有上限，防异常输入死循环）
    for (var i = 0; i < 4; i++) {
      var before = t;
      t = t.replace(EDGE_WORDS_RE, '').trim();
      if (t === before) break;
    }
    return t;
  }

  /**
   * 为食物解析克数：「克」直写时数量即克数；量词命中食物自带单位用之；
   * 否则回落默认一份克数
   * @param {{g:number, units:Array}} food
   * @param {number} qty 数量
   * @param {string} unit 量词
   * @returns {number}
   */
  function resolveGrams(food, qty, unit) {
    if (unit === '克') {
      return Math.round(qty * 10) / 10;
    }
    for (var i = 0; i < food.units.length; i++) {
      if (food.units[i][0] === unit) {
        return Math.round(qty * food.units[i][1] * 10) / 10;
      }
    }
    return Math.round(qty * (food.g || 100) * 10) / 10;
  }

  /**
   * 食物名匹配（自定义食物与内置库统一参与，逐层降级）：
   *   1 精确同名 → 2 文本是食物名前缀（取最短名）→ 3 食物名包含于文本
   *   （取最长名，最具体）→ 4 文本包含食物名（取最短名）；
   *   全部落空后按别名表改写（西红柿→番茄等）再走一遍 1~4
   * @param {string} q 清洗后的食物片段
   * @returns {Object|null} 命中的食物对象
   */
  function findBestFood(q) {
    if (!q) return null;
    var foods = Diet.getFoods();

    function scan(query) {
      var i, f, best;
      // 1 精确同名
      for (i = 0; i < foods.length; i++) {
        if (foods[i].name === query) return foods[i];
      }
      // 2 前缀：食物名以 query 开头（取最短名）
      best = null;
      for (i = 0; i < foods.length; i++) {
        f = foods[i];
        if (f.name.indexOf(query) === 0 && (!best || f.name.length < best.name.length)) best = f;
      }
      if (best) return best;
      // 3 食物名包含于文本（取最长名，如「一碗妈妈牌红烧肉」优先命中更长的自定义名）
      best = null;
      for (i = 0; i < foods.length; i++) {
        f = foods[i];
        if (query.indexOf(f.name) !== -1 && (!best || f.name.length > best.name.length)) best = f;
      }
      if (best) return best;
      // 4 文本包含食物名（取最短名）
      best = null;
      for (i = 0; i < foods.length; i++) {
        f = foods[i];
        if (f.name.indexOf(query) !== -1 && (!best || f.name.length < best.name.length)) best = f;
      }
      return best;
    }

    var hit = scan(q);
    if (!hit && Object.prototype.hasOwnProperty.call(ALIAS, q)) {
      hit = scan(ALIAS[q]);
    }
    return hit;
  }

  /* ==================== 对外 API ==================== */

  /**
   * 解析一句自然语言饮食描述
   * @param {string} text 如「早上一碗粥一个鸡蛋一杯豆浆」
   * @returns {{ok:boolean, meal:string, items:Array}}
   */
  function parse(text) {
    var fail = { ok: false, meal: Diet.mealByHour(), items: [] };
    if (typeof text !== 'string' || !text.trim()) {
      return fail;
    }

    // 1. 餐次
    var withMeal = extractMeal(text);
    var meal = withMeal.meal;
    var rest = withMeal.text;

    // 2. 以「数量+量词」为锚点分段
    var anchors = [];
    var m;
    QTY_RE.lastIndex = 0;
    while ((m = QTY_RE.exec(rest)) !== null) {
      anchors.push({ qtyRaw: m[1], unit: m[2], idx: m.index, len: m[0].length });
      if (anchors.length >= 12) break; // 一句话最多解析 12 种食物
    }

    var items = [];

    function pushItem(foodText, qty, unit) {
      foodText = cleanFoodText(foodText);
      if (!foodText) return;
      var food = findBestFood(foodText);
      if (!food) {
        items.push({ matched: false, name: foodText });
        return;
      }
      var grams = resolveGrams(food, qty, unit);
      var n = Diet.computeNutrition(food, grams);
      items.push({
        matched: true,
        foodId: food.id,
        name: food.name,
        cat: food.cat,
        count: qty,
        unitName: unit,
        grams: grams,
        kcal: n.kcal,
        protein: n.protein,
        fat: n.fat,
        carb: n.carb
      });
    }

    // 第一段（第一个锚点之前的文本）：如「喝了牛奶」按 1 份处理
    var head = anchors.length ? rest.slice(0, anchors[0].idx) : rest;
    var headFood = cleanFoodText(head);
    if (headFood) {
      pushItem(headFood, 1, '份');
    }
    for (var i = 0; i < anchors.length; i++) {
      var end = i + 1 < anchors.length ? anchors[i + 1].idx : rest.length;
      pushItem(rest.slice(anchors[i].idx + anchors[i].len, end),
        parseQty(anchors[i].qtyRaw, anchors[i].unit) || 1, anchors[i].unit);
    }

    var matchedCount = items.filter(function (it) { return it.matched; }).length;
    return {
      ok: matchedCount > 0,
      meal: meal || Diet.mealByHour(),
      items: items
    };
  }

  return {
    parse: parse
  };
})();
