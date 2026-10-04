/**
 * icons.js —— 全站线性图标（内联 SVG sprite，零依赖、可离线）
 *
 * 图标取自 Lucide v0.460.0（https://lucide.dev），ISC License：
 *   Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
 *   All other copyright (c) for Lucide are held by Lucide Contributors 2022.
 *   Permission to use, copy, modify, and/or distribute this software for any purpose with or
 *   without fee is hereby granted, provided that the above copyright notice and this permission
 *   notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 *   EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 *   FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 *
 * 约定：统一 24 网格、圆头圆角；颜色与描边粗细由 CSS 的 .ic 控制（currentColor），
 *       符号内不写死 stroke / fill，因此自动跟随主题色板与明暗模式。
 *
 * 用法：
 *   静态 HTML：<svg class="ic"><use href="#i-record"></use></svg>
 *   JS 拼串：  Icons.svg('record')            → 22px 默认尺寸
 *              Icons.svg('del', 'ic-sm')      → 小号
 *   emoji 兜底：自定义分类仍可用 emoji，见 app.js 的 catIconHTML()
 *
 * 新增图标：从 https://unpkg.com/lucide-static@0.460.0/icons/<名字>.svg 取一份，
 *   把 <svg> 内的路径原样拷进下面同名的 <symbol>（viewBox 保持 0 0 24 24），
 *   再把语义名加进 names 列表 —— 颜色和描边粗细由 CSS 的 .ic 统一控制，
 *   符号内不要写死 stroke / fill / stroke-width。
 */
(function () {
  'use strict';

  var SPRITE = [
  '<symbol id="i-record" viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" /><path d="m15 5 3 3" /></symbol>',
  '<symbol id="i-stats" viewBox="0 0 24 24"><path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z" /><path d="M21.21 15.89A10 10 0 1 1 8 2.83" /></symbol>',
  '<symbol id="i-budget" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></symbol>',
  '<symbol id="i-diet" viewBox="0 0 24 24"><path d="M7 21h10" /><path d="M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z" /><path d="M11.38 12a2.4 2.4 0 0 1-.4-4.77 2.4 2.4 0 0 1 3.2-2.77 2.4 2.4 0 0 1 3.47-.63 2.4 2.4 0 0 1 3.37 3.37 2.4 2.4 0 0 1-1.1 3.7 2.51 2.51 0 0 1 .03 1.1" /><path d="m13 12 4-4" /><path d="M10.9 7.25A3.99 3.99 0 0 0 4 10c0 .73.2 1.41.54 2" /></symbol>',
  '<symbol id="i-manage" viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></symbol>',
  '<symbol id="i-food" viewBox="0 0 24 24"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" /><path d="M7 2v20" /><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" /></symbol>',
  '<symbol id="i-transport" viewBox="0 0 24 24"><path d="M8 6v6" /><path d="M15 6v6" /><path d="M2 12h19.6" /><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3" /><circle cx="7" cy="18" r="2" /><path d="M9 18h5" /><circle cx="16" cy="18" r="2" /></symbol>',
  '<symbol id="i-shopping" viewBox="0 0 24 24"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></symbol>',
  '<symbol id="i-fun" viewBox="0 0 24 24"><line x1="6" x2="10" y1="11" y2="11" /><line x1="8" x2="8" y1="9" y2="13" /><line x1="15" x2="15.01" y1="12" y2="12" /><line x1="18" x2="18.01" y1="10" y2="10" /><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" /></symbol>',
  '<symbol id="i-daily" viewBox="0 0 24 24"><path d="M3 3h.01" /><path d="M7 5h.01" /><path d="M11 7h.01" /><path d="M3 7h.01" /><path d="M7 9h.01" /><path d="M3 11h.01" /><rect width="4" height="4" x="15" y="5" /><path d="m19 9 2 2v10c0 .6-.4 1-1 1h-6c-.6 0-1-.4-1-1V11l2-2" /><path d="m13 14 8-2" /><path d="m13 19 8-2" /></symbol>',
  '<symbol id="i-home" viewBox="0 0 24 24"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></symbol>',
  '<symbol id="i-medical" viewBox="0 0 24 24"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" /><path d="m8.5 8.5 7 7" /></symbol>',
  '<symbol id="i-study" viewBox="0 0 24 24"><path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" /></symbol>',
  '<symbol id="i-social" viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13" /><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" /><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" /></symbol>',
  '<symbol id="i-other" viewBox="0 0 24 24"><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" /><path d="M12 22V12" /><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7" /><path d="m7.5 4.27 9 5.15" /></symbol>',
  '<symbol id="i-salary" viewBox="0 0 24 24"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" /><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" /></symbol>',
  '<symbol id="i-parttime" viewBox="0 0 24 24"><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /><rect width="20" height="14" x="2" y="6" rx="2" /></symbol>',
  '<symbol id="i-invest" viewBox="0 0 24 24"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></symbol>',
  '<symbol id="i-redpacket" viewBox="0 0 24 24"><path d="M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17" /><path d="m7 21 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9" /><path d="m2 16 6 6" /><circle cx="16" cy="9" r="2.9" /><circle cx="6" cy="5" r="3" /></symbol>',
  '<symbol id="i-refund" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></symbol>',
  '<symbol id="i-otherincome" viewBox="0 0 24 24"><circle cx="8" cy="8" r="6" /><path d="M18.09 10.37A6 6 0 1 1 10.34 18" /><path d="M7 6h1v4" /><path d="m16.71 13.88.7.71-2.82 2.82" /></symbol>',
  '<symbol id="i-fallback" viewBox="0 0 24 24"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" /></symbol>',
  '<symbol id="i-cart" viewBox="0 0 24 24"><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></symbol>',
  '<symbol id="i-copy" viewBox="0 0 24 24"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></symbol>',
  '<symbol id="i-save" viewBox="0 0 24 24"><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" /><path d="M7 3v4a1 1 0 0 0 1 1h7" /></symbol>',
  '<symbol id="i-key" viewBox="0 0 24 24"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" /><circle cx="16.5" cy="7.5" r=".5" fill="currentColor" /></symbol>',
  '<symbol id="i-logout" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" x2="9" y1="12" y2="12" /></symbol>',
  '<symbol id="i-csv" viewBox="0 0 24 24"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" /></symbol>',
  '<symbol id="i-export" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></symbol>',
  '<symbol id="i-import" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" /></symbol>',
  '<symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></symbol>',
  '<symbol id="i-plus" viewBox="0 0 24 24"><path d="M5 12h14" /><path d="M12 5v14" /></symbol>',
  '<symbol id="i-receipt" viewBox="0 0 24 24"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M14 8H8" /><path d="M16 12H8" /><path d="M13 16H8" /></symbol>',
  '<symbol id="i-edit" viewBox="0 0 24 24"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></symbol>',
  '<symbol id="i-del" viewBox="0 0 24 24"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></symbol>',
  '<symbol id="i-star" viewBox="0 0 24 24"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" /></symbol>',
  '<symbol id="i-warn" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></symbol>',
  '<symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></symbol>',
  '<symbol id="i-close" viewBox="0 0 24 24"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></symbol>',
  '<symbol id="i-calendar" viewBox="0 0 24 24"><path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></symbol>',
  '<symbol id="i-refresh" viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></symbol>',
  '<symbol id="i-chevron-left" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></symbol>',
  '<symbol id="i-chevron-right" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></symbol>',
  '<symbol id="i-up-right" viewBox="0 0 24 24"><path d="M7 7h10v10" /><path d="M7 17 17 7" /></symbol>',
  '<symbol id="i-down-right" viewBox="0 0 24 24"><path d="m7 7 10 10" /><path d="M17 7v10H7" /></symbol>',
  '<symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></symbol>',
  '<symbol id="i-chart-line" viewBox="0 0 24 24"><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="m19 9-5 5-4-4-3 3" /></symbol>',
  '<symbol id="i-notebook-pen" viewBox="0 0 24 24"><path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" /><path d="M2 6h4" /><path d="M2 10h4" /><path d="M2 14h4" /><path d="M2 18h4" /><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" /></symbol>',
  '<symbol id="i-check-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></symbol>',
  '<symbol id="i-life" viewBox="0 0 24 24"><path d="M7 20h10" /><path d="M10 20c5.5-2.5.8-6.4 3-10" /><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3.4-4 2.8-.5 4.4 0 5.9.6z" /><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z" /></symbol>',
  '<symbol id="i-calendar-heart" viewBox="0 0 24 24"><path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /><path d="M12 13.714c.571-.65 1.221-1.214 2-1.214 1.38 0 2.5 1.045 2.5 2.382 0 .933-.588 1.757-1.308 2.417-.713.654-1.51 1.13-2.04 1.408a.5.5 0 0 1-.446 0c-.53-.278-1.327-.754-2.04-1.408C9.588 16.586 9 15.762 9 14.882c0-1.337 1.12-2.382 2.5-2.382.779 0 1.429.564 2 1.214Z" /></symbol>',
  '<symbol id="i-graduation-cap" viewBox="0 0 24 24"><path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" /><path d="M22 10v6" /><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" /></symbol>',
  '<symbol id="i-pin" viewBox="0 0 24 24"><line x1="12" x2="12" y1="17" y2="22" /><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" /></symbol>',
  '<symbol id="i-repeat" viewBox="0 0 24 24"><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></symbol>',
  '<symbol id="i-flame" viewBox="0 0 24 24"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" /></symbol>',
  ].join('');

  /** 图标名清单（供自检 / 调试用） */
  var names = 'record stats budget diet manage life food transport shopping fun daily home medical study social other salary parttime invest redpacket refund otherincome fallback cart copy save key logout csv export import user plus receipt edit del star warn check close calendar calendar-heart graduation-cap pin repeat flame refresh chevron-left chevron-right up-right down-right search chart-line notebook-pen check-circle'.split(' ');

  function has(name) { return names.indexOf(name) !== -1; }

  /**
   * 生成一个图标标签
   * @param {string} name 语义名（如 'record' / 'del'）
   * @param {string} [cls] 追加类名（如 'ic-sm' / 'ic-cat'）
   * @returns {string} SVG 标签字符串；未知名字返回空串（不渲染破图）
   */
  function svg(name, cls) {
    if (!has(name)) return '';
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true" focusable="false">' +
           '<use href="#i-' + name + '"></use></svg>';
  }

  function mount() {
    var host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    host.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg">' + SPRITE + '</svg>';
    document.body.appendChild(host);
  }

  window.Icons = { svg: svg, has: has, names: names };

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
