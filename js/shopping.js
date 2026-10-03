/**
 * shopping.js —— 小账本 · 购物清单文本解析模块
 *
 * 暴露全局对象 Shopping（普通 <script> 引入，无模块系统，零依赖，不操作 DOM）。
 * 用途：把用户粘贴/手敲的购物清单文本（每行一件商品）解析成结构化商品列表。
 *
 * 对外 API：
 *   Shopping.parse(text) —— 解析结果对象：
 *     {
 *       ok:      Boolean,                   // 至少解析出一件有效商品才为 true
 *       items:   [{ name, qty, price }, ...] // qty 缺省 1；price 至多 2 位小数
 *       total:   Number,                    // Σ(qty * price)，四舍五入到 2 位小数
 *       skipped: Number                     // 未产出商品的行数（skipped 口径见下）
 *     }
 *   text 非法（非字符串）或没有任何有效商品时返回
 *   { ok:false, items:[], total:0, skipped:N }。
 *
 * 解析规则（逐行处理，最多解析 50 件有效商品，达到上限后停止读取后续行）：
 *   1. 每行一件商品；空行、以 # 开头的注释行跳过（计入 skipped）。
 *   2. 数量标记：x2 / *2 / ×2 / X2（标记前后留空或紧贴名称均可；标记字符与
 *      数字之间不能有空格，即 "x 2" 不算标记）表示数量，无标记时数量为 1。
 *   3. 行内最后一个数字视为【单价】。
 *      【重要约定】"牛奶 x2 12.8" 中标记后面的数字无法区分是总价（2 件共
 *      12.8 元）还是单价（每件 12.8 元），本模块统一按【单价 12.8】处理，
 *      返回的 total 由 qty * price 计算得出（本例 total = 25.6）。
 *   4. 名称 = 去掉数字与数量标记后的剩余文本：trim、压缩空格、剔除首尾残留
 *      标点、丢弃紧跟价格后的货币量词（元/块钱/块/圆）；名称 1~30 字，超长
 *      截断到 30 字（按 UTF-16 码元计数）。
 *   5. 全角数字／．／，／＊／ｘ／Ｘ／全角空格先归一化为半角再解析；价格支持
 *      千分位写法（如 1,238.00，逗号不会被当作分隔符吞掉数字）。
 *
 * skipped 口径（所有未产出商品的行都计数）：
 *   - 空行、注释行；
 *   - 行内没有任何数字（无价格；不生成 price=0 的商品）；
 *   - 价格 <= 0、小数超过 2 位、或格式怪异（如 1.2.3、价格前后紧贴 "." "-"）；
 *   - 数量标记为 0（如 x0）；
 *   - 去掉数字后名称为空（如整行只有一个价格）。
 *   例外：空文本 / 纯空白文本没有内容行，skipped 记 0；达到 50 件上限后剩余
 *   的行不再读取，也不计入 skipped。
 */
var Shopping = (function () {
  'use strict';

  /* ==================== 常量 ==================== */

  /** 最多解析的有效商品条数，达到后停止读取后续行 */
  var MAX_ITEMS = 50;

  /** 商品名称最大长度，超出截断 */
  var MAX_NAME_LEN = 30;

  /**
   * 数量标记：x / X / * / × 后面紧跟 1~9 位数字。
   * 第一对括号捕获标记的前一个字符，用于排除英文单词内部的 x2
   * （如 Max2、fox2 中的 x2 不算数量标记）。
   */
  var QTY_RE = /([A-Za-z0-9_]?)([xX*×])(\d{1,9})/g;

  /**
   * 价格（含千分位）匹配：优先尝试千分位形态（逗号后必须恰好 3 位数字），
   * 避免 1,238.00 被拆成 1 / 238 / 00；形如 1,23.45 的残缺写法会退化成
   * 普通数字容错处理。
   */
  var NUM_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

  /** 价格后面紧跟的货币量词（如 "5元""3块"），提取名称时一并丢弃 */
  var CURRENCY_SUFFIX_RE = /^(?:块钱|元|块|圆)/;

  /** 名称首尾需要剔除的残留标点（数字被删除后可能遗留下来的符号） */
  var EDGE_PUNCT = ',.。、;；:：!！?？￥¥$&*-—_+·~～#\'"';

  /* ==================== 工具函数 ==================== */

  /**
   * 全角 → 半角归一化：全角数字、句点、逗号、星号、字母 x/X、全角空格。
   * 其余字符（含汉字与乘号 ×）原样保留。
   */
  function normalizeFullWidth(s) {
    var out = '';
    var i;
    var code;
    for (i = 0; i < s.length; i++) {
      code = s.charCodeAt(i);
      if (code >= 0xFF10 && code <= 0xFF19) {
        out += String.fromCharCode(code - 0xFF10 + 48); // ０-９ → 0-9
      } else if (code === 0xFF0E) {
        out += '.';   // ．→ .
      } else if (code === 0xFF0C) {
        out += ',';   // ，→ ,（千分位分隔）
      } else if (code === 0xFF0A) {
        out += '*';   // ＊→ *
      } else if (code === 0xFF58) {
        out += 'x';   // ｘ→ x
      } else if (code === 0xFF38) {
        out += 'X';   // Ｘ→ X
      } else if (code === 0x3000) {
        out += ' ';   // 全角空格 → 半角空格
      } else {
        out += s.charAt(i);
      }
    }
    return out;
  }

  /** 判断是否为半角数字字符 */
  function isDigitChar(c) {
    return c >= '0' && c <= '9';
  }

  /** 剔除字符串首尾的残留标点 */
  function trimEdgePunct(s) {
    var start = 0;
    var end = s.length;
    while (start < end && EDGE_PUNCT.indexOf(s.charAt(start)) !== -1) {
      start++;
    }
    while (end > start && EDGE_PUNCT.indexOf(s.charAt(end - 1)) !== -1) {
      end--;
    }
    return s.slice(start, end);
  }

  /**
   * 提取数量标记：返回 { qty: 数量或 null, line: 删除标记后的行 }。
   * 多个标记时数量取第一个，其余标记同样删除，避免其数字被误当价格。
   * 标记前一个字符若是数字（如 "3*2"），保留该数字——它可能是价格。
   */
  function extractQty(line) {
    var re = QTY_RE;
    re.lastIndex = 0;
    var qty = null;
    var kept = '';
    var copied = 0;
    var m;
    while ((m = re.exec(line)) !== null) {
      // 标记前一个字符是英文字母（如 Max2 里的 x2）→ 不是数量标记
      if (m[1] !== '' && /[A-Za-z]/.test(m[1])) {
        continue;
      }
      if (qty === null) {
        qty = parseInt(m[3], 10);
      }
      kept += line.slice(copied, m.index + m[1].length);
      copied = m.index + m[0].length;
    }
    kept += line.slice(copied);
    return { qty: qty, line: kept };
  }

  /* ==================== 单行解析 ==================== */

  /**
   * 解析单行文本：成功返回 { name, qty, price }，该行应跳过时返回 null。
   * 调用方保证传入的是已 trim、非空、非注释的行。
   */
  function parseLine(line) {
    line = normalizeFullWidth(line).replace(/^\s+|\s+$/g, '');
    if (line === '' || line.charAt(0) === '#') {
      return null; // 双保险，正常情况由 parse() 先行过滤
    }

    /* 第 1 步：提取数量标记（标记里的数字不参与价格解析） */
    var mq = extractQty(line);
    line = mq.line;
    var qty = mq.qty === null ? 1 : mq.qty;
    if (qty < 1) {
      return null; // 数量标记为 0（如 x0）→ 无效行
    }

    /* 第 2 步：行内最后一个数字 = 单价。
       【约定】"牛奶 x2 12.8" 里标记后的数字无法区分总价/单价，
       统一按单价处理，total 由 qty * price 计算得出（本例 25.6）。 */
    var re = NUM_RE;
    re.lastIndex = 0;
    var m;
    var last = null;
    while ((m = re.exec(line)) !== null) {
      last = m;
    }
    if (!last) {
      return null; // 行内没有数字 → 无价格 → 跳过（price 0 的商品不生成）
    }

    /* 第 3 步：价格格式校验。
       数字前后若紧贴 "." / "-" / 数字，说明是残缺或怪异格式（如 1.2.3、
       5-5、想表达负数）→ 跳过；小数超过 2 位（如 5.555）同样视为怪异 → 跳过。 */
    var before = last.index > 0 ? line.charAt(last.index - 1) : '';
    var afterIdx = last.index + last[0].length;
    var after = afterIdx < line.length ? line.charAt(afterIdx) : '';
    if (before === '.' || before === '-' || isDigitChar(before)) {
      return null;
    }
    if (after === '.' || after === '-') {
      return null;
    }
    var decimals = last[0].match(/(\.\d+)$/);
    if (decimals && decimals[1].length - 1 > 2) {
      return null;
    }

    var price = parseFloat(last[0].replace(/,/g, ''), 10);
    if (isNaN(price) || price <= 0) {
      return null; // 价格 <= 0 → 跳过
    }

    /* 第 4 步：提取名称 = 删除价格、数量标记、剩余数字后的文本 */
    var head = line.slice(0, last.index);
    var tail = line.slice(afterIdx).replace(CURRENCY_SUFFIX_RE, '');
    var name = head + tail;
    name = name.replace(/\d+/g, ' ');     // 剩余数字（如 "3瓶" 里的 3）一并去掉
    name = name.replace(/\s+/g, ' ');     // 压缩空白
    name = name.replace(/ [,.] /g, ' ');  // 两侧带空格的孤立逗号/句点视为数字残留
    name = trimEdgePunct(name).replace(/^\s+|\s+$/g, '');
    if (name === '') {
      return null; // 没有名称（如整行只有一个价格）→ 跳过
    }
    if (name.length > MAX_NAME_LEN) {
      name = name.slice(0, MAX_NAME_LEN).replace(/\s+$/, ''); // 超长截断到 30 字
    }

    return { name: name, qty: qty, price: price };
  }

  /* ==================== 对外 API ==================== */

  /**
   * 解析购物清单文本（\n / \r\n / \r 均可作为行分隔）。
   * 输入非法或解析不出任何有效商品时 ok 为 false，不抛异常。
   */
  function parse(text) {
    var result = { ok: false, items: [], total: 0, skipped: 0 };

    // 输入必须是字符串；空文本 / 纯空白文本没有可处理的内容行
    if (typeof text !== 'string') {
      return result;
    }
    if (text.replace(/\s/g, '') === '') {
      return result;
    }

    var lines = text.split(/\r\n|\r|\n/);
    var i;
    var line;
    var item;
    for (i = 0; i < lines.length; i++) {
      if (result.items.length >= MAX_ITEMS) {
        break; // 已满 50 件：停止解析，后续行不计入 skipped
      }
      line = lines[i].replace(/^\s+|\s+$/g, '');
      if (line === '' || line.charAt(0) === '#') {
        result.skipped++; // 空行 / 注释行：跳过并计数
        continue;
      }
      item = parseLine(line);
      if (item) {
        result.items.push(item); // 有效商品
      } else {
        result.skipped++;        // 无价格 / 坏价格 / 无名称等 → 跳过并计数
      }
    }

    // 合计金额：Σ(qty * price)，四舍五入到 2 位小数，规避浮点误差
    var sum = 0;
    for (i = 0; i < result.items.length; i++) {
      sum += result.items[i].qty * result.items[i].price;
    }
    result.total = Math.round(sum * 100) / 100;
    result.ok = result.items.length > 0; // 至少一件有效商品才算成功

    return result;
  }

  return {
    parse: parse
  };
})();
