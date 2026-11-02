// ==========================
// core.js
// ==========================
// 画面にも音にも触れない、純粋な関数を集める。公開版と実験用のページの両方が使う。node --test で検査する（test/core.test.js）。
// 読む順の生成、公開版の設定の正規化、読まれた札の履歴の組み立て、電子音の時刻表の計算、点滅の色、CSV の値の囲みを扱う。
// 実験用のページだけが使う処理（条件の袋、記録の組み立て、状態の復元）は lab-core.js にある。
// ==========================

import {
  DEFAULT_PUBLIC_SETTINGS, RULES, RULE_KEYS, T_LEVELS, AUDIO, FLASH, KIND_DEFS,
} from "./config.js";
import { translate } from "./i18n.js";

// --------------------------
// 乱数
// --------------------------

// 種（seed）から決まる乱数（mulberry32）。検査で同じ並びを再現するために使う。
// 本番では Math.random を使う。
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher–Yates のかき混ぜ。元の配列は変えず、新しい配列を返す。
// どの並びも同じ確率で出るので、「未読の値から一様に無作為に選ぶ」ことと同じ分布になる。
export function shuffle(items, rng = Math.random) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --------------------------
// 数の整え方
// --------------------------

export function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (value === null || value === "" || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// t を 1 ミリ秒の単位に丸める（0.1 + 0.2 のような浮動小数の端数を記録に残さない）。
export function roundT(t) {
  return Math.round(Number(t) * 1000) / 1000;
}

// t を画面に出す文字列にする。0.4 → "0.4"、1.25 → "1.25"。
export function formatT(t) {
  return String(roundT(t));
}

// t に添える速さの言葉。5水準でなければ空文字。言葉は i18n.js の辞書（speed.<t>）から、lang の言語で引く。
export function speedWord(t, lang = "ja") {
  const r = roundT(t);
  return T_LEVELS.includes(r) ? translate(lang, `speed.${r}`) : "";
}

// --------------------------
// 公開版の設定
// --------------------------

// 保存されていた設定を、使える形にそろえる。知らないルールや5水準でない t は既定に戻す。
export function normalizePublicSettings(raw = {}) {
  const s = { ...DEFAULT_PUBLIC_SETTINGS, ...(raw || {}) };
  const t = roundT(s.tSec);
  return {
    rule: RULE_KEYS.includes(s.rule) ? s.rule : DEFAULT_PUBLIC_SETTINGS.rule,
    tSec: T_LEVELS.includes(t) ? t : DEFAULT_PUBLIC_SETTINGS.tSec,
  };
}

// ルールの名前からルールの定義を引く。知らない名前なら、いつものルールを返す。
export function ruleOf(key) {
  return RULES[key] || RULES.standard;
}

// ルールの画面に出す名前と要約。文言は i18n.js の辞書（rule.<key>.name、rule.<key>.summary）にある。
export function ruleName(key, lang = "ja") {
  return translate(lang, `rule.${ruleOf(key).key}.name`);
}
export function ruleSummary(key, lang = "ja") {
  return translate(lang, `rule.${ruleOf(key).key}.summary`);
}

// --------------------------
// 札と読む順
// --------------------------

// 1ゲームで読む札の一覧を作る。値 1〜maxValue が、種類の数だけある。
// 空札のルールでも、アプリはどの値が空札かを知らないので、すべての値を読む。
export function buildDeck({ maxValue, kinds = 1 }) {
  const deck = [];
  for (let kind = 0; kind < kinds; kind++) {
    for (let value = 1; value <= maxValue; value++) deck.push({ value, kind });
  }
  return deck;
}

// 1ゲームの読む順を作る。同じ札（同じ値と種類の組）は2回読まない。
export function buildReadingOrder(rule, rng = Math.random) {
  return shuffle(buildDeck(rule), rng);
}

// 種類の呼び名。種類が1つなら空文字、2つなら「赤」「黒」（英語では Red、Black）。
export function kindLabel(kind, kinds, lang = "ja") {
  if (kinds <= 1) return "";
  const def = KIND_DEFS[kind];
  return def ? translate(lang, `kind.${def.key}`) : "";
}

// 札の呼び名。種類が1つなら値だけ（"7"）、2つなら種類を添える（日本語は "赤7"、英語は "Red 7"）。
export function cardLabel(value, kind, kinds, lang = "ja") {
  const kl = kindLabel(kind, kinds, lang);
  return kl ? translate(lang, "card.withKind", { kind: kl, value }) : String(value);
}

// 値をトランプの表記でも示す。1 → "A"、11 → "J"、12 → "Q"、13 → "K"、それ以外は空文字。
export function cardFace(value) {
  return { 1: "A", 11: "J", 12: "Q", 13: "K" }[value] || "";
}

// --------------------------
// 読まれた札の履歴（公開版の本体の画面に常に出す）
// --------------------------

// 履歴に載せてよい読みの数を返す。reads はこのゲームの読みの一覧、lastShown は直前の読みを見せてよいかどうか。
// 直前の読みは、次の「読む」を押すか「答えを確かめる」で答えを見るまで、履歴に載せない（答えが画面に出ると遊びにならない）。
export function shownReadCount(reads, lastShown) {
  const n = Array.isArray(reads) ? reads.length : 0;
  if (n === 0) return 0;
  return lastShown ? n : n - 1;
}

// 履歴の表示に使う印の一覧を作る。
// rule は RULES の定義、reads は読んだ順の [{ value, kind }]、lastShown は直前の読みを見せてよいかどうか。
// 返り値：
//   rows     … 種類ごとの札の並び。各要素は { kind, label, cells }。cells の各要素は
//              { value, kind, order, latest }。order は読まれた順（1から）で、まだ読まれていない札は 0。
//              latest は、履歴に載せた読みのうち最も新しい札かどうか。
//   sequence … 履歴に載せた読みを、読んだ順に並べたもの。各要素は { value, kind, order, label }。
//   pending  … まだ履歴に載せていない直前の読みがあるかどうか。
//   columns  … 1段に並べる札の数（値の数）。
// 同じ札（同じ値と種類の組）が reads に2回あっても、最初の1回だけを数える（読み直しで二重に数えない）。
// ルールの範囲の外の値や種類は無視する。
// lang は札の呼び名（label）の言語。省くと日本語。
export function buildHistoryView({ rule, reads = [], lastShown = false, lang = "ja" }) {
  const kinds = Math.max(1, rule.kinds || 1);
  const shownCount = shownReadCount(reads, lastShown);
  const orderOf = new Map();
  const sequence = [];
  for (let i = 0; i < shownCount; i++) {
    const r = reads[i] || {};
    const value = Number(r.value);
    const kind = Number(r.kind) || 0;
    if (!Number.isInteger(value) || value < 1 || value > rule.maxValue) continue;
    if (kind < 0 || kind >= kinds) continue;
    const key = `${kind}:${value}`;
    if (orderOf.has(key)) continue;
    const order = sequence.length + 1;
    orderOf.set(key, order);
    sequence.push({ value, kind, order, label: cardLabel(value, kind, kinds, lang) });
  }
  const latestKey = sequence.length ? `${sequence[sequence.length - 1].kind}:${sequence[sequence.length - 1].value}` : "";
  const rows = [];
  for (let kind = 0; kind < kinds; kind++) {
    const cells = [];
    for (let value = 1; value <= rule.maxValue; value++) {
      const key = `${kind}:${value}`;
      cells.push({ value, kind, order: orderOf.get(key) || 0, latest: key === latestKey });
    }
    rows.push({ kind, label: kindLabel(kind, kinds, lang), cells });
  }
  return { rows, sequence, pending: reads.length > shownCount, columns: rule.maxValue };
}

// --------------------------
// 電子音の時刻表
// --------------------------

// 通常の音の長さ（秒）。t の半分か上限の短いほう。
export function toneDurationSec(t) {
  return Math.min(t / 2, AUDIO.maxToneDurationSec);
}

// 通常の音の点滅の長さ（秒）。
export function toneFlashSec(t) {
  return Math.min(t / 2, FLASH.maxToneFlashSec);
}

// 1回の読みの電子音の時刻表を作る。時刻はすべて AudioContext の時刻（秒）。
// 準備音を startCtx に置き、その prepGapSec 秒後から t 秒ごとに count 回の音を置く。最後の1回は "last"。
// 返り値の各要素は { role: "prep" | "tone" | "last", index, at, durationSec }。
// index は準備音が 0、電子音が 1〜count（何回目の音か）。
export function buildToneTimeline({ startCtx, count, tSec, prepGapSec }) {
  if (!(count >= 1)) throw new Error("count は1以上");
  const events = [{ role: "prep", index: 0, at: startCtx, durationSec: AUDIO.prepDurationSec }];
  const first = startCtx + prepGapSec;
  for (let i = 1; i <= count; i++) {
    const last = i === count;
    events.push({
      role: last ? "last" : "tone",
      index: i,
      // 掛け算で求める（足し算を重ねると浮動小数の誤差がたまる）。
      at: first + (i - 1) * tSec,
      durationSec: last ? AUDIO.lastDurationSec : toneDurationSec(tSec),
    });
  }
  return events;
}

// 1回の読みが鳴り終わるまでの長さ（秒、準備音の鳴り始めから最後の音の鳴り終わりまで）。
export function readDurationSec({ count, tSec, prepGapSec }) {
  return prepGapSec + (count - 1) * tSec + AUDIO.lastDurationSec;
}

// AudioContext の時刻を performance.now と Date.now の時間軸に換算する。
// 同じ瞬間に読んだ (ctxNow, perfNow, epochNow) を基準にする。Kikiwake と収集Bのアプリと同じ換算である。
export function ctxToPerf(at, base) {
  return base.perfNow + (at - base.ctxNow) * 1000;
}
export function ctxToEpoch(at, base) {
  return base.epochNow + (at - base.ctxNow) * 1000;
}

// カメラ用の点滅の色と長さを、音の役割と種類から決める（実験用のページ）。
export function flashSpecFor(event, { kind = 0, kinds = 1, tSec }) {
  if (event.role === "prep") return { color: FLASH.prepColor, durationSec: FLASH.prepFlashSec };
  if (event.role === "tone") return { color: FLASH.toneColor, durationSec: toneFlashSec(tSec) };
  return {
    color: kinds > 1 ? KIND_DEFS[kind].color : FLASH.lastColor,
    durationSec: FLASH.lastFlashSec,
  };
}

// 公開版の控えめな点滅（「読む」の札をほのかに光らせる）の印と長さ。
// 色は CSS の側で決めるので、ここでは "prep"、"tone"、"last"、"last-red"、"last-black" の印を返す。
export function glowSpecFor(event, { kind = 0, kinds = 1, tSec }) {
  const spec = flashSpecFor(event, { kind, kinds, tSec });
  let token = event.role;
  if (event.role === "last" && kinds > 1) token = `last-${KIND_DEFS[kind].key}`;
  return { token, durationSec: spec.durationSec };
}

// 記録から、各読みの隣り合う電子音の間隔（ミリ秒）を求める。予約の確かめに使う。
export function toneIntervalsMs(read) {
  const tones = (read.events || []).filter((e) => e.role !== "prep");
  const out = [];
  for (let i = 1; i < tones.length; i++) out.push(tones[i].perf - tones[i - 1].perf);
  return out;
}

// --------------------------
// CSV
// --------------------------

export function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function round3(x) {
  return typeof x === "number" && Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x;
}
