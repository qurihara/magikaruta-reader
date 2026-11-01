// core.js の純粋な関数の検査。実行は /opt/homebrew/bin/node --test test/*.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeRng, shuffle, normalizeSettings, buildDeck, buildReadingOrder, drawTFromBag,
  buildToneTimeline, readDurationSec, toneDurationSec, ctxToPerf, ctxToEpoch, flashSpecFor,
  createGame, gamesToCsv, csvEscape, CSV_COLUMNS, kindLabel, cardFace, toneIntervalsMs, formatT, summarizeGame,
} from "../js/core.js";
import { T_LEVELS, DEFAULT_SETTINGS, KIND_DEFS, FLASH, AUDIO, APP_VERSION } from "../js/config.js";

test("版の数字は x.y.z の形", () => {
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
});

test("shuffle は元の配列を変えず、同じ要素を並べ替えて返す", () => {
  const src = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = shuffle(src, makeRng(1));
  assert.deepEqual(src, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...out].sort((a, b) => a - b), src);
});

test("同じ種の乱数なら同じ並びになる", () => {
  assert.deepEqual(shuffle([1, 2, 3, 4, 5], makeRng(42)), shuffle([1, 2, 3, 4, 5], makeRng(42)));
});

test("shuffle の最初の要素はおおむね一様に分布する", () => {
  const rng = makeRng(7);
  const counts = new Array(12).fill(0);
  const n = 24000;
  for (let i = 0; i < n; i++) counts[shuffle([...Array(12).keys()], rng)[0]]++;
  for (const c of counts) assert.ok(Math.abs(c - n / 12) < n / 12 * 0.1, `偏りが大きい: ${counts}`);
});

test("normalizeSettings は既定値を補い、範囲の外の値を端に寄せる", () => {
  assert.deepEqual(normalizeSettings({}), { ...DEFAULT_SETTINGS });
  const s = normalizeSettings({ maxValue: 99, kinds: 0, tSec: 10, tMode: "x", volume: 3, prepGapSec: "abc" });
  assert.equal(s.maxValue, 13);
  assert.equal(s.kinds, 1);
  assert.equal(s.tSec, 3);
  assert.equal(s.tMode, "fixed");
  assert.equal(s.volume, 1);
  assert.equal(s.prepGapSec, DEFAULT_SETTINGS.prepGapSec);
  assert.equal(normalizeSettings({ tSec: 0.30000000000000004 }).tSec, 0.3);
  assert.equal(normalizeSettings({ tMode: "random" }).tMode, "random");
  assert.equal(normalizeSettings(null).maxValue, 12);
});

test("現行ルールの札は 1〜12 の12枚", () => {
  const deck = buildDeck({ maxValue: 12, kinds: 1 });
  assert.equal(deck.length, 12);
  assert.deepEqual(deck.map((c) => c.value), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.ok(deck.every((c) => c.kind === 0));
});

test("種類が2つなら同じ値が2枚ずつ、13 と 4種類なら52枚", () => {
  const d2 = buildDeck({ maxValue: 12, kinds: 2 });
  assert.equal(d2.length, 24);
  for (let v = 1; v <= 12; v++) assert.deepEqual(d2.filter((c) => c.value === v).map((c) => c.kind), [0, 1]);
  assert.equal(buildDeck({ maxValue: 13, kinds: 4 }).length, 52);
});

test("読む順は全部の札を1回ずつ含み、同じ札を2回読まない", () => {
  for (const [maxValue, kinds] of [[12, 1], [13, 1], [12, 2], [13, 4], [2, 1]]) {
    const order = buildReadingOrder({ maxValue, kinds }, makeRng(maxValue * 10 + kinds));
    const keys = order.map((c) => `${c.value}-${c.kind}`);
    assert.equal(order.length, maxValue * kinds);
    assert.equal(new Set(keys).size, keys.length);
  }
});

test("t の袋は5ゲームごとに5水準を1回ずつ出す", () => {
  const rng = makeRng(3);
  let bag = [];
  const seen = [];
  for (let i = 0; i < 15; i++) {
    const r = drawTFromBag(bag, rng);
    seen.push(r.t);
    bag = r.bag;
  }
  for (let b = 0; b < 3; b++) {
    assert.deepEqual([...seen.slice(b * 5, b * 5 + 5)].sort((a, c) => a - c), T_LEVELS);
  }
});

test("t の袋に知らない値が入っていても捨てる", () => {
  const r = drawTFromBag([0.33, "x", 0.8], makeRng(1));
  assert.equal(r.t, 0.8);
  assert.deepEqual(r.bag, []);
});

test("電子音の時刻表：準備音、count 回の音、最後の音の役割と時刻", () => {
  const ev = buildToneTimeline({ startCtx: 10, count: 5, tSec: 0.4, prepGapSec: 1.0 });
  assert.equal(ev.length, 6);
  assert.deepEqual(ev.map((e) => e.role), ["prep", "tone", "tone", "tone", "tone", "last"]);
  assert.deepEqual(ev.map((e) => e.index), [0, 1, 2, 3, 4, 5]);
  assert.equal(ev[0].at, 10);
  assert.equal(ev[1].at, 11);
  for (let i = 2; i < ev.length; i++) {
    assert.ok(Math.abs(ev[i].at - ev[i - 1].at - 0.4) < 1e-9);
  }
  assert.equal(ev[5].durationSec, AUDIO.lastDurationSec);
  assert.equal(ev[1].durationSec, toneDurationSec(0.4));
});

test("1回だけの読みは、準備音と最後の音だけになる", () => {
  const ev = buildToneTimeline({ startCtx: 0, count: 1, tSec: 0.1, prepGapSec: 1 });
  assert.deepEqual(ev.map((e) => e.role), ["prep", "last"]);
  assert.throws(() => buildToneTimeline({ startCtx: 0, count: 0, tSec: 0.1, prepGapSec: 1 }));
});

test("5水準のどの t でも、音の間隔が t に一致し、音どうしが重ならない", () => {
  for (const t of T_LEVELS) {
    const ev = buildToneTimeline({ startCtx: 123.456, count: 13, tSec: t, prepGapSec: 1 });
    const tones = ev.filter((e) => e.role !== "prep");
    for (let i = 1; i < tones.length; i++) {
      assert.ok(Math.abs(tones[i].at - tones[i - 1].at - t) < 1e-9);
      assert.ok(tones[i - 1].at + tones[i - 1].durationSec < tones[i].at, `t=${t} で音が重なる`);
    }
  }
});

test("読みの長さ", () => {
  assert.ok(Math.abs(readDurationSec({ count: 12, tSec: 0.4, prepGapSec: 1 }) - (1 + 11 * 0.4 + AUDIO.lastDurationSec)) < 1e-9);
});

test("AudioContext の時刻を performance.now と Date.now の時間軸に換算する", () => {
  const base = { ctxNow: 5, perfNow: 1000, epochNow: 1_700_000_000_000 };
  assert.equal(ctxToPerf(5.25, base), 1250);
  assert.equal(ctxToEpoch(5.25, base), 1_700_000_000_250);
});

test("点滅の色：準備音は灰、通常の音は白、最後は朱か種類の色", () => {
  const opt = { kind: 1, kinds: 2, tSec: 0.4, flashKindColor: true };
  assert.equal(flashSpecFor({ role: "prep" }, opt).color, FLASH.prepColor);
  assert.equal(flashSpecFor({ role: "tone" }, opt).color, FLASH.toneColor);
  assert.equal(flashSpecFor({ role: "last" }, opt).color, KIND_DEFS[1].color);
  assert.equal(flashSpecFor({ role: "last" }, { ...opt, flashKindColor: false }).color, FLASH.lastColor);
  assert.equal(flashSpecFor({ role: "last" }, { ...opt, kinds: 1, kind: 0 }).color, FLASH.lastColor);
  assert.ok(flashSpecFor({ role: "tone" }, { ...opt, tSec: 0.1 }).durationSec <= 0.05);
});

test("種類の最後の音は、高さか音色の少なくとも一方が互いに違う", () => {
  for (let a = 0; a < KIND_DEFS.length; a++) {
    for (let b = a + 1; b < KIND_DEFS.length; b++) {
      const x = KIND_DEFS[a], y = KIND_DEFS[b];
      assert.ok(x.lastHz !== y.lastHz || x.wave !== y.wave);
      assert.notEqual(x.color, y.color);
    }
  }
  // 種類が2つのときは、高さだけで聞き分けられる（音色は同じ）。
  assert.equal(KIND_DEFS[0].wave, KIND_DEFS[1].wave);
  assert.notEqual(KIND_DEFS[0].lastHz, KIND_DEFS[1].lastHz);
});

test("種類の呼び名とトランプの表記", () => {
  assert.equal(kindLabel(0, 1), "");
  assert.equal(kindLabel(0, 2), "赤");
  assert.equal(kindLabel(1, 2), "黒");
  assert.equal(kindLabel(2, 4), "♦ダイヤ");
  assert.equal(cardFace(1), "A");
  assert.equal(cardFace(13), "K");
  assert.equal(cardFace(7), "");
  assert.equal(formatT(0.4), "0.4");
});

test("CSV の値の囲み", () => {
  assert.equal(csvEscape('a,"b"'), '"a,""b"""');
  assert.equal(csvEscape("改行\nあり"), '"改行\nあり"');
  assert.equal(csvEscape(null), "");
  assert.equal(csvEscape(0), "0");
});

function sampleGame() {
  const settings = normalizeSettings({ maxValue: 12, kinds: 2, tSec: 0.2, label: "A卓, 1" });
  const order = buildReadingOrder(settings, makeRng(5));
  const g = createGame({ gameNo: 3, settings, tSec: 0.2, order, now: Date.UTC(2026, 11, 13, 1, 0, 0), id: "gtest" });
  const base = { ctxNow: 2, perfNow: 5000, epochNow: Date.UTC(2026, 11, 13, 1, 0, 1) };
  for (let i = 0; i < 2; i++) {
    const card = order[i];
    const events = buildToneTimeline({ startCtx: 2.12 + i * 10, count: card.value, tSec: 0.2, prepGapSec: 1 }).map((e) => ({
      index: e.index, role: e.role, ctx: e.at, perf: ctxToPerf(e.at, base), epoch: ctxToEpoch(e.at, base),
      durationSec: e.durationSec, flashPerf: null, flashShownPerf: null,
    }));
    g.reads.push({ index: i + 1, value: card.value, kind: card.kind, pressedPerfMs: 5000, pressedEpochMs: base.epochNow, events, outputLatencySec: 0.01, baseLatencySec: 0.005 });
  }
  return g;
}

test("記録の CSV は1行が1つの音で、見出しの列と数がそろう", () => {
  const g = sampleGame();
  const csv = gamesToCsv([g]);
  const lines = csv.trim().split("\r\n");
  assert.equal(lines[0], CSV_COLUMNS.join(","));
  const expectedRows = g.reads.reduce((n, r) => n + r.events.length, 0);
  assert.equal(lines.length, 1 + expectedRows);
  // 見出しに「,」を含むので囲まれている。
  assert.ok(lines[1].startsWith('"A卓, 1",'));
  const col = (name) => CSV_COLUMNS.indexOf(name);
  const row = lines[2].replace(/^"A卓, 1",/, "X,").split(",");
  assert.equal(row.length, CSV_COLUMNS.length);
  assert.equal(row[col("game_no")], "3");
  assert.equal(row[col("t_sec")], "0.2");
  assert.equal(row[col("kinds")], "2");
});

test("記録から求めた電子音の間隔は t に一致する", () => {
  const g = sampleGame();
  for (const r of g.reads) {
    for (const d of toneIntervalsMs(r)) assert.ok(Math.abs(d - 200) < 1e-6);
  }
  assert.match(summarizeGame(g), /第3ゲーム　1〜12・2種類　t=0.2秒　2\/24枚/);
});

test("空の記録の CSV は見出しだけ", () => {
  assert.equal(gamesToCsv([]), CSV_COLUMNS.join(",") + "\r\n");
});
