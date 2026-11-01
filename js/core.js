// ==========================
// core.js
// ==========================
// 画面にも音にも触れない、純粋な関数を集める。node --test で検査する（test/core.test.js）。
// 読む順の生成、設定の正規化、電子音の時刻表の計算、t の無作為の割り当て、記録の CSV の生成を扱う。
// ==========================

import {
  DEFAULT_SETTINGS, T_LEVELS, T_MIN, T_MAX, MAX_VALUE_MIN, MAX_VALUE_MAX, KINDS_MAX,
  AUDIO, FLASH, KIND_DEFS, APP_VERSION,
} from "./config.js";

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
// 設定
// --------------------------

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// 保存されていた設定や入力欄の値を、使える形にそろえる。範囲の外の値は端に寄せ、読めない値は既定に戻す。
export function normalizeSettings(raw = {}) {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  return {
    maxValue: Math.round(clampNumber(s.maxValue, MAX_VALUE_MIN, MAX_VALUE_MAX, DEFAULT_SETTINGS.maxValue)),
    kinds: Math.round(clampNumber(s.kinds, 1, KINDS_MAX, DEFAULT_SETTINGS.kinds)),
    blankRule: Boolean(s.blankRule),
    tMode: s.tMode === "random" ? "random" : "fixed",
    tSec: roundT(clampNumber(s.tSec, T_MIN, T_MAX, DEFAULT_SETTINGS.tSec)),
    prepGapSec: Math.round(clampNumber(s.prepGapSec, 0.3, 3.0, DEFAULT_SETTINGS.prepGapSec) * 100) / 100,
    volume: clampNumber(s.volume, 0, 1, DEFAULT_SETTINGS.volume),
    flash: Boolean(s.flash),
    flashKindColor: s.flashKindColor === undefined ? true : Boolean(s.flashKindColor),
    flashOffsetMs: Math.round(clampNumber(s.flashOffsetMs, -300, 500, 0)),
    bigInfo: Boolean(s.bigInfo),
    label: String(s.label ?? "").slice(0, 60),
  };
}

// t を 1 ミリ秒の単位に丸める（0.1 + 0.2 のような浮動小数の端数を記録に残さない）。
export function roundT(t) {
  return Math.round(Number(t) * 1000) / 1000;
}

// t を画面に出す文字列にする。0.4 → "0.4"、1.25 → "1.25"。
export function formatT(t) {
  return String(roundT(t));
}

// --------------------------
// 札と読む順
// --------------------------

// 設定から、1ゲームで読む札の一覧を作る。値 1〜maxValue が、種類の数だけある。
// 空札のルールでも、アプリはどの値が空札かを知らないので、すべての値を読む。
export function buildDeck({ maxValue, kinds }) {
  const deck = [];
  for (let kind = 0; kind < kinds; kind++) {
    for (let value = 1; value <= maxValue; value++) deck.push({ value, kind });
  }
  return deck;
}

// 1ゲームの読む順を作る。同じ札（同じ値と種類の組）は2回読まない。
export function buildReadingOrder(settings, rng = Math.random) {
  return shuffle(buildDeck(settings), rng);
}

// 種類の呼び名。種類が1つなら空文字、2つなら「赤」「黒」、3つ以上ならトランプの印と名前。
export function kindLabel(kind, kinds) {
  if (kinds <= 1) return "";
  const def = KIND_DEFS[kind];
  if (!def) return "";
  if (kinds === 2) return def.name;
  return `${def.suit}${def.suitName}`;
}

// 値をトランプの表記でも示す。1 → "A"、11 → "J"、12 → "Q"、13 → "K"、それ以外は空文字。
export function cardFace(value) {
  return { 1: "A", 11: "J", 12: "Q", 13: "K" }[value] || "";
}

// --------------------------
// t の割り当て
// --------------------------

// 「ゲームごとに5水準から無作為に選ぶ」ときの t を、袋から1つ取り出す。
// 袋が空なら5水準をかき混ぜて詰め直す。5ゲームごとに5水準が1回ずつ出るので、水準の回数が偏らない。
// 袋の中身は localStorage に保存し、アプリを開き直しても続きから取り出す。
// 返り値は { t, bag }（bag は取り出したあとの残り）。
export function drawTFromBag(bag, rng = Math.random, levels = T_LEVELS) {
  let rest = Array.isArray(bag) ? bag.filter((x) => levels.includes(x)) : [];
  if (rest.length === 0) rest = shuffle(levels, rng);
  const [t, ...remaining] = rest;
  return { t, bag: remaining };
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

// 点滅の色と長さを、音の役割と種類から決める。
export function flashSpecFor(event, { kind, kinds, tSec, flashKindColor }) {
  if (event.role === "prep") return { color: FLASH.prepColor, durationSec: FLASH.prepFlashSec };
  if (event.role === "tone") return { color: FLASH.toneColor, durationSec: toneFlashSec(tSec) };
  const useKind = kinds > 1 && flashKindColor;
  return {
    color: useKind ? KIND_DEFS[kind].color : FLASH.lastColor,
    durationSec: FLASH.lastFlashSec,
  };
}

// --------------------------
// ゲームの記録
// --------------------------

// 新しいゲームの記録を作る。order（読む順）は答えなので、画面には出さない。
export function createGame({ gameNo, settings, tSec, order, now = Date.now(), id }) {
  return {
    id: id || `g${now.toString(36)}`,
    gameNo,
    appVersion: APP_VERSION,
    label: settings.label || "",
    startedAtEpochMs: now,
    startedAtIso: new Date(now).toISOString(),
    settings: {
      maxValue: settings.maxValue,
      kinds: settings.kinds,
      blankRule: settings.blankRule,
      tMode: settings.tMode,
      tSec,
      prepGapSec: settings.prepGapSec,
      flash: settings.flash,
      flashKindColor: settings.flashKindColor,
      flashOffsetMs: settings.flashOffsetMs,
    },
    order,
    reads: [],
    completed: false,
    endedAtIso: null,
  };
}

// --------------------------
// CSV
// --------------------------

export function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function round3(x) {
  return typeof x === "number" && Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x;
}

export const CSV_COLUMNS = [
  "label", "app_version", "game_no", "game_id", "game_started_iso",
  "max_value", "kinds", "blank_rule", "t_mode", "t_sec", "prep_gap_sec",
  "read_index", "value", "kind_index", "kind_label", "pressed_perf_ms", "pressed_epoch_ms",
  "event_index", "event_role", "ctx_time_s", "perf_ms", "epoch_ms", "epoch_iso",
  "flash_scheduled_perf_ms", "flash_shown_perf_ms", "output_latency_s", "base_latency_s",
];

// 記録を CSV にする。1行が1つの音（準備音を含む）である。
// 読みごとの値と種類、各音の予約時刻を AudioContext、performance.now、Date.now の3つの時間軸で並べる。
export function gamesToCsv(games) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const g of games) {
    const st = g.settings || {};
    for (const r of g.reads || []) {
      for (const e of r.events || []) {
        const row = [
          g.label, g.appVersion, g.gameNo, g.id, g.startedAtIso,
          st.maxValue, st.kinds, st.blankRule ? 1 : 0, st.tMode, st.tSec, st.prepGapSec,
          r.index, r.value, r.kind, kindLabel(r.kind, st.kinds), round3(r.pressedPerfMs), r.pressedEpochMs,
          e.index, e.role, e.ctx, round3(e.perf), round3(e.epoch),
          Number.isFinite(e.epoch) ? new Date(Math.round(e.epoch)).toISOString() : "",
          round3(e.flashPerf), round3(e.flashShownPerf), r.outputLatencySec, r.baseLatencySec,
        ];
        lines.push(row.map(csvEscape).join(","));
      }
    }
  }
  return lines.join("\r\n") + "\r\n";
}

// 記録から、各読みの隣り合う電子音の間隔（ミリ秒）を求める。予約の確かめに使う。
export function toneIntervalsMs(read) {
  const tones = (read.events || []).filter((e) => e.role !== "prep");
  const out = [];
  for (let i = 1; i < tones.length; i++) out.push(tones[i].perf - tones[i - 1].perf);
  return out;
}

// 運営者の記録の一覧に出す、ゲームの要約の文。
export function summarizeGame(g) {
  const st = g.settings || {};
  const kindsText = st.kinds > 1 ? `・${st.kinds}種類` : "";
  const blankText = st.blankRule ? "・空札" : "";
  return `第${g.gameNo}ゲーム　1〜${st.maxValue}${kindsText}${blankText}　t=${formatT(st.tSec)}秒　${g.reads.length}/${g.order.length}枚${g.completed ? "（読了）" : ""}`;
}
