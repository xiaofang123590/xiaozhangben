/**
 * diet.js —— 小账本 · 饮食逻辑模块
 *
 * 暴露全局对象 Diet（普通 <script> 引入，无模块系统，不操作 DOM）。
 * 依赖：core.js（Store，diet 数据域）、food-db.js（FOOD_DB，内置食物库）。
 *
 * 职责：
 *   1. 食物查询：内置库 + 各账户自定义食物合并检索；
 *   2. 营养计算：克数 → 热量/三大营养素；
 *   3. 目标计算：个人资料 → BMR（Mifflin-St Jeor）→ TDEE → 每日热量与营养素目标；
 *   4. 日汇总：某天摄入合计、营养素合计、蔬果奶份量、分餐统计；
 *   5. 建议引擎：纯本地规则，输出结构化的健康饮食建议（可解释、离线可用）。
 *
 * 约定：所有数字输出已经过容错清洗；不抛异常（输入非法时返回空/默认值）。
 * 免责：营养数值为估算，建议仅供日常健康管理参考，不构成医疗建议。
 */
var Diet = (function () {
  'use strict';

  /* ==================== 常量 ==================== */

  /** 餐次白名单与显示名（顺序即展示顺序） */
  var MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
  var MEAL_NAMES = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' };

  /** 活动系数（1 久坐 / 2 轻度 / 3 中度 / 4 高强度） */
  var ACTIVITY_FACTOR = { 1: 1.2, 2: 1.375, 3: 1.55, 4: 1.725 };
  var ACTIVITY_NAMES = { 1: '久坐少动', 2: '轻度活动', 3: '中度活动', 4: '高强度' };

  /** 目标显示名 */
  var GOAL_NAMES = { lose: '减脂', keep: '保持体重', gain: '增肌' };

  /** 减脂/维持/增肌的热量修正与蛋白质系数（g/kg 体重） */
  var GOAL_RULES = {
    lose: { delta: -400, proteinPerKg: 1.5 },
    keep: { delta: 0,    proteinPerKg: 1.0 },
    gain: { delta: 300,  proteinPerKg: 1.5 }
  };

  /** 蔬菜/水果/奶制品的每日推荐量（g，与个人资料无关的通用建议值） */
  var DAILY_VEG = 300;
  var DAILY_FRUIT = 200;
  var DAILY_DAIRY = 250;

  /* ==================== 内部工具 ==================== */

  /** 数字容错：非法/负数返回 0，保留 n 位小数（缺省 1 位） */
  function num(v, digits) {
    var n = Number(v);
    if (!isFinite(n) || n < 0) n = 0;
    var d = digits === undefined ? 1 : digits;
    var m = Math.pow(10, d);
    return Math.round(n * m) / m;
  }

  /** 营养素 × 克数：每 100g 基准换算 */
  function scale(per100, grams) {
    return per100 * (Number(grams) || 0) / 100;
  }

  /* ==================== 食物查询 ==================== */

  /**
   * 全部可用食物：内置库 + 当前账户的自定义食物
   * @returns {Array}
   */
  function getFoods() {
    var list = [];
    for (var i = 0; i < FOOD_DB.foods.length; i++) list.push(FOOD_DB.foods[i]);
    var customs = Store.getDiet().customFoods;
    for (var j = 0; j < customs.length; j++) {
      list.push({
        id: customs[j].id, name: customs[j].name, cat: 'custom',
        k: customs[j].k, p: customs[j].p, f: customs[j].f, c: customs[j].c,
        g: customs[j].g, units: customs[j].units || [], lean: false
      });
    }
    return list;
  }

  /** 按 id 查食物（先内置库再自定义），找不到返回 null */
  function findFood(id) {
    var builtin = FOOD_DB.find(id);
    if (builtin) return builtin;
    var customs = Store.getDiet().customFoods;
    for (var i = 0; i < customs.length; i++) {
      if (customs[i].id === id) {
        return {
          id: customs[i].id, name: customs[i].name, cat: 'custom',
          k: customs[i].k, p: customs[i].p, f: customs[i].f, c: customs[i].c,
          g: customs[i].g, units: customs[i].units || [], lean: false
        };
      }
    }
    return null;
  }

  /**
   * 按名称子串搜索（自定义食物优先展示）
   * @param {string} q
   * @param {number=} limit 缺省 8
   */
  function searchFoods(q, limit) {
    var max = Math.max(1, Math.floor(Number(limit) || 8));
    var kw = String(q == null ? '' : q).trim().toLowerCase();
    if (!kw) return [];
    var all = getFoods();
    var out = [];
    // 自定义食物优先
    for (var i = 0; i < all.length && out.length < max; i++) {
      if (all[i].cat === 'custom' && all[i].name.toLowerCase().indexOf(kw) !== -1) {
        out.push(all[i]);
      }
    }
    for (var j = 0; j < all.length && out.length < max; j++) {
      if (all[j].cat !== 'custom' && all[j].name.toLowerCase().indexOf(kw) !== -1) {
        out.push(all[j]);
      }
    }
    return out;
  }

  /** 分组信息透传 */
  function catOf(catId) {
    return FOOD_DB.catOf(catId);
  }

  /* ==================== 餐次 ==================== */

  /** 按当前小时推断默认餐次 */
  function mealByHour() {
    var h = new Date().getHours();
    if (h < 10) return 'breakfast';
    if (h < 14) return 'lunch';
    if (h < 17) return 'snack';
    if (h < 21) return 'dinner';
    return 'snack';
  }

  function mealName(meal) {
    return MEAL_NAMES[meal] || MEAL_NAMES.snack;
  }

  /* ==================== 营养计算 ==================== */

  /**
   * 按克数计算营养
   * @param {{k:number,p:number,f:number,c:number}} food
   * @param {number} grams
   * @returns {{kcal:number, protein:number, fat:number, carb:number}} kcal 取整，其余 1 位小数
   */
  function computeNutrition(food, grams) {
    var g = Number(grams) || 0;
    if (!food) return { kcal: 0, protein: 0, fat: 0, carb: 0 };
    return {
      kcal: Math.round(scale(food.k, g)),
      protein: num(scale(food.p, g)),
      fat: num(scale(food.f, g)),
      carb: num(scale(food.c, g))
    };
  }

  /* ==================== 目标计算 ==================== */

  /**
   * 根据个人资料计算每日目标；未设置资料返回 null。
   * BMR：Mifflin-St Jeor；TDEE = BMR × 活动系数；
   * 热量 = TDEE + 目标修正（减脂 -400 / 增肌 +300），并可被用户自定义值覆盖；
   * 蛋白质 = 体重 × 系数；脂肪 = 热量 × 28% ÷ 9；碳水 = 剩余 ÷ 4（下限 50g）。
   * @returns {{bmr:number, tdee:number, kcal:number, protein:number,
   *            fat:number, carb:number, goal:string, activity:number}|null}
   */
  function getTargets() {
    var p = Store.getDiet().profile;
    if (!p) return null;

    var bmr;
    if (p.sex === 'female') {
      bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age - 161;
    } else {
      bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + 5;
    }
    bmr = Math.round(bmr);

    var factor = ACTIVITY_FACTOR[p.activity] || 1.2;
    var tdee = Math.round(bmr * factor);

    var rule = GOAL_RULES[p.goal] || GOAL_RULES.keep;
    var kcal = p.calorieBudget || (tdee + rule.delta);
    // 热量下限兜底，避免计算出危险低值
    var floor = p.sex === 'female' ? 1200 : 1500;
    if (kcal < floor) kcal = floor;
    kcal = Math.round(kcal / 10) * 10;

    var protein = Math.round(p.weight * rule.proteinPerKg);
    var fat = Math.round(kcal * 0.28 / 9);
    var carb = Math.max(50, Math.round((kcal - protein * 4 - fat * 9) / 4));

    return {
      bmr: bmr, tdee: tdee, kcal: kcal,
      protein: protein, fat: fat, carb: carb,
      goal: p.goal, activity: p.activity
    };
  }

  /* ==================== 日汇总 ==================== */

  /**
   * 某天的全部饮食记录（按创建时间升序）
   * @param {string} date 'YYYY-MM-DD'
   * @returns {Array}
   */
  function getDayEntries(date) {
    var diet = Store.getDiet();
    return diet.entries.filter(function (e) {
      return e.date === date;
    }).sort(function (a, b) {
      return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
    });
  }

  /**
   * 某天摄入汇总
   * @param {string} date
   * @returns {{kcal:number, protein:number, fat:number, carb:number,
   *            vegG:number, fruitG:number, dairyG:number,
   *            byMeal:{breakfast:{kcal,count}, lunch:{...}, dinner:{...}, snack:{...}},
   *            count:number}}
   */
  function daySummary(date) {
    var entries = getDayEntries(date);
    var s = {
      kcal: 0, protein: 0, fat: 0, carb: 0,
      vegG: 0, fruitG: 0, dairyG: 0,
      byMeal: { breakfast: { kcal: 0, count: 0 }, lunch: { kcal: 0, count: 0 },
                dinner: { kcal: 0, count: 0 }, snack: { kcal: 0, count: 0 } },
      count: entries.length
    };
    entries.forEach(function (e) {
      s.kcal += Number(e.kcal) || 0;
      s.protein += Number(e.protein) || 0;
      s.fat += Number(e.fat) || 0;
      s.carb += Number(e.carb) || 0;
      if (e.cat === 'veg') s.vegG += Number(e.grams) || 0;
      else if (e.cat === 'fruit') s.fruitG += Number(e.grams) || 0;
      else if (e.cat === 'dairy') s.dairyG += Number(e.grams) || 0;
      if (s.byMeal[e.meal]) {
        s.byMeal[e.meal].kcal += Number(e.kcal) || 0;
        s.byMeal[e.meal].count += 1;
      }
    });
    s.kcal = Math.round(s.kcal);
    s.protein = num(s.protein);
    s.fat = num(s.fat);
    s.carb = num(s.carb);
    return s;
  }

  /* ==================== 建议引擎 ==================== */

  /**
   * 生成某天的健康饮食建议（纯本地规则）。
   * 输出条目不超过 5 条，按「热量超标 > 营养缺口 > 时段提醒」优先级排序。
   * @param {string} date 'YYYY-MM-DD'
   * @returns {{items:Array<{icon:string, text:string, tone:'good'|'warn'|'info'}>,
   *            good:boolean}} good 表示整体状况良好
   */
  function advise(date) {
    var items = [];
    var s = daySummary(date);
    var targets = getTargets();
    var isToday = date === Store.todayStr();
    var hour = new Date().getHours();

    // 无任何记录：只给轻提示
    if (!s.count) {
      if (isToday && hour >= 20) {
        items.push({ icon: '🌙', text: '今天还没有记录饮食，回忆一下补上吧（可补记昨天之前的日期）', tone: 'info' });
      } else {
        items.push({ icon: '🍽️', text: '这一天还没有饮食记录，先在上方记一餐吧', tone: 'info' });
      }
      return { items: items, good: false };
    }

    // ---- 热量 ----
    if (targets) {
      var pct = targets.kcal > 0 ? s.kcal / targets.kcal : 0;
      if (pct > 1.1) {
        items.push({ icon: '🚨', text: '今日摄入已超过预算 ' + Math.round((pct - 1) * 100) +
          '%（' + s.kcal + ' / ' + targets.kcal + ' 千卡），晚间活动量大的话不必焦虑，明天适当平衡即可', tone: 'warn' });
      } else if (pct >= 0.8 && pct <= 1.1) {
        items.push({ icon: '✅', text: '今日热量 ' + s.kcal + ' 千卡，落在预算区间内，节奏不错', tone: 'good' });
      } else if (pct < 0.5 && isToday && hour >= 19) {
        items.push({ icon: '🍚', text: '今日热量只用了预算的 ' + Math.round(pct * 100) +
          '%，还剩 ' + (targets.kcal - s.kcal) + ' 千卡，别饿着肚子睡觉', tone: 'info' });
      }
    } else {
      items.push({ icon: '⚙️', text: '完善下方「个人资料」后，可以获得个性化热量预算和营养建议', tone: 'info' });
    }

    // ---- 蛋白质 ----
    var proteinTarget = targets ? targets.protein : 55; // 无资料时用通用下限
    if (s.protein < proteinTarget * 0.8) {
      var gap = Math.max(0, Math.round(proteinTarget - s.protein));
      var remain = targets ? targets.kcal - s.kcal : 9999;
      var picks = remain < 300
        ? '鸡胸肉、虾、无糖酸奶、鸡蛋白、豆腐'          // 热量余量小：推荐低脂蛋白
        : '鸡蛋、牛奶、瘦肉、鱼虾、豆制品';
      items.push({ icon: '🍗', text: '蛋白质还差约 ' + gap + 'g，推荐补充：' + picks, tone: 'warn' });
    }

    // ---- 蔬菜 / 水果 / 奶制品（通用推荐量，不依赖资料） ----
    if (s.vegG < DAILY_VEG) {
      items.push({ icon: '🥬', text: '蔬菜约 ' + Math.round(s.vegG) + 'g，还差 ' +
        Math.max(0, DAILY_VEG - Math.round(s.vegG)) + 'g（每日建议 300g），加一份绿叶菜吧', tone: 'warn' });
    }
    if (s.fruitG < DAILY_FRUIT) {
      items.push({ icon: '🍎', text: '水果不足 ' + DAILY_FRUIT + 'g（每日建议量），一个苹果或一根香蕉就够上了', tone: 'info' });
    }
    if (s.dairyG < DAILY_DAIRY) {
      items.push({ icon: '🥛', text: '今天还没有奶制品，来一杯牛奶或无糖酸奶补补钙', tone: 'info' });
    }

    // ---- 脂肪 ----
    if (targets && s.fat > targets.fat * 1.2) {
      items.push({ icon: '🧈', text: '脂肪摄入偏高（' + s.fat + 'g / 目标 ' + targets.fat +
        'g），接下来少吃油炸和肥腻的部分', tone: 'warn' });
    }

    // ---- 时段提醒 ----
    if (isToday && hour >= 21 && targets) {
      var left = targets.kcal - s.kcal;
      if (left > targets.kcal * 0.3) {
        items.push({ icon: '🌃', text: '已经很晚了，虽然热量余量还有 ' + left +
          ' 千卡，但不建议睡前大量进食', tone: 'info' });
      }
    }

    // 全部达标时的正反馈
    if (!items.length) {
      items.push({ icon: '👍', text: '今日热量与营养搭配都不错，继续保持！', tone: 'good' });
    }

    return { items: items.slice(0, 5), good: items.length === 1 && items[0].tone === 'good' };
  }

  /* ==================== 对外 API ==================== */

  return {
    MEALS: MEALS,
    MEAL_NAMES: MEAL_NAMES,
    ACTIVITY_NAMES: ACTIVITY_NAMES,
    GOAL_NAMES: GOAL_NAMES,
    DAILY_VEG: DAILY_VEG,
    DAILY_FRUIT: DAILY_FRUIT,
    DAILY_DAIRY: DAILY_DAIRY,
    getFoods: getFoods,
    findFood: findFood,
    searchFoods: searchFoods,
    catOf: catOf,
    mealByHour: mealByHour,
    mealName: mealName,
    computeNutrition: computeNutrition,
    getTargets: getTargets,
    getDayEntries: getDayEntries,
    daySummary: daySummary,
    advise: advise
  };
})();
