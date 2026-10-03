/**
 * diet-ui.js —— 小账本 · 饮食页界面逻辑
 *
 * 暴露全局对象 DietUI（普通 <script> 引入）。依赖：
 *   core.js（Store：diet 数据域）、diet.js（Diet：营养/目标/建议）、food-db.js（FOOD_DB）。
 *
 * 对外 API：
 *   DietUI.init()    绑定一次事件（app.js 在 boot 时调用，可重复调用）
 *   DietUI.render()  渲染整个饮食页（app.js 切换到饮食 tab 时调用）
 *   DietUI.reset()   切换账户后重置页面状态（app.js 在 startApp 时调用）
 *
 * 结构：今日概览（热量环 + 三大营养素）→ 记一餐（搜索/份量/餐次）→
 *       当日记录 → 健康建议 → 热量预算（个人资料）。
 * 约定：与 app.js 同风格（var + 函数声明 + innerHTML 模板 + 事件委托），
 *       不使用模块系统；所有用户输入经 esc() 转义后拼入 HTML。
 */
var DietUI = (function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /** 快速添加常驻推荐（搜索框下方的常用食物快捷入口） */
  var QUICK_IDS = ['s_mifan', 'e_jidan', 'd_niunai', 'm_jixiong', 'f_pingguo', 's_mantou'];

  /* ==================== 内部状态 ==================== */

  var date = null;            // 正在浏览的日期 'YYYY-MM-DD'
  var meal = 'lunch';         // 记一餐的默认餐次
  var query = '';             // 食物搜索词
  var selected = null;        // 选中的食物对象
  var unitName = '克';        // 选中的份量单位名
  var unitGrams = 1;          // 选中的单位对应克数（克=1）
  var pickCount = 1;          // 单位数量（输入框的受控值）
  var nlpResult = null;       // 智能记餐解析预览（DietNLP.parse 结果）
  var profileEditing = false; // 个人资料是否处于编辑态
  var searchTimer = null;
  var toastTimer = null;
  var inited = false;

  /* ==================== 工具 ==================== */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 1800);
  }

  /** 数字容错：非法返回 0 */
  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  /** 今天日期 'YYYY-MM-DD'（与 Store 同口径，本地时区） */
  function todayStr() {
    return Store.todayStr();
  }

  /** 日期偏移：'2026-10-03' 偏移 -1 → '2026-10-02'（本地时区，跨月/跨年自动进位） */
  function shiftDate(dateStr, delta) {
    var p = dateStr.split('-');
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10) + delta);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  /** 食物是否已收藏 */
  function isFavorite(foodId) {
    return Store.getDiet().favorites.indexOf(foodId) !== -1;
  }

  /* ==================== 渲染：今日概览 ==================== */

  /** 热量环 SVG（周长按 r=52 计算） */
  function ringHtml(consumed, budget) {
    var hasBudget = budget !== null;
    var pct = hasBudget && budget > 0 ? consumed / budget : 0;
    var C = 2 * Math.PI * 52;
    var offset = C * (1 - Math.min(Math.max(pct, 0), 1));
    var color = pct > 1.05 ? 'var(--danger)' : (pct >= 0.8 ? '#FF9800' : 'var(--primary)');
    var sub = hasBudget ? ' / ' + budget + ' 千卡' : ' 千卡 · 未设预算';
    return '<div class="diet-ring-wrap">' +
      '<svg viewBox="0 0 120 120" class="diet-ring">' +
      '<circle class="ring-bg" cx="60" cy="60" r="52"></circle>' +
      '<circle class="ring-fg" cx="60" cy="60" r="52" stroke="' + color + '"' +
      ' stroke-dasharray="' + C + '" stroke-dashoffset="' + offset + '"></circle>' +
      '</svg>' +
      '<div class="diet-ring-center"><b>' + consumed + '</b><span>' + sub + '</span></div>' +
      '</div>';
  }

  function macroRow(label, value, target, cls) {
    var pct = target > 0 ? Math.min(value / target * 100, 100) : 0;
    var valText = target > 0 ? value + ' / ' + target + 'g' : value + 'g';
    return '<div class="macro-row"><span class="macro-name">' + label + '</span>' +
      '<div class="macro-track"><div class="macro-bar ' + cls + '" style="width:' + pct + '%"></div></div>' +
      '<span class="macro-val">' + valText + '</span></div>';
  }

  function renderOverview() {
    var box = $('diet-overview');
    var s = Diet.daySummary(date);
    var targets = Diet.getTargets();
    var budget = targets ? targets.kcal : null;

    var html = '<div class="diet-overview-inner">' + ringHtml(s.kcal, budget);

    // 预算状态说明
    var status = '';
    if (budget !== null) {
      var left = budget - s.kcal;
      status = left >= 0
        ? '还剩 <b>' + left + '</b> 千卡 · 已用 ' + Math.round(s.kcal / budget * 100) + '%'
        : '<span class="over-text">已超出 ' + Math.abs(left) + ' 千卡</span>';
    } else {
      status = '在下方「热量预算」完善资料后，这里会显示个性化预算';
    }
    html += '<div class="diet-ring-side">' +
      '<div class="diet-status">' + status + '</div>' +
      '<div class="macro-list">' +
      macroRow('蛋白质', s.protein, targets ? targets.protein : 0, 'bar-protein') +
      macroRow('脂肪', s.fat, targets ? targets.fat : 0, 'bar-fat') +
      macroRow('碳水', s.carb, targets ? targets.carb : 0, 'bar-carb') +
      '</div></div></div>';

    box.innerHTML = html;
  }

  /* ==================== 渲染：记一餐（搜索/选中） ==================== */

  function renderSearch() {
    var kw = query.trim();
    var box = $('food-search-results');
    if (!kw) {
      // 无关键词：收藏的食物置顶，下面是常用食物快捷入口
      var favFoods = Store.getDiet().favorites.map(function (id) {
        return Diet.findFood(id);
      }).filter(Boolean);
      var favChips = '';
      for (var f = 0; f < favFoods.length; f++) {
        favChips += '<button type="button" class="food-chip" data-id="' + esc(favFoods[f].id) + '">' +
          Icons.svg('star', 'ic-xs ic-fill') + esc(favFoods[f].name) + '</button>';
      }
      var chips = '';
      for (var i = 0; i < QUICK_IDS.length; i++) {
        var food = Diet.findFood(QUICK_IDS[i]);
        if (food) chips += '<button type="button" class="food-chip" data-id="' + esc(food.id) + '">' +
          esc(food.name) + '</button>';
      }
      box.innerHTML =
        (favChips ? '<div class="food-quick-row">' + favChips + '</div>' : '') +
        (chips ? '<div class="food-quick-row">' + chips + '</div>' : '');
      return;
    }
    var list = Diet.searchFoods(kw, 8);
    if (!list.length) {
      box.innerHTML = '<div class="food-noresult">没有找到「' + esc(kw) + '」，可用下方自定义食物录入</div>';
      return;
    }
    var html = '';
    for (var j = 0; j < list.length; j++) {
      var it = list[j];
      var cat = Diet.catOf(it.cat);
      html += '<button type="button" class="food-result-item' +
        (selected && selected.id === it.id ? ' selected' : '') + '" data-id="' + esc(it.id) + '">' +
        '<span class="fri-name">' + esc(it.name) + '</span>' +
        '<span class="fri-meta">' + (cat ? cat.icon + cat.name + ' · ' : '') + it.k + ' 千卡/100g</span>' +
        '</button>';
    }
    box.innerHTML = html;
  }

  /** 选中食物后的份量/餐次面板 */
  function renderPick() {
    var box = $('food-pick-panel');
    if (!selected) {
      box.innerHTML = '';
      return;
    }
    var cat = Diet.catOf(selected.cat);

    // 餐次选择
    var meals = ['breakfast', 'lunch', 'dinner', 'snack'];
    var mealBtns = '';
    for (var i = 0; i < meals.length; i++) {
      mealBtns += '<button type="button" class="type-btn' + (meals[i] === meal ? ' active' : '') +
        '" data-meal="' + meals[i] + '">' + Diet.mealName(meals[i]) + '</button>';
    }

    // 份量单位：克 + 食物自带单位
    var unitBtns = '<button type="button" class="unit-chip' + (unitGrams === 1 ? ' selected' : '') +
      '" data-ug="1" data-un="克">克</button>';
    for (var u = 0; u < selected.units.length; u++) {
      var un = selected.units[u];
      unitBtns += '<button type="button" class="unit-chip' + (unitGrams === un[1] ? ' selected' : '') +
        '" data-ug="' + un[1] + '" data-un="' + esc(un[0]) + '">' + esc(un[0]) + ' ' + un[1] + 'g</button>';
    }

    box.innerHTML = '<div class="pick-panel">' +
      '<div class="pick-head"><span class="pick-name">' + esc(selected.name) + '</span>' +
      '<span class="pick-cat">' + (cat ? cat.icon + ' ' + esc(cat.name) : '') + '</span>' +
      '<button type="button" class="pick-fav' + (isFavorite(selected.id) ? ' on' : '') +
      '" data-act="toggle-fav">' + Icons.svg('star', isFavorite(selected.id) ? 'ic-xs ic-fill' : 'ic-xs') +
      (isFavorite(selected.id) ? '已收藏' : '收藏') + '</button>' +
      '<button type="button" class="pick-clear" data-act="clear-pick" aria-label="关闭">' + Icons.svg('close', 'ic-sm') + '</button></div>' +
      '<div class="pick-info">每 100g：' + selected.k + ' 千卡 · 蛋白 ' + selected.p +
      'g · 脂肪 ' + selected.f + 'g · 碳水 ' + selected.c + 'g</div>' +
      '<div class="type-toggle pick-meal-toggle">' + mealBtns + '</div>' +
      '<div class="pick-units">' + unitBtns + '</div>' +
      '<div class="pick-count-row">' +
      '<input id="pick-count" type="number" inputmode="decimal" min="0" step="0.1" value="' + pickCount + '">' +
      '<span class="pick-unit-label">' + esc(unitName) + '</span>' +
      '<span id="pick-preview" class="pick-preview"></span></div>' +
      '<button id="pick-add-btn" class="btn-primary" data-act="add-entry">添加到' + Diet.mealName(meal) + '</button>' +
      '</div>';
    updatePickPreview();
  }

  /** 当前单位下的默认数量：克 → 默认一份克数；其他单位 → 1 */
  function pickDefaultCount() {
    if (!selected) return 1;
    return unitGrams === 1 ? selected.g : 1;
  }

  /** 当前克数 = 数量 × 单位克数 */
  function pickGrams() {
    return Math.round(pickCount * unitGrams * 10) / 10;
  }

  function updatePickPreview() {
    var el = $('pick-preview');
    if (!el || !selected) return;
    var grams = pickGrams();
    var n = Diet.computeNutrition(selected, grams);
    el.textContent = '= ' + grams + 'g · ' + n.kcal + ' 千卡';
  }

  /** 选中食物（重置份量单位与数量） */
  function selectFood(food) {
    selected = food;
    query = '';
    $('food-search-input').value = '';
    if (food.units && food.units.length) {
      unitName = food.units[0][0];
      unitGrams = food.units[0][1];
    } else {
      unitName = '克';
      unitGrams = 1;
    }
    pickCount = pickDefaultCount();
    renderSearch();
    renderPick();
  }

  /** 把当前选中的食物按当前份量/餐次写入记录 */
  function addEntry() {
    if (!selected) return;
    var grams = pickGrams();
    if (!isFinite(grams) || grams <= 0) { toast('请输入正确的份量'); return; }
    var n = Diet.computeNutrition(selected, grams);
    try {
      Store.addDietEntry({
        date: date,
        meal: meal,
        foodId: selected.id,
        name: selected.name,
        cat: selected.cat,
        grams: grams,
        kcal: n.kcal,
        protein: n.protein,
        fat: n.fat,
        carb: n.carb
      });
    } catch (e) { toast(e.message); return; }
    selected = null;
    query = '';
    $('food-search-input').value = '';
    successFlash('已记录 ' + Math.round(n.kcal) + ' 千卡');
    renderSearch();
    renderPick();
    renderOverview();
    renderEntries();
    renderAdvice();
  }

  /* ==================== 渲染：当日记录 ==================== */

  function renderEntries() {
    var listEl = $('diet-entries-list');
    var entries = Diet.getDayEntries(date);

    var p = date.split('-');
    $('diet-entries-title').textContent =
      parseInt(p[0], 10) + '年' + parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日记录';

    // 工具按钮：前一天有记录时显示「复制前一天」；当天有记录时显示「存为组合」
    var prevHas = Diet.getDayEntries(shiftDate(date, -1)).length > 0;
    $('diet-entries-tools').classList.toggle('hidden', !entries.length && !prevHas);

    if (!entries.length) {
      listEl.innerHTML = '<div class="empty-tip empty-lg">' +
        '<span class="empty-art"><svg class="ic"><use href="#i-diet"></use></svg></span>' +
        '<p class="empty-title">这一天还没有饮食记录</p>' +
        '<p class="empty-sub">在上方「记一餐」里说一句或搜一个食物，就能记上</p></div>'
      return;
    }

    var html = '';
    var meals = Diet.MEALS;
    for (var m = 0; m < meals.length; m++) {
      var mealEntries = entries.filter(function (e) { return e.meal === meals[m]; });
      if (!mealEntries.length) continue;
      var kcalSum = 0;
      for (var k = 0; k < mealEntries.length; k++) kcalSum += num(mealEntries[k].kcal);
      html += '<div class="meal-group"><div class="meal-head"><span>' +
        Diet.mealName(meals[m]) + '</span><span class="meal-kcal">' + Math.round(kcalSum) + ' 千卡</span></div>';
      for (var j = 0; j < mealEntries.length; j++) {
        var e = mealEntries[j];
        html += '<div class="diet-entry-row"><span class="der-name">' + esc(e.name) + '</span>' +
          '<span class="der-meta">' + e.grams + 'g · ' + e.kcal + ' 千卡</span>' +
          '<button type="button" class="btn-icon der-del" title="删除" data-act="del-entry" data-id="' + esc(e.id) + '">' + Icons.svg('close', 'ic-sm') + '</button>' +
          '</div>';
      }
      html += '</div>';
    }
    listEl.innerHTML = html;
  }

  /* ==================== 渲染：健康建议 ==================== */

  function renderAdvice() {
    var box = $('diet-advice-list');
    var res = Diet.advise(date);
    var html = '';
    for (var i = 0; i < res.items.length; i++) {
      var it = res.items[i];
      html += '<div class="advice-item tone-' + it.tone + '"><span class="advice-icon">' +
        esc(it.icon) + '</span><span class="advice-text">' + esc(it.text) + '</span></div>';
    }
    box.innerHTML = html;
  }

  /* ==================== 渲染：个人资料 / 热量预算 ==================== */

  /** 展示态：预算摘要 + 修改入口（入口按钮由 init 时控制的头部按钮提供） */
  function renderProfileDisplay() {
    var profile = Store.getDiet().profile;
    var targets = Diet.getTargets();
    var actName = Diet.ACTIVITY_NAMES[profile.activity] || '久坐少动';
    var goalName = Diet.GOAL_NAMES[profile.goal] || '保持体重';
    var budgetText = targets ? targets.kcal + ' 千卡' : '—';

    return '<div class="profile-chips">' +
      '<div class="pchip"><span class="pchip-label">每日预算</span><b>' + budgetText + '</b></div>' +
      '<div class="pchip"><span class="pchip-label">基础代谢</span><b>' + targets.bmr + '</b></div>' +
      '<div class="pchip"><span class="pchip-label">蛋白目标</span><b>' + targets.protein + 'g</b></div>' +
      '</div>' +
      '<div class="profile-meta">' + (profile.sex === 'female' ? '女' : '男') + ' · ' +
      profile.age + '岁 · ' + profile.height + 'cm · ' + profile.weight + 'kg · ' +
      esc(actName) + ' · ' + esc(goalName) +
      (profile.calorieBudget ? ' · 手动设定热量' : ' · 自动计算') + '</div>';
  }

  /** 编辑态表单 */
  function renderProfileForm() {
    var profile = profileEditing ? Store.getDiet().profile : null;
    var sex = profile ? profile.sex : 'male';
    var goal = profile ? profile.goal : 'keep';
    var acts = [1, 2, 3, 4];
    var actOptions = '';
    for (var i = 0; i < acts.length; i++) {
      actOptions += '<option value="' + acts[i] + '"' +
        ((profile ? profile.activity : 1) === acts[i] ? ' selected' : '') + '>' +
        Diet.ACTIVITY_NAMES[acts[i]] + '</option>';
    }
    var goals = ['lose', 'keep', 'gain'];
    var goalBtns = '';
    for (var g = 0; g < goals.length; g++) {
      goalBtns += '<button type="button" class="type-btn' + (goals[g] === goal ? ' active' : '') +
        '" data-goal="' + goals[g] + '">' + Diet.GOAL_NAMES[goals[g]] + '</button>';
    }

    return '<div class="profile-form">' +
      '<div class="form-row"><label class="form-label">性别</label>' +
      '<div class="type-toggle" id="dp-sex-toggle">' +
      '<button type="button" class="type-btn' + (sex === 'male' ? ' active' : '') + '" data-sex="male">男</button>' +
      '<button type="button" class="type-btn' + (sex === 'female' ? ' active' : '') + '" data-sex="female">女</button>' +
      '</div></div>' +
      '<div class="dp-grid">' +
      '<div class="form-row"><label class="form-label">年龄</label><input id="dp-age" type="number" inputmode="numeric" min="1" max="120" value="' + (profile ? profile.age : '') + '" placeholder="岁"></div>' +
      '<div class="form-row"><label class="form-label">身高 cm</label><input id="dp-height" type="number" inputmode="decimal" min="80" max="250" value="' + (profile ? profile.height : '') + '" placeholder="cm"></div>' +
      '<div class="form-row"><label class="form-label">体重 kg</label><input id="dp-weight" type="number" inputmode="decimal" min="20" max="300" value="' + (profile ? profile.weight : '') + '" placeholder="kg"></div>' +
      '<div class="form-row"><label class="form-label">活动量</label><select id="dp-activity">' + actOptions + '</select></div>' +
      '</div>' +
      '<div class="form-row"><label class="form-label">目标</label>' +
      '<div class="type-toggle" id="dp-goal-toggle">' + goalBtns + '</div></div>' +
      '<div class="form-row"><label class="form-label">每日热量预算（可选）</label>' +
      '<input id="dp-budget" type="number" inputmode="decimal" min="500" max="10000" value="' + (profile && profile.calorieBudget ? profile.calorieBudget : '') + '" placeholder="留空则按资料自动计算"></div>' +
      '<div class="dp-actions">' +
      (profileEditing ? '<button type="button" id="dp-cancel-btn" class="btn-secondary btn-sm">取消</button>' : '') +
      '<button type="button" id="dp-save-btn" class="btn-primary btn-sm">保存并生成预算</button>' +
      '</div></div>';
  }

  function renderProfile() {
    var box = $('diet-profile-box');
    var has = !!Store.getDiet().profile;
    if (has && !profileEditing) {
      box.innerHTML = renderProfileDisplay();
      $('diet-profile-toggle-btn').classList.remove('hidden');
    } else {
      box.innerHTML = renderProfileForm();
      $('diet-profile-toggle-btn').classList.add('hidden');
    }
  }

  /** 读取表单并保存资料 */
  function saveProfile() {
    var sexBtn = document.querySelector('#dp-sex-toggle .type-btn.active');
    var goalBtn = document.querySelector('#dp-goal-toggle .type-btn.active');
    var age = num($('dp-age').value);
    var height = num($('dp-height').value);
    var weight = num($('dp-weight').value);
    if (age < 1 || age > 120) { toast('请输入正确的年龄'); return; }
    if (height < 80 || height > 250) { toast('请输入正确的身高'); return; }
    if (weight < 20 || weight > 300) { toast('请输入正确的体重'); return; }
    var budgetRaw = $('dp-budget').value.trim();
    try {
      Store.setDietProfile({
        sex: sexBtn ? sexBtn.getAttribute('data-sex') : 'male',
        age: age,
        height: height,
        weight: weight,
        activity: num($('dp-activity').value) || 1,
        goal: goalBtn ? goalBtn.getAttribute('data-goal') : 'keep',
        calorieBudget: budgetRaw === '' ? null : num(budgetRaw)
      });
    } catch (e) { toast(e.message); return; }
    profileEditing = false;
    toast('已保存，预算已生成 ✓');
    renderOverview();
    renderAdvice();
    renderProfile();
  }

  /* ==================== v2：智能记餐（自然语言解析） ==================== */

  /** 解析输入框里的句子，生成预览 */
  function parseNlp() {
    var text = $('diet-nlp-input').value;
    var res = DietNLP.parse(text);
    if (!res.ok) { toast('没认出食物，试试「一碗米饭一个鸡蛋」'); return; }
    nlpResult = res;
    renderNlpPreview();
  }

  function renderNlpPreview() {
    var box = $('diet-nlp-preview');
    if (!nlpResult) {
      box.innerHTML = '';
      return;
    }
    var matched = 0;
    var kcalSum = 0;
    var html = '<div class="nlp-preview"><div class="nlp-head"><span>识别为「' +
      Diet.mealName(nlpResult.meal) + '」</span>' +
      '<button type="button" class="nlp-close" data-act="nlp-close" title="关闭并清空">' + Icons.svg('close', 'ic-xs') + '关闭</button></div>';
    for (var i = 0; i < nlpResult.items.length; i++) {
      var it = nlpResult.items[i];
      if (it.matched) {
        matched += 1;
        kcalSum += it.kcal;
        html += '<div class="nlp-item"><span class="nlp-ok">✓</span>' +
          '<span class="nlp-name">' + esc(it.name) + '</span>' +
          '<span class="nlp-meta">' + it.count + it.unitName + ' · ' + it.grams + 'g</span>' +
          '<span class="nlp-kcal">' + it.kcal + ' 千卡</span></div>';
      } else {
        html += '<div class="nlp-item miss"><span class="nlp-ok">✗</span>' +
          '<span class="nlp-name">未识别「' + esc(it.name) + '」</span></div>';
      }
    }
    html += '<button type="button" id="nlp-add-btn" class="btn-primary btn-sm nlp-add-btn">全部添加到' +
      Diet.mealName(nlpResult.meal) + '（' + matched + ' 项 · ' + Math.round(kcalSum) + ' 千卡）</button></div>';
    box.innerHTML = html;
  }

  /** 关闭解析预览并清空输入框（重置） */
  function closeNlpPreview() {
    nlpResult = null;
    $('diet-nlp-input').value = '';
    $('diet-nlp-preview').innerHTML = '';
  }

  /** 把预览中全部已识别项写入当前浏览的日期 */
  function addAllNlp() {
    if (!nlpResult) return;
    var added = 0;
    try {
      for (var i = 0; i < nlpResult.items.length; i++) {
        var it = nlpResult.items[i];
        if (!it.matched) continue;
        Store.addDietEntry({
          date: date,
          meal: nlpResult.meal,
          foodId: it.foodId,
          name: it.name,
          cat: it.cat,
          grams: it.grams,
          kcal: it.kcal,
          protein: it.protein,
          fat: it.fat,
          carb: it.carb
        });
        added += 1;
      }
    } catch (e) { toast(e.message); return; }
    nlpResult = null;
    $('diet-nlp-input').value = '';
    $('diet-nlp-preview').innerHTML = '';
    successFlash('已记录 ' + added + ' 项');
    renderOverview();
    renderEntries();
    renderAdvice();
    renderTrend();
  }

  /* ==================== v2：常用组合 ==================== */

  function renderCombos() {
    var box = $('diet-combos');
    var combos = Store.getDiet().combos;
    if (!combos.length) {
      box.innerHTML = '';
      return;
    }
    var html = '<div class="combo-list"><div class="combo-title">我的组合</div>';
    for (var i = 0; i < combos.length; i++) {
      var c = combos[i];
      var kcalSum = 0;
      for (var j = 0; j < c.items.length; j++) kcalSum += num(c.items[j].kcal);
      html += '<div class="combo-row">' +
        '<span class="combo-name">' + esc(c.name) + '</span>' +
        '<span class="combo-meta">' + c.items.length + ' 项 · ' + Math.round(kcalSum) + ' 千卡</span>' +
        '<button type="button" class="btn-secondary btn-sm" data-act="apply-combo" data-id="' + esc(c.id) + '">一键添加</button>' +
        '<button type="button" class="btn-icon" title="删除" data-act="del-combo" data-id="' + esc(c.id) + '">' + Icons.svg('del', 'ic-sm') + '</button>' +
        '</div>';
    }
    box.innerHTML = html + '</div>';
  }

  /** 把组合内全部食物按各自快照写入当前浏览的日期 */
  function applyCombo(id) {
    var combos = Store.getDiet().combos;
    var combo = null;
    for (var i = 0; i < combos.length; i++) {
      if (combos[i].id === id) combo = combos[i];
    }
    if (!combo) return;
    var added = 0;
    try {
      for (var j = 0; j < combo.items.length; j++) {
        var it = combo.items[j];
        Store.addDietEntry({
          date: date,
          meal: it.meal,
          foodId: it.foodId,
          name: it.name,
          cat: it.cat,
          grams: it.grams,
          kcal: it.kcal,
          protein: it.protein,
          fat: it.fat,
          carb: it.carb
        });
        added += 1;
      }
    } catch (e) { toast(e.message); return; }
    successFlash('已添加「' + combo.name + '」' + added + ' 项');
    renderOverview();
    renderEntries();
    renderAdvice();
    renderTrend();
  }

  /* ==================== v2：复制前一天 / 存为组合 ==================== */

  /** 把前一天的全部记录复制到当前浏览的日期 */
  function copyPrevDay() {
    var prev = shiftDate(date, -1);
    var prevEntries = Diet.getDayEntries(prev);
    if (!prevEntries.length) {
      toast('前一天没有饮食记录');
      return;
    }
    if (Diet.getDayEntries(date).length && !confirm('这一天已有记录，再复制一份前一天的吗？')) {
      return;
    }
    var added = 0;
    try {
      for (var i = 0; i < prevEntries.length; i++) {
        var e = prevEntries[i];
        Store.addDietEntry({
          date: date,
          meal: e.meal,
          foodId: e.foodId,
          name: e.name,
          cat: e.cat,
          grams: e.grams,
          kcal: e.kcal,
          protein: e.protein,
          fat: e.fat,
          carb: e.carb,
          note: e.note
        });
        added += 1;
      }
    } catch (err) { toast(err.message); return; }
    successFlash('已复制 ' + added + ' 项');
    renderOverview();
    renderEntries();
    renderAdvice();
    renderTrend();
  }

  /** 把当前日期的全部记录存为一个常用组合（弹窗命名） */
  var pendingComboEntries = null; // 待保存的记录快照（弹窗打开期间持有）

  function openComboModal() {
    var entries = Diet.getDayEntries(date);
    if (!entries.length) {
      toast('这一天还没有记录，先记一餐吧');
      return;
    }
    pendingComboEntries = entries.map(function (e) {
      return {
        foodId: e.foodId, name: e.name, cat: e.cat,
        grams: e.grams, kcal: e.kcal,
        protein: e.protein, fat: e.fat, carb: e.carb,
        meal: e.meal
      };
    });
    $('combo-name-input').value = '组合 ' + (Store.getDiet().combos.length + 1);
    $('modal-combo').classList.remove('hidden');
    $('combo-name-input').focus();
  }

  function closeComboModal() {
    $('modal-combo').classList.add('hidden');
    pendingComboEntries = null;
  }

  function comboSaveConfirm() {
    if (!pendingComboEntries) { closeComboModal(); return; }
    var name = $('combo-name-input').value.trim();
    if (!name) { toast('请填写组合名称'); return; }
    try {
      Store.addCombo(name, pendingComboEntries);
    } catch (err) { toast(err.message); return; }
    closeComboModal();
    toast('组合已保存 ✓');
    renderCombos();
  }

  /* ==================== v2：近 7 天热量趋势 ==================== */

  function renderTrend() {
    var days = [];
    var hasData = false;
    for (var i = 6; i >= 0; i--) {
      var d = shiftDate(date, -i);
      var s = Diet.daySummary(d);
      if (s.count) hasData = true;
      days.push({
        label: d.slice(5),
        kcal: s.kcal,
        tip: parseInt(d.slice(5, 7), 10) + '月' + parseInt(d.slice(8), 10) + '日 · ' + s.kcal + ' 千卡'
      });
    }
    var targets = Diet.getTargets();
    $('diet-trend-empty').classList.toggle('hidden', hasData);
    Charts.renderCalorieTrend($('diet-trend-chart'), hasData ? days : [], targets ? targets.kcal : null);
  }

  /* ==================== 渲染总入口 ==================== */

  function render() {
    if (!date) date = todayStr();
    $('diet-date').value = date;
    // 图表随渲染重建：离开统计页时 stats 图表已被销毁，这里统一兜底
    Charts.destroyAll();
    renderOverview();
    renderSearch();
    renderPick();
    renderCombos();
    renderNlpPreview();
    renderEntries();
    renderAdvice();
    renderTrend();
    renderProfile();
  }

  /* ==================== 事件绑定 ==================== */

  function bindOnce() {
    // 日期切换（不允许看未来）：切换后清掉解析预览，避免误加到别的日期
    $('diet-date').addEventListener('change', function () {
      var v = this.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { this.value = date; return; }
      if (v > todayStr()) { toast('不能记录未来的日期'); this.value = date; return; }
      date = v;
      closeNlpPreview();
      renderOverview();
      renderEntries();
      renderAdvice();
      renderTrend();
    });

    // 智能记餐（自然语言解析）
    $('diet-nlp-btn').addEventListener('click', parseNlp);
    $('diet-nlp-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') parseNlp();
    });
    $('diet-nlp-preview').addEventListener('click', function (e) {
      if (e.target.closest('#nlp-add-btn')) addAllNlp();
      else if (e.target.closest('[data-act="nlp-close"]')) closeNlpPreview();
    });

    // 食物搜索（防抖）
    $('food-search-input').addEventListener('input', function () {
      var self = this;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        query = self.value;
        renderSearch();
      }, 150);
    });
    $('food-search-input').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var list = Diet.searchFoods(query, 1);
      if (list.length) selectFood(list[0]);
    });

    // 搜索结果 / 快捷食物 点击选中
    $('food-search-results').addEventListener('click', function (e) {
      var btn = e.target.closest('.food-result-item, .food-chip');
      if (!btn) return;
      var food = Diet.findFood(btn.getAttribute('data-id'));
      if (food) selectFood(food);
    });

    // 选中面板：餐次 / 单位 / 添加 / 清除 / 数量输入
    $('food-pick-panel').addEventListener('click', function (e) {
      var mealBtn = e.target.closest('.pick-meal-toggle .type-btn');
      if (mealBtn) {
        meal = mealBtn.getAttribute('data-meal');
        renderPick();
        return;
      }
      var unitBtn = e.target.closest('.unit-chip');
      if (unitBtn) {
        unitGrams = num(unitBtn.getAttribute('data-ug')) || 1;
        unitName = unitBtn.getAttribute('data-un') || '克';
        pickCount = pickDefaultCount(); // 切换单位后数量回到该单位的默认值
        renderPick();
        return;
      }
      var act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.getAttribute('data-act') === 'clear-pick') {
        selected = null;
        renderPick();
      } else if (act.getAttribute('data-act') === 'toggle-fav') {
        if (!selected) return;
        Store.toggleFavorite(selected.id);
        renderPick();
        renderSearch();
      } else if (act.getAttribute('data-act') === 'add-entry') {
        addEntry();
      }
    });
    $('food-pick-panel').addEventListener('input', function (e) {
      if (e.target.id === 'pick-count') {
        pickCount = e.target.value === '' ? 0 : num(e.target.value);
        updatePickPreview();
      }
    });

    // 当日记录删除
    $('diet-entries-list').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act="del-entry"]');
      if (!btn) return;
      Store.deleteDietEntry(btn.getAttribute('data-id'));
      toast('已删除');
      renderOverview();
      renderEntries();
      renderAdvice();
      renderTrend();
    });

    // 当日记录工具：复制前一天 / 存为组合
    $('diet-copy-prev-btn').addEventListener('click', copyPrevDay);
    $('diet-save-combo-btn').addEventListener('click', openComboModal);

    // 组合命名弹窗
    $('combo-save-btn').addEventListener('click', comboSaveConfirm);
    $('combo-cancel-btn').addEventListener('click', closeComboModal);
    $('combo-name-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') comboSaveConfirm();
    });

    // 常用组合：一键添加 / 删除
    $('diet-combos').addEventListener('click', function (e) {
      var applyBtn = e.target.closest('[data-act="apply-combo"]');
      if (applyBtn) {
        applyCombo(applyBtn.getAttribute('data-id'));
        return;
      }
      var delBtn = e.target.closest('[data-act="del-combo"]');
      if (delBtn) {
        if (!confirm('删除这个组合吗？')) return;
        Store.deleteCombo(delBtn.getAttribute('data-id'));
        toast('组合已删除');
        renderCombos();
      }
    });

    // 自定义食物
    $('custom-food-toggle-btn').addEventListener('click', function () {
      $('custom-food-form').classList.toggle('hidden');
    });
    $('cf-save-btn').addEventListener('click', function () {
      var name = $('cf-name').value.trim();
      var k = num($('cf-kcal').value);
      var p = num($('cf-protein').value);
      var f = num($('cf-fat').value);
      var c = num($('cf-carb').value);
      if (!name) { toast('请填写食物名称'); return; }
      if (k <= 0) { toast('请填写热量（kcal/100g）'); return; }
      var g = num($('cf-grams').value);
      var saved;
      try {
        saved = Store.addCustomFood({
          name: name, k: k, p: p, f: f, c: c,
          g: g > 0 ? g : 100,
          units: [['份', g > 0 ? Math.round(g) : 100]]
        });
      } catch (err) { toast(err.message); return; }
      // 清空表单并选中该食物
      $('cf-name').value = ''; $('cf-kcal').value = ''; $('cf-protein').value = '';
      $('cf-fat').value = ''; $('cf-carb').value = ''; $('cf-grams').value = '';
      $('custom-food-form').classList.add('hidden');
      selectFood({
        id: saved.id, name: saved.name, cat: 'custom',
        k: saved.k, p: saved.p, f: saved.f, c: saved.c,
        g: saved.g, units: saved.units, lean: false
      });
      toast('自定义食物已保存 ✓');
    });

    // 个人资料
    $('diet-profile-toggle-btn').addEventListener('click', function () {
      profileEditing = true;
      renderProfile();
    });
    $('diet-profile-box').addEventListener('click', function (e) {
      var sexBtn = e.target.closest('#dp-sex-toggle .type-btn');
      if (sexBtn) {
        var btns = document.querySelectorAll('#dp-sex-toggle .type-btn');
        for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
        sexBtn.classList.add('active');
        return;
      }
      var goalBtn = e.target.closest('#dp-goal-toggle .type-btn');
      if (goalBtn) {
        var gbtns = document.querySelectorAll('#dp-goal-toggle .type-btn');
        for (var j = 0; j < gbtns.length; j++) gbtns[j].classList.remove('active');
        goalBtn.classList.add('active');
        return;
      }
      if (e.target.closest('#dp-save-btn')) { saveProfile(); return; }
      if (e.target.closest('#dp-cancel-btn')) {
        profileEditing = false;
        renderProfile();
      }
    });
  }

  /* ==================== 对外 API ==================== */

  /** 绑定一次事件（幂等） */
  function init() {
    if (inited) return;
    inited = true;
    bindOnce();
  }

  /** 切换账户后重置页面状态 */
  function reset() {
    date = todayStr();
    meal = Diet.mealByHour();
    query = '';
    selected = null;
    profileEditing = false;
    nlpResult = null;
    $('diet-nlp-input').value = '';
  }

  return {
    init: init,
    render: render,
    reset: reset
  };
})();
