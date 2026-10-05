/**
 * build-vocab-db.js —— 背单词词库构建脚本（Node，本地运行一次）
 *
 * 输入：
 *   1. $TEMP/vocab-probe/package/data/words.json —— cet-words-cli 数据（MIT License）
 *      5760 词（CET4 3815 / CET6 1945），含英式音标、分词性中文释义、词频热度
 *   2. Tatoeba 例句语料（CC-BY 2.0 FR）：
 *      eng_sentences_detailed.tsv / cmn_sentences_detailed.tsv / eng-cmn_links.tsv
 *
 * 输出：../../js/vocab-db.js —— 全局变量 VOCAB_DB（不进 localStorage，file:// 可用）
 *   条目格式：[单词, 音标, 释义, 词频热度0-100, 例句英文, 例句中文]
 *
 * 运行：node tools/build-vocab-db.js（在 vocab-probe 的上级目录结构下）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PROBE = process.env.TEMP
  ? path.join(process.env.TEMP, 'vocab-probe')
  : '/tmp/vocab-probe';
const WORDS_SRC = path.join(PROBE, 'package', 'data', 'words.json');
const ENG_TSV = path.join(PROBE, 'eng_sentences_detailed.tsv');
const CMN_TSV = path.join(PROBE, 'cmn_sentences_detailed.tsv');
const LINKS_TSV = path.join(PROBE, 'eng-cmn_links.tsv');
const OUT = path.resolve(__dirname, '..', 'js', 'vocab-db.js');

const words = require(WORDS_SRC);
const decks = { cet4: [], cet6: [] };
words.forEach((it, idx) => {
  const zh = (it.definitions || [])
    .slice(0, 4)
    .map(d => (d.pos ? d.pos + ' ' : '') + (d.zh || '').trim())
    .filter(Boolean)
    .join('；');
  decks[it.level === 'cet6' ? 'cet6' : 'cet4'].push({
    idx,
    word: it.word,
    phon: it.phoneticUK || it.phoneticUS || '',
    zh: zh || it.word,
    frq: Math.round((it.frequency || 0) * 100)
  });
});

// ---- 词形索引：精确形 + 常见屈折（s/es/ed/d/ing） ----
const formMap = new Map();   // form -> [{deck, word}]
function addForm(form, ref) {
  let arr = formMap.get(form);
  if (!arr) { arr = []; formMap.set(form, arr); }
  arr.push(ref);
}
for (const deck of Object.keys(decks)) {
  for (const it of decks[deck]) {
    const w = it.word.toLowerCase();
    const refs = [it, deck];
    addForm(w, refs);
    if (w.length > 2 && !w.endsWith('s')) addForm(w + 's', refs);
    if (w.endsWith('y') && w.length > 2) addForm(w.slice(0, -1) + 'ies', refs);
    if (w.length > 2 && !/[sxz]$/.test(w) && !w.endsWith('ch') && !w.endsWith('sh')) {
      if (!w.endsWith('e')) addForm(w + 'ed', refs);
      addForm(w + 'd', refs);
      if (!w.endsWith('e') || w.endsWith('ee')) {
        addForm(w.endsWith('e') ? w.slice(0, -1) + 'ing' : w + 'ing', refs);
      }
    }
  }
}

// ---- Pass 1：英文句库 → 每个词选最短可用句（3–14 词） ----
const cand = new Map();      // word -> { id, text, n }
const engText = new Map();   // engId -> word（后续找链接用）
async function pass1() {
  const rl = readline.createInterface({ input: fs.createReadStream(ENG_TSV) });
  for await (const line of rl) {
    const cols = line.split('\t');            // id, lang, text, user, created, modified
    if (cols.length < 3) continue;
    const id = cols[0];
    const text = cols[2];
    const low = text.toLowerCase();
    if (low.length < 8 || low.length > 90 || /[^a-z' \-.,!?;:0-9"]/.test(low)) continue;
    const toks = low.split(/[^a-z']+/).filter(Boolean);
    if (toks.length < 3 || toks.length > 14) continue;
    const seenWords = new Set();
    for (const tok of toks) {
      const arr = formMap.get(tok);
      if (!arr) continue;
      for (const [it, deck] of arr) {
        if (seenWords.has(deck + it.word)) continue;
        seenWords.add(deck + it.word);
        const cur = cand.get(deck + it.word);
        if (!cur || toks.length < cur.n) {
          cand.set(deck + it.word, { id, text, n: toks.length });
          engText.set(id, deck + it.word);
        }
      }
    }
  }
}

// ---- Pass 2：英中链接 → 候选句的中文句 id ----
const wantCmn = new Map();   // cmnId -> wordKey
async function pass2() {
  const rl = readline.createInterface({ input: fs.createReadStream(LINKS_TSV) });
  for await (const line of rl) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const a = line.slice(0, tab);
    const b = line.slice(tab + 1).trim();
    const wkA = engText.get(a);
    if (wkA && !wantCmn.has(wkA)) wantCmn.set(b, wkA);
    const wkB = engText.get(b);
    if (wkB && !wantCmn.has(wkB)) wantCmn.set(a, wkB);
  }
}

// ---- Pass 3：中文句库 → 例句中文 ----
const cnText = new Map();    // wordKey -> cn
async function pass3() {
  const rl = readline.createInterface({ input: fs.createReadStream(CMN_TSV) });
  for await (const line of rl) {
    const cols = line.split('\t');            // id, lang, text, ...
    if (cols.length < 3) continue;
    const wk = wantCmn.get(cols[0]);
    if (!wk) continue;
    if (cnText.has(wk)) continue;
    const text = cols[2];
    if (text && /[\u4e00-\u9fff]/.test(text) && text.length <= 60) {
      cnText.set(wk, text);
    }
  }
}

(async () => {
  await pass1();
  console.log('候选句（词覆盖，词形屈折后）:', cand.size, '/', words.length);
  await pass2();
  console.log('有中文链接的词:', wantCmn.size);
  await pass3();
  console.log('有中文翻译的词:', cnText.size);

  let total = 0, withEx = 0;
  const lines = [];
  for (const deck of ['cet4', 'cet6']) {
    const arr = decks[deck].map(it => {
      total += 1;
      const c = cand.get(deck + it.word);
      const cn = cnText.get(deck + it.word);
      let exEn = '', exCn = '';
      if (c && cn) {
        withEx += 1;
        exEn = c.text;
        exCn = cn;
      }
      return [it.word, it.phon, it.zh, it.frq, exEn, exCn];
    });
    lines.push('  ' + deck + ': ' + JSON.stringify(arr));
  }
  const header =
    '/**\n' +
    ' * vocab-db.js —— 背单词词库（构建产物，勿手改；由 tools/build-vocab-db.js 生成）\n' +
    ' *\n' +
    ' * 数据来源与许可：\n' +
    ' *   词与释义：cet-words-cli 数据集（MIT License）\n' +
    ' *   例句：Tatoeba 开放语料（CC-BY 2.0 FR，https://tatoeba.org）——\n' +
    ' *         覆盖 ' + withEx + '/' + total + ' 词，未覆盖的词例句留空，卡片自动降级为只显示词义\n' +
    ' * 条目：[单词, 英式音标, 中文释义, 词频热度0-100, 例句英文, 例句中文]\n' +
    ' * 数组下标即学习进度的词 id（vocab.progress.{deck} 的键）。\n' +
    ' */\n' +
    'var VOCAB_DB = {\n' +
    lines.join(',\n') +
    '\n};\n';
  fs.writeFileSync(OUT, header, 'utf8');
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log('写出', OUT, kb + 'KB', '例句覆盖', withEx + '/' + total);
})();
