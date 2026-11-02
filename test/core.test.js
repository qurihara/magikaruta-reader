// core.js の純粋な関数の検査。実行は /opt/homebrew/bin/node --test test/*.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeRng, shuffle, normalizePublicSettings, ruleOf, buildDeck, buildReadingOrder,
  buildToneTimeline, readDurationSec, toneDurationSec, ctxToPerf, ctxToEpoch, flashSpecFor, glowSpecFor,
  csvEscape, kindLabel, cardFace, toneIntervalsMs, formatT, speedWord, clampNumber,
} from "../js/core.js";
import {
  REVEAL_HOLD_MS, T_LEVELS, DEFAULT_PUBLIC_SETTINGS, RULES, RULE_KEYS, KIND_DEFS, FLASH, AUDIO, APP_VERSION,
} from "../js/config.js";

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

test("clampNumber は範囲の外を端に寄せ、読めない値は代わりの値にする", () => {
  assert.equal(clampNumber(5, 0, 3, 1), 3);
  assert.equal(clampNumber("abc", 0, 3, 1), 1);
  assert.equal(clampNumber("", 0, 3, 1), 1);
  assert.equal(clampNumber(null, 0, 3, 1), 1);
  assert.equal(clampNumber("2.5", 0, 3, 1), 2.5);
});

test("公開版の設定は、ルールと5水準の t だけを受け付ける", () => {
  assert.deepEqual(normalizePublicSettings({}), { ...DEFAULT_PUBLIC_SETTINGS });
  assert.deepEqual(normalizePublicSettings(null), { ...DEFAULT_PUBLIC_SETTINGS });
  assert.deepEqual(normalizePublicSettings({ rule: "blank", tSec: 1.6 }), { rule: "blank", tSec: 1.6 });
  assert.deepEqual(normalizePublicSettings({ rule: "redblack", tSec: "0.2" }), { rule: "redblack", tSec: 0.2 });
  // v0.1.0 の4種類のルールや自由な t は、既定に戻す。
  assert.equal(normalizePublicSettings({ rule: "kinds4" }).rule, "standard");
  assert.equal(normalizePublicSettings({ tSec: 0.33 }).tSec, 0.4);
  // 保存されているのが設定だけになるように、ほかの項目は捨てる。
  assert.deepEqual(Object.keys(normalizePublicSettings({ rule: "blank", tSec: 0.8, label: "x", flash: true })).sort(), ["rule", "tSec"]);
});

test("公開版のルールは3つで、赤と黒だけが「ほかの遊び方」", () => {
  assert.deepEqual(RULE_KEYS, ["standard", "blank", "redblack"]);
  assert.deepEqual(RULE_KEYS.filter((k) => RULES[k].other), ["redblack"]);
  assert.equal(ruleOf("nope").key, "standard");
  assert.equal(buildDeck(RULES.standard).length, 12);
  assert.equal(buildDeck(RULES.blank).length, 13);
  const rb = buildDeck(RULES.redblack);
  assert.equal(rb.length, 12);
  for (let v = 1; v <= 6; v++) assert.deepEqual(rb.filter((c) => c.value === v).map((c) => c.kind), [0, 1]);
  assert.ok(rb.every((c) => c.value <= 6));
});

test("速さの言葉は5水準に1つずつある", () => {
  for (const t of T_LEVELS) assert.ok(speedWord(t).length > 0);
  assert.equal(speedWord(0.4), "ふつう");
  assert.equal(speedWord(0.33), "");
  assert.equal(new Set(T_LEVELS.map((t) => speedWord(t))).size, T_LEVELS.length);
  // 英語の言葉（v0.4.0）
  assert.deepEqual(T_LEVELS.map((t) => speedWord(t, "en")), ["Very fast", "Fast", "Normal", "Slow", "Very slow"]);
  assert.equal(speedWord(0.33, "en"), "");
});

test("読む順は全部の札を1回ずつ含み、同じ札を2回読まない", () => {
  for (const rule of [RULES.standard, RULES.blank, RULES.redblack, { maxValue: 2, kinds: 1 }]) {
    const order = buildReadingOrder(rule, makeRng(rule.maxValue * 10 + rule.kinds));
    const keys = order.map((c) => `${c.value}-${c.kind}`);
    assert.equal(order.length, rule.maxValue * rule.kinds);
    assert.equal(new Set(keys).size, keys.length);
  }
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

test("カメラ用の点滅の色：準備音は灰、通常の音は白、最後は朱（赤と黒では色ごと）", () => {
  const opt = { kind: 0, kinds: 1, tSec: 0.4 };
  assert.equal(flashSpecFor({ role: "prep" }, opt).color, FLASH.prepColor);
  assert.equal(flashSpecFor({ role: "tone" }, opt).color, FLASH.toneColor);
  assert.equal(flashSpecFor({ role: "last" }, opt).color, FLASH.lastColor);
  assert.equal(flashSpecFor({ role: "last" }, { ...opt, kinds: 2, kind: 1 }).color, KIND_DEFS[1].color);
  assert.ok(flashSpecFor({ role: "tone" }, { ...opt, tSec: 0.1 }).durationSec <= 0.05);
});

test("公開版の札の光り方の印", () => {
  assert.equal(glowSpecFor({ role: "prep" }, { tSec: 0.4 }).token, "prep");
  assert.equal(glowSpecFor({ role: "tone" }, { tSec: 0.4 }).token, "tone");
  assert.equal(glowSpecFor({ role: "last" }, { tSec: 0.4 }).token, "last");
  assert.equal(glowSpecFor({ role: "last" }, { kind: 0, kinds: 2, tSec: 0.4 }).token, "last-red");
  assert.equal(glowSpecFor({ role: "last" }, { kind: 1, kinds: 2, tSec: 0.4 }).token, "last-black");
});

test("赤と黒の最後の音は高さで聞き分けられ、音色は同じ", () => {
  assert.equal(KIND_DEFS.length, 2);
  assert.equal(KIND_DEFS[0].wave, KIND_DEFS[1].wave);
  assert.ok(KIND_DEFS[0].lastHz > AUDIO.toneHz && KIND_DEFS[1].lastHz < AUDIO.toneHz);
  assert.notEqual(KIND_DEFS[0].color, KIND_DEFS[1].color);
});

test("種類の呼び名とトランプの表記", () => {
  assert.equal(kindLabel(0, 1), "");
  assert.equal(kindLabel(0, 2), "赤");
  assert.equal(kindLabel(1, 2), "黒");
  assert.equal(kindLabel(0, 2, "en"), "Red");
  assert.equal(kindLabel(1, 2, "en"), "Black");
  assert.equal(kindLabel(0, 1, "en"), "");
  assert.equal(cardFace(1), "A");
  assert.equal(cardFace(13), "K");
  assert.equal(cardFace(7), "");
  assert.equal(formatT(0.4), "0.4");
  assert.equal(formatT(0.30000000000000004), "0.3");
});

test("CSV の値の囲み", () => {
  assert.equal(csvEscape('a,"b"'), '"a,""b"""');
  assert.equal(csvEscape("改行\nあり"), '"改行\nあり"');
  assert.equal(csvEscape(null), "");
  assert.equal(csvEscape(0), "0");
});

test("記録から求めた電子音の間隔は t に一致する", () => {
  const base = { ctxNow: 2, perfNow: 5000, epochNow: 0 };
  const events = buildToneTimeline({ startCtx: 2.12, count: 7, tSec: 0.2, prepGapSec: 1 })
    .map((e) => ({ role: e.role, perf: ctxToPerf(e.at, base) }));
  const d = toneIntervalsMs({ events });
  assert.equal(d.length, 6);
  for (const x of d) assert.ok(Math.abs(x - 200) < 1e-6);
});

test("答えの確認の長押しの時間は約0.45秒（v0.2.2 で 0.9 秒から半分にした）", () => {
  assert.equal(REVEAL_HOLD_MS, 450);
});
