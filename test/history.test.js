// core.js の、読まれた札の履歴を組み立てる関数の検査。実行は /opt/homebrew/bin/node --test test/*.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHistoryView, shownReadCount } from "../js/core.js";
import { RULES } from "../js/config.js";

const reads = (...values) => values.map((v) => (Array.isArray(v) ? { value: v[0], kind: v[1] } : { value: v, kind: 0 }));
const orders = (view, kind = 0) => view.rows[kind].cells.map((c) => c.order);

test("読みが無ければ、どの札にも印が付かず、直前の読みも無い", () => {
  const v = buildHistoryView({ rule: RULES.standard, reads: [], lastShown: false });
  assert.equal(v.rows.length, 1);
  assert.equal(v.rows[0].cells.length, 12);
  assert.ok(v.rows[0].cells.every((c) => c.order === 0 && !c.latest));
  assert.deepEqual(v.sequence, []);
  assert.equal(v.pending, false);
  assert.equal(v.columns, 12);
});

test("直前の読みは、見せてよいと決まるまで履歴に載せない", () => {
  const v = buildHistoryView({ rule: RULES.standard, reads: reads(7, 3, 11), lastShown: false });
  assert.deepEqual(v.sequence.map((s) => s.value), [7, 3]);
  assert.equal(v.pending, true);
  const o = orders(v);
  assert.equal(o[7 - 1], 1);
  assert.equal(o[3 - 1], 2);
  assert.equal(o[11 - 1], 0, "直前の読み（11）は、まだ印が付かない");
  assert.equal(v.rows[0].cells[3 - 1].latest, true);
});

test("直前の読みを見せてよいときは、すべての読みを読んだ順に載せる", () => {
  const v = buildHistoryView({ rule: RULES.standard, reads: reads(7, 3, 11), lastShown: true });
  assert.deepEqual(v.sequence.map((s) => [s.value, s.order]), [[7, 1], [3, 2], [11, 3]]);
  assert.equal(v.pending, false);
  assert.equal(orders(v)[11 - 1], 3);
  assert.equal(v.rows[0].cells.filter((c) => c.latest).length, 1);
  assert.equal(v.rows[0].cells[11 - 1].latest, true);
});

test("1枚目を読んだ直後は、履歴が空で、直前の読みだけがある", () => {
  const v = buildHistoryView({ rule: RULES.standard, reads: reads(5), lastShown: false });
  assert.deepEqual(v.sequence, []);
  assert.equal(v.pending, true);
  assert.equal(shownReadCount(reads(5), false), 0);
  assert.equal(shownReadCount(reads(5), true), 1);
  assert.equal(shownReadCount([], true), 0);
});

test("空札ありでは 1〜13 の13枚を1段に並べる", () => {
  const v = buildHistoryView({ rule: RULES.blank, reads: reads(13, 1), lastShown: true });
  assert.equal(v.rows.length, 1);
  assert.equal(v.rows[0].cells.length, 13);
  assert.equal(v.columns, 13);
  assert.equal(orders(v)[13 - 1], 1);
  assert.equal(v.rows[0].label, "");
  assert.deepEqual(v.sequence.map((s) => s.label), ["13", "1"]);
});

test("赤と黒では、赤の1〜6と黒の1〜6の2段に分け、同じ数字でも色ごとに印を付ける", () => {
  const v = buildHistoryView({ rule: RULES.redblack, reads: reads([4, 0], [4, 1], [2, 1]), lastShown: true });
  assert.equal(v.rows.length, 2);
  assert.deepEqual(v.rows.map((r) => r.label), ["赤", "黒"]);
  assert.ok(v.rows.every((r) => r.cells.length === 6));
  assert.equal(v.columns, 6);
  assert.deepEqual(orders(v, 0), [0, 0, 0, 1, 0, 0]);
  assert.deepEqual(orders(v, 1), [0, 3, 0, 2, 0, 0]);
  assert.deepEqual(v.sequence.map((s) => s.label), ["赤4", "黒4", "黒2"]);
  assert.equal(v.rows[1].cells[2 - 1].latest, true);
});

test("同じ札が2回あっても二重に数えず、最初に読んだ順を残す", () => {
  const v = buildHistoryView({ rule: RULES.standard, reads: reads(7, 3, 7, 9), lastShown: true });
  assert.deepEqual(v.sequence.map((s) => [s.value, s.order]), [[7, 1], [3, 2], [9, 3]]);
  assert.equal(orders(v)[7 - 1], 1);
  assert.equal(orders(v).filter((o) => o > 0).length, 3);
});

test("ルールの範囲の外の値や種類は無視する", () => {
  const v = buildHistoryView({ rule: RULES.standard, reads: reads(0, 13, [5, 1], 6), lastShown: true });
  assert.deepEqual(v.sequence.map((s) => s.value), [6]);
  assert.equal(v.sequence[0].order, 1);
});

test("全部の札を読み終えて答えを見れば、すべての札に 1〜12 の順の番号が付く", () => {
  const all = reads(12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1);
  const v = buildHistoryView({ rule: RULES.standard, reads: all, lastShown: true });
  assert.deepEqual(orders(v), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  const hidden = buildHistoryView({ rule: RULES.standard, reads: all, lastShown: false });
  assert.equal(orders(hidden)[0], 0, "最後に読んだ 1 は、答えを確かめるまで印が付かない");
  assert.equal(hidden.pending, true);
});
