/**
 * nlp.js —— 小账本 · 自然语言记账解析模块
 *
 * 暴露全局对象 NLP（普通 <script> 引入，无模块系统，不依赖任何库，不操作 DOM）。
 * 用途：把用户随手敲的一句自然语言（如「昨天打车23块」）解析成结构化记账数据。
 *
 * 对外 API：
 *   NLP.parse(text, categories) —— 解析结果对象：
 *     {
 *       ok: Boolean,               // 至少解析出金额才为 true
 *       amount: Number|null,       // 金额（正数，最多两位小数）
 *       date: 'YYYY-MM-DD'|null,   // null 表示未提到日期（调用方默认今天）
 *       categoryId: String|null,   // 匹配到的分类 id；未匹配为 null（调用方用当前选中分类）
 *       suggestedType: 'expense'|'income'|null, // 语义是否指向收入（工资/收到红包/退款等）
 *       note: String               // 清洗后的原文（去掉日期/金额噪音，压缩空格，最长 30 字）
 *     }
 *   text 非法（空/非字符串）时返回
 *   { ok:false, amount:null, date:null, categoryId:null, suggestedType:null, note:'' }。
 *
 * categories 参数：[{ id, name, icon, kind }]，来自记账应用的支出 + 收入分类，
 * kind 为 'expense' | 'income'；传入 null/非数组时按「没有任何分类」处理。
 *
 * 解析优先级：
 *   1. 日期最先解析（避免「10月3日」里的数字被当成金额），命中的日期词从原文剔除；
 *   2. 金额：货币符号/单位写法（¥23、23块5、23.5元）优先，
 *      兜底取剔除日期后的文本中最后一个独立数字（>0）；
 *   3. 分类：原文包含分类 name（含自定义分类）与命中内置同义词表统一比较——
 *      位置靠前优先，同位置更长优先，同长度名称匹配优先（详见 matchCategory）。
 *
 * 已知边界（有意不支持，保持实现简单可靠）：
 *   - 中文数字金额（「三十块」「廿五元」）不解析；
 *   - 「1万」「1.2k」等缩写金额不解析；
 *   - 「上周」不带星期几、「每个月」等模糊时间不解析为日期；
 *   - 兜底数字的整数部分超过 9 位时视为手机号/单号，不当金额；
 *   - 日期一律本地时区手动拼接 YYYY-MM-DD，不使用 toISOString。
 */
var NLP = (function () {
  'use strict';

  /* ==================== 内部常量 ==================== */

  /** 相对日期词 → 相对今天的偏移天数 */
  var RELATIVE_DAY_OFFSETS = {
    '大前天': -3,
    '前天': -2,
    '昨天': -1,
    '昨日': -1,
    '今天': 0,
    '今日': 0,
    '今晚': 0
  };

  /** 相对日期词正则（长词在前，避免「大前天」被「前天」抢先吃掉「大」字） */
  var RELATIVE_DAY_RE = /大前天|前天|昨天|昨日|今天|今日|今晚/;

  /** 中文星期几 → Date.getDay() 的数字（0 = 周日） */
  var WEEK_DOW = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };

  /**
   * 内置同义词表（按数组顺序为「组序」；words 统一以小写参与匹配）。
   * id 为默认预设分类 id；若调用方的 categories 里没有该 id（用户删过），
   * 会依次用「命中的同义词」「组中文名」做分类名称包含匹配找替代。
   */
  var SYNONYM_GROUPS = [
    { id: 'jiaotong', name: '交通', type: 'expense',
      words: ['打车', '出租', '滴滴', '地铁', '公交', '加油', '油费', '停车', '高速', '火车', '高铁', '机票', '飞机', '单车', '骑车'] },
    { id: 'canyin', name: '餐饮', type: 'expense',
      words: ['早饭', '早餐', '午饭', '午餐', '晚饭', '晚餐', '宵夜', '夜宵', '外卖', '奶茶', '咖啡', '零食', '饮料', '下馆子', '吃饭', '水果', '饭'] },
    { id: 'gouwu', name: '购物', type: 'expense',
      words: ['超市', '网购', '淘宝', '京东', '拼多多', '衣服', '裤子', '鞋', '化妆品', '买东西'] },
    { id: 'yule', name: '娱乐', type: 'expense',
      words: ['电影', '游戏', 'ktv', '唱歌', '旅游', '门票', '演出', '网吧'] },
    { id: 'riyong', name: '日用', type: 'expense',
      words: ['纸巾', '牙膏', '洗发水', '洗衣液', '快递', '话费', '日用'] },
    { id: 'juzhu', name: '居住', type: 'expense',
      words: ['房租', '水电', '燃气', '物业', '网费'] },
    { id: 'yiliao', name: '医疗', type: 'expense',
      words: ['药', '医院', '看病', '挂号', '体检', '口罩'] },
    { id: 'xuexi', name: '学习', type: 'expense',
      words: ['书', '课程', '学费', '考试', '培训', '网课'] },
    { id: 'renqing', name: '人情', type: 'expense',
      words: ['发红包', '随礼', '份子'] },
    { id: 'gongzi', name: '工资', type: 'income',
      words: ['发工资', '薪水', '工资'] },
    { id: 'jianzhi', name: '兼职', type: 'income',
      words: ['兼职', '外快'] },
    { id: 'licai', name: '理财', type: 'income',
      words: ['理财收益', '利息', '分红'] },
    { id: 'hongbao', name: '红包', type: 'income',
      words: ['收到红包', '收红包', '压岁钱'] },
    { id: 'tuikuan', name: '退款', type: 'income',
      words: ['退款', '报销'] }
  ];

  /** 兜底金额的整数部分最大位数（更长的数字基本是手机号/单号，不当金额） */
  var MAX_FALLBACK_INT_DIGITS = 9;

  /** note 最大长度（字） */
  var NOTE_MAX_LEN = 30;

  /* ==================== 内部工具 ==================== */

  /** 个位数字补零 */
  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  /**
   * Date → 'YYYY-MM-DD'（本地时区手动拼接，禁用 toISOString，
   * 避免 UTC 偏移导致日期错一天）
   */
  function fmtDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** 今天 0 点的 Date（每次新建，避免共享可变对象） */
  function todayStart() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  /** 今天 + offset 天的 'YYYY-MM-DD' */
  function dateOffsetDays(offset) {
    var d = todayStart();
    d.setDate(d.getDate() + offset);
    return fmtDate(d);
  }

  /**
   * 整数部分（+ 可选「块后零头」数字串）→ 两位以内小数的数值。
   * 非法/无穷时返回 0（调用方以 >0 判定有效）。
   */
  function toAmount(intPart, fracPart) {
    var v;
    if (fracPart != null) {
      // 「23块5」→ 23 + 5/10；「23块50」→ 23 + 50/100
      v = parseFloat(intPart) + parseInt(fracPart, 10) / Math.pow(10, fracPart.length);
    } else {
      v = parseFloat(intPart);
    }
    if (!isFinite(v)) return 0;
    return Math.round(v * 100) / 100;
  }

  /**
   * 归一化原文：全角数字→半角、常见标点→空格、全角句点→小数点、
   * 各类空白压缩为单个半角空格并去首尾。
   */
  function normalize(s) {
    s = s.replace(/[\uFF10-\uFF19]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 65248); // 0xFEE0
    });
    s = s.replace(/[，、。！？；：（）《》【】「」『』‘’“”…—·,;:!?"'()~～]/g, ' ');
    s = s.replace(/\uFF0E/g, '.'); // 全角句点当小数点
    s = s.replace(/[\u3000\u00A0\t\r\n]+/g, ' ');
    s = s.replace(/ {2,}/g, ' ');
    return s.trim();
  }

  /** 从字符串中挖掉 [start, start+len) 一段，用单个空格占位（保词间距） */
  function cutOut(s, start, len) {
    return s.slice(0, start) + ' ' + s.slice(start + len);
  }

  /** 收尾 note：压缩空白、去首尾、截断到 30 字 */
  function tidyNote(s) {
    var t = s.replace(/\s+/g, ' ').trim();
    if (t.length > NOTE_MAX_LEN) t = t.slice(0, NOTE_MAX_LEN);
    return t;
  }

  /* ==================== 日期解析 ==================== */

  /** 「10月3日」→ 今年的该日期；若在今天之后则取去年 */
  function monthDayDate(month, day) {
    var now = new Date();
    var d = new Date(now.getFullYear(), month - 1, day);
    if (d > todayStart()) {
      d = new Date(now.getFullYear() - 1, month - 1, day);
    }
    return fmtDate(d);
  }

  /**
   * 星期几 → 日期：取最近一个「过去的」该星期几（今天算今天）；
   * lastWeek 为 true（上周X / 上礼拜X）时再往前推 7 天。
   */
  function weekdayDate(dow, lastWeek) {
    var d = todayStart();
    var diff = (d.getDay() - dow + 7) % 7;
    if (lastWeek) diff += 7;
    d.setDate(d.getDate() - diff);
    return fmtDate(d);
  }

  /** 「3号 / 3日」→ 本月的该日；若在未来则取上个月（日超出上月天数时收敛到月末） */
  function bareDayDate(day) {
    var now = new Date();
    var d = new Date(now.getFullYear(), now.getMonth(), day);
    if (d > todayStart()) {
      var py = now.getFullYear();
      var pm = now.getMonth() - 1;
      if (pm < 0) { pm = 11; py -= 1; }
      var daysInPrev = new Date(py, pm + 1, 0).getDate();
      d = new Date(py, pm, day > daysInPrev ? daysInPrev : day);
    }
    return fmtDate(d);
  }

  /**
   * 从原文解析日期，命中返回
   *   { value: 'YYYY-MM-DD', start: Number, len: Number }
   * start/len 用于把日期词从原文里剔除；未命中返回 null。
   * 优先级：相对词 > X月X日 > 上周X > 周X > X号/X日
   * （月日必须先于裸日号，否则「10月3日」会被拆成「3日」）。
   */
  function extractDate(s) {
    var m;

    // 1) 今天/昨天/前天/大前天 等相对词
    m = s.match(RELATIVE_DAY_RE);
    if (m) {
      return { value: dateOffsetDays(RELATIVE_DAY_OFFSETS[m[0]]), start: m.index, len: m[0].length };
    }

    // 2) 「10月3日 / 10月3号」→ 今年（若结果在未来则年份减 1）
    m = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
    if (m) {
      var mo = parseInt(m[1], 10);
      var dy = parseInt(m[2], 10);
      if (mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) {
        return { value: monthDayDate(mo, dy), start: m.index, len: m[0].length };
      }
    }

    // 3) 「上周三 / 上礼拜天 / 上个星期三」→ 最近过去的该星期几再往前 7 天
    //    （前缀必须出现，基词「星期/礼拜/周」可省，如「上周三」= 上周 + 三）
    m = s.match(/(上礼拜|上个星期|上周)\s*(?:星期|礼拜|周)?\s*([一二三四五六日天])/);
    if (m) {
      return { value: weekdayDate(WEEK_DOW[m[2]], true), start: m.index, len: m[0].length };
    }

    // 4) 「周三 / 星期三 / 礼拜三」→ 最近一个过去的该星期几（今天算今天）
    m = s.match(/(?:星期|礼拜|周)\s*([一二三四五六日天])/);
    if (m) {
      return { value: weekdayDate(WEEK_DOW[m[1]], false), start: m.index, len: m[0].length };
    }

    // 5) 「3号 / 3日」→ 本月（若结果在未来则上个月）
    m = s.match(/(\d{1,2})\s*[日号]/);
    if (m) {
      var d2 = parseInt(m[1], 10);
      if (d2 >= 1 && d2 <= 31) {
        return { value: bareDayDate(d2), start: m.index, len: m[0].length };
      }
    }

    return null;
  }

  /* ==================== 金额解析 ==================== */

  /**
   * 从（已剔除日期词的）文本解析金额，命中返回
   *   { value: Number, start: Number, len: Number }
   * 优先级：¥23 / 23块5 / 23元 → 兜底取最后一个独立数字；未命中返回 null。
   * 同类写法有多个时取最先出现且有效的那个；解析出 0 视为无效继续找。
   */
  function extractAmount(s) {
    var m;
    var v;

    // 1) 货币符号前缀：¥23 / ￥ 23.5
    var symRe = /[¥￥]\s*(\d+(?:\.\d{1,2})?)/g;
    while ((m = symRe.exec(s))) {
      v = toAmount(m[1], null);
      if (v > 0) return { value: v, start: m.index, len: m[0].length };
    }

    // 2) 「块」系写法：23块 / 23块钱 / 23块5 / 23块5毛 / 23.5块
    var kuaiRe = /(\d+(?:\.\d{1,2})?)\s*块(?:\s*(\d{1,2})\s*[毛角钱]*|\s*[毛角钱]+)?/g;
    while ((m = kuaiRe.exec(s))) {
      v = toAmount(m[1], m[2]);
      if (v > 0) return { value: v, start: m.index, len: m[0].length };
    }

    // 3) 「元/圆」系写法：45.6 元 / 30圆 / 12块钱
    var yuanRe = /(\d+(?:\.\d{1,2})?)\s*(?:块钱|块|元|圆)/g;
    while ((m = yuanRe.exec(s))) {
      v = toAmount(m[1], null);
      if (v > 0) return { value: v, start: m.index, len: m[0].length };
    }

    // 4) 兜底：取最后一个独立数字（>0、形如 \d+(\.\d{1,2})?；
    //    整数部分超长的当手机号/单号跳过）
    var numRe = /\d+(?:\.\d{1,2})?(?![\d.])/g;
    var last = null;
    while ((m = numRe.exec(s))) {
      var intPart = m[0].split('.')[0];
      if (intPart.length > MAX_FALLBACK_INT_DIGITS) continue;
      v = toAmount(m[0], null);
      if (v > 0) last = { value: v, start: m.index, len: m[0].length };
    }
    return last;
  }

  /* ==================== 分类解析 ==================== */

  /** 分类 kind → 记账类型（非 'income' 一律按支出） */
  function kindToType(kind) {
    return kind === 'income' ? 'income' : 'expense';
  }

  /** categories 里是否存在某 id */
  function hasCatId(cats, id) {
    for (var i = 0; i < cats.length; i++) {
      if (cats[i] && cats[i].id === id) return true;
    }
    return false;
  }

  /**
   * 分类匹配。候选来自两处，统一比较后择优：
   *   1) 原文直接包含某个分类的 name（含自定义分类，如「宠物」）；
   *   2) 命中内置同义词表。
   * 比较规则：位置靠前优先（「超市…零食」→ 超市/购物）；
   * 同一位置更长优先（「收到红包」整体而非其中的「红包」）；
   * 同位置同长度时名称匹配优先于同义词；再相同按同义词表组序。
   * 返回 { id, type }：预设 id 不在 categories 时按「名称包含」回退
   * （先试命中的词，再试组中文名，如 tuikuan → 名称含「退款」的分类），
   * 回退失败 id 为 null 但 type 保留（调用方用当前选中分类）。
   */
  function matchCategory(lower, cats) {
    var best = null;
    var i;
    var j;
    var c;
    var idx;

    /** 择优：位置 → 长度 → 名称优先 → 组序 */
    function consider(cand) {
      if (!best) { best = cand; return; }
      if (cand.pos !== best.pos) {
        if (cand.pos < best.pos) best = cand;
      } else if (cand.len !== best.len) {
        if (cand.len > best.len) best = cand;
      } else if (cand.prio !== best.prio) {
        if (cand.prio < best.prio) best = cand;
      } else if (cand.order < best.order) {
        best = cand;
      }
    }

    // 1) 分类名称直匹配（含自定义分类）
    for (i = 0; i < cats.length; i++) {
      c = cats[i];
      if (!c || typeof c.id !== 'string' || !c.id) continue;
      if (typeof c.name !== 'string' || !c.name) continue;
      var nm = c.name.toLowerCase();
      idx = lower.indexOf(nm);
      if (idx >= 0) {
        consider({ pos: idx, len: nm.length, id: c.id, type: kindToType(c.kind),
                   word: c.name, group: -1, prio: 0, order: i });
      }
    }

    // 2) 内置同义词表
    for (i = 0; i < SYNONYM_GROUPS.length; i++) {
      var g = SYNONYM_GROUPS[i];
      for (var k = 0; k < g.words.length; k++) {
        var w = g.words[k];
        idx = lower.indexOf(w);
        if (idx >= 0) {
          consider({ pos: idx, len: w.length, id: g.id, type: g.type,
                     word: w, group: i, prio: 1, order: i });
        }
      }
    }

    if (!best) return { id: null, type: null };

    // 3) 预设 id 直接可用
    if (hasCatId(cats, best.id)) return { id: best.id, type: best.type };

    // 4) 回退：按「分类名称包含匹配」找替代
    var kwList = [best.word];
    if (best.group >= 0) kwList.push(SYNONYM_GROUPS[best.group].name);
    for (i = 0; i < kwList.length; i++) {
      var kw = kwList[i].toLowerCase();
      for (j = 0; j < cats.length; j++) {
        c = cats[j];
        if (!c || typeof c.id !== 'string' || !c.id) continue;
        if (typeof c.name === 'string' && c.name && c.name.toLowerCase().indexOf(kw) >= 0) {
          return { id: c.id, type: best.type };
        }
      }
    }
    return { id: null, type: best.type };
  }

  /* ==================== 对外 API ==================== */

  /** 输入非法时的空结果 */
  function emptyResult() {
    return { ok: false, amount: null, date: null, categoryId: null, suggestedType: null, note: '' };
  }

  /**
   * 解析一条自然语言记账文本。
   * @param {string} text 用户输入，如「昨天打车23块」
   * @param {Array} [categories] 分类列表 [{id,name,icon,kind}]
   * @returns {Object} { ok, amount, date, categoryId, suggestedType, note }
   */
  function parse(text, categories) {
    if (typeof text !== 'string') return emptyResult();
    var norm = normalize(text);
    if (!norm) return emptyResult();

    var cats = Array.isArray(categories) ? categories : [];

    // 先剔日期（避免「10月3日」的数字被当金额），再解析金额
    var dateInfo = extractDate(norm);
    var work = dateInfo ? cutOut(norm, dateInfo.start, dateInfo.len) : norm;
    var amountInfo = extractAmount(work);
    if (amountInfo) work = cutOut(work, amountInfo.start, amountInfo.len);

    // 分类在完整原文（小写副本）上匹配，位置仅用于比较先后
    var cat = matchCategory(norm.toLowerCase(), cats);

    return {
      ok: !!amountInfo,
      amount: amountInfo ? amountInfo.value : null,
      date: dateInfo ? dateInfo.value : null,
      categoryId: cat ? cat.id : null,
      suggestedType: cat ? cat.type : null,
      note: tidyNote(work)
    };
  }

  return { parse: parse };
})();
