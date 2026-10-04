/**
 * lunar.js —— 农历换算（1900–2100，纯本地零依赖）
 *
 * 采用通行的压缩历表算法：LUNAR_INFO 每年一个整数，位段编码 12/13 个月的
 * 大小月与闰月位置；以 1900-01-31（农历 1900 年正月初一）为基准逐日推算。
 *
 * 对外 API：
 *   Lunar.lunarToSolar(y, m, d, isLeap) → 'YYYY-MM-DD'（超出的日钳到月末）
 *   Lunar.solarToLunar('YYYY-MM-DD')    → { y, m, d, leap, text }
 *   Lunar.lunarText(lunar)              → '农历六月初五'（lunar = {m,d}）
 *
 * 覆盖范围外（<1900 或 >2100）时返回最接近的可用结果，绝不抛异常。
 */
var Lunar = (function () {
  'use strict';

  // 1900–2100 每年信息：0x 位段 = [闰月月份(第17-20位)][闰月大小(16位)]...
  // 通行的公开历表数据（calendar.js 一系实现共用）
  var LUNAR_INFO = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970-1979
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
    0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
    0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050-2059
    0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
    0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
    0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
    0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, // 2090-2099
    0x0d520                                                                                   // 2100
  ];

  var MONTH_TEXT = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
  var DAY_TEXT = [
    '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
    '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
  ];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** 农历 y 年总天数 */
  function yearDays(y) {
    var i, sum = 348;
    var info = LUNAR_INFO[y - 1900];
    for (i = 0x8000; i > 0x8; i >>= 1) sum += (info & i) ? 1 : 0;
    return sum + leapDays(y);
  }

  /** 农历 y 年闰月是几月（0 = 无闰月） */
  function leapMonth(y) {
    return LUNAR_INFO[y - 1900] & 0xf;
  }

  /** 农历 y 年闰月的天数（无闰月为 0） */
  function leapDays(y) {
    if (leapMonth(y)) return (LUNAR_INFO[y - 1900] & 0x10000) ? 30 : 29;
    return 0;
  }

  /** 农历 y 年 m 月（正=1）的天数；m 传负数表示闰月（如 -6 = 闰六月） */
  function monthDays(y, m) {
    var info = LUNAR_INFO[y - 1900];
    return (info & (0x10000 >> (m < 0 ? -m : m))) ? 30 : 29;
  }

  function clamp(y, m, d, isLeap) {
    y = Math.min(2100, Math.max(1900, Math.round(y) || 1900));
    m = Math.min(12, Math.max(1, Math.round(m) || 1));
    d = Math.round(d) || 1;
    var max;
    if (isLeap && leapMonth(y) === m) {
      max = leapDays(y);             // 闰月天数在独立位（bit16）
    } else {
      isLeap = false;
      max = monthDays(y, m);
    }
    if (d > max) d = max;          // 如腊月无三十 → 落到廿九
    if (d < 1) d = 1;
    return { y: y, m: m, d: d, leap: isLeap };
  }

  /**
   * 农历 → 公历。isLeap = true 且该年无此闰月时，按平月计算。
   * @returns {string} 'YYYY-MM-DD'
   */
  function lunarToSolar(y, m, d, isLeap) {
    var c = clamp(y, m, d, isLeap);
    var offset = 0;
    var i;
    for (i = 1900; i < c.y; i++) offset += yearDays(i);
    var leap = leapMonth(c.y);
    // 逐月累加：路过闰月位置时补上闰月天数（闰月排在第 leap 月之后）
    for (i = 1; i < c.m; i++) {
      offset += monthDays(c.y, i);
      if (i === leap) offset += leapDays(c.y);
    }
    if (c.leap) offset += monthDays(c.y, c.m);   // 目标是闰月：先过完它的平月
    var base = new Date(1900, 0, 31);
    base.setDate(base.getDate() + offset + c.d - 1);
    return base.getFullYear() + '-' + pad2(base.getMonth() + 1) + '-' + pad2(base.getDate());
  }

  /**
   * 公历 → 农历
   * @param {string} dateStr 'YYYY-MM-DD'
   * @returns {{y:number, m:number, d:number, leap:boolean, text:string}}
   */
  function solarToLunar(dateStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
    if (!m) return null;
    var solar = new Date(+m[1], +m[2] - 1, +m[3]);
    var offset = Math.round((solar - new Date(1900, 0, 31)) / 86400000);
    if (offset < 0) offset = 0;
    var y = 1900, temp, days;
    for (; y < 2101 && offset > 0; y++) {
      days = yearDays(y);
      offset -= days;
    }
    if (offset < 0) {
      offset += days;
      y--;
    }
    var leap = leapMonth(y);
    var isLeap = false;
    var i;
    for (i = 1; i < 13 && offset > 0; i++) {
      if (leap > 0 && i === leap + 1 && !isLeap) {
        --i;
        isLeap = true;
        temp = leapDays(y);
      } else {
        temp = monthDays(y, i);
      }
      if (isLeap && i === leap + 1) isLeap = false;   // 闰月已用完（下轮回到平月）
      offset -= temp;
    }
    if (offset === 0 && leap > 0 && i === leap + 1) {
      // 恰好落在闰月的第一天
      if (isLeap) {
        isLeap = false;
      } else {
        isLeap = true;
        --i;
      }
    }
    if (offset < 0) { offset += temp; --i; }
    var mm = isLeap ? leap : i;
    var dd = offset + 1;
    var c = clamp(y, mm, dd, isLeap);
    return {
      y: c.y, m: c.m, d: c.d, leap: c.leap,
      text: (c.leap ? '闰' : '') + MONTH_TEXT[c.m - 1] + '月' + DAY_TEXT[c.d - 1]
    };
  }

  /** {m,d} → '农历六月初五' */
  function lunarText(lunar) {
    if (!lunar) return '';
    var c = clamp(2000, lunar.m, lunar.d, !!lunar.leap);
    return '农历' + (c.leap ? '闰' : '') + MONTH_TEXT[c.m - 1] + '月' + DAY_TEXT[c.d - 1];
  }

  return {
    lunarToSolar: lunarToSolar,
    solarToLunar: solarToLunar,
    lunarText: lunarText
  };
})();
