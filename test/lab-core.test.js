// lab-core.js（実験用のページの純粋な処理）の検査。実行は /opt/homebrew/bin/node --test test/*.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRng, buildToneTimeline } from "../js/core.js";
import {
  normalizeLabConfig, parseTLevels, condKey, parseCondKey, conditionKeys, describeCondition, dealText,
  createLabState, currentGame, drawFromBag, prepareNextGame, postponeGame, setManualGame,
  planRead, startRead, completeRead, interruptRead, endGame, reopenGame, redoGame, voidGame,
  updateGameMeta, applyConfig, recoverState, importState, bagSummary, summarizeLabGame,
  labToCsv, LAB_CSV_COLUMNS, labGamesCsv, LAB_GAME_CSV_COLUMNS, tablesText, normalizeTables, resetBag,
} from "../js/lab-core.js";
import { LAB_SCHEMA, DEFAULT_BLANK_RULE_TEXT, LAB_DEFAULT_CONFIG } from "../js/config.js";

const NOW = Date.UTC(2026, 11, 13, 1, 0, 0);

function freshState(seed = 1) {
  return { state: createLabState({ now: NOW, id: "stest" }), rng: makeRng(seed) };
}

// 音を鳴らさずに、読みの記録だけを作る（app の readOnce と同じ形）。
function fakeRead(state, g, mode = "next", { finish = true, stop = false } = {}) {
  const plan = planRead(g, mode);
  if (!plan) return null;
  const events = buildToneTimeline({ startCtx: 1, count: plan.value, tSec: g.condition.tSec, prepGapSec: g.prepGapSec })
    .map((e) => ({ index: e.index, role: e.role, ctx: e.at, perf: 1000 + e.at * 1000, epoch: NOW + e.at * 1000, durationSec: e.durationSec, flashPerf: null, flashShownPerf: null }));
  const r = startRead(state, g, { ...plan, kind: 0, pressedPerfMs: 900, pressedEpochMs: NOW, base: { ctxNow: 0.9, perfNow: 900, epochNow: NOW, timeOrigin: 123 }, events }, { now: NOW });
  if (stop) interruptRead(g, r.seq, { reason: "stop", stopCtx: 2.05, now: NOW });
  else if (finish) completeRead(g, r.seq);
  return r;
}

test("設定の正規化：水準の文字列、範囲、空の説明文", () => {
  assert.deepEqual(parseTLevels("0.4, 0.1、1.6 0.4 abc 9"), [0.1, 0.4, 1.6]);
  const c = normalizeLabConfig({ tLevels: "", blankLevels: [], tableCount: 9, flashOffsetMs: 9999, blankRuleText: "  " });
  assert.deepEqual(c.tLevels, LAB_DEFAULT_CONFIG.tLevels);
  assert.deepEqual(c.blankLevels, [false, true]);
  assert.equal(c.tableCount, 4);
  assert.equal(c.flashOffsetMs, 500);
  assert.equal(c.blankRuleText, DEFAULT_BLANK_RULE_TEXT);
  assert.deepEqual(normalizeLabConfig({ blankLevels: [true] }).blankLevels, [true]);
});

test("既定の条件は t の5水準 × 空札の有無の10通り", () => {
  const { state } = freshState();
  const keys = conditionKeys(state.config);
  assert.equal(keys.length, 10);
  assert.equal(new Set(keys).size, 10);
  assert.deepEqual(parseCondKey(condKey({ tSec: 0.8, blank: true })), { tSec: 0.8, blank: true });
  assert.equal(parseCondKey("x"), null);
  const d = describeCondition({ tSec: 0.4, blank: true });
  assert.equal(d.maxValue, 13);
  assert.equal(d.blankCards, 1);
  assert.equal(d.dealPerPlayer, 6);
  assert.equal(describeCondition({ tSec: 0.4, blank: false }).maxValue, 12);
  assert.equal(dealText(d), "6枚ずつ・空札1枚");
});

test("袋：10ゲームで10条件が1回ずつ出て、11ゲーム目で第2巡になる", () => {
  const { state, rng } = freshState(3);
  const seen = [];
  for (let i = 0; i < 10; i++) {
    const g = prepareNextGame(state, { rng, now: NOW });
    assert.equal(g.round, 1);
    assert.equal(g.gameNo, i + 1);
    seen.push(g.condition.key);
    fakeRead(state, g);
    endGame(state, "completed", { now: NOW });
  }
  assert.deepEqual([...seen].sort(), [...conditionKeys(state.config)].sort());
  assert.equal(state.bag.length, 0);
  const g11 = prepareNextGame(state, { rng, now: NOW });
  assert.equal(g11.round, 2);
  assert.equal(state.bag.length, 9);
});

test("袋：進行中のゲームがあると次のゲームを用意できない", () => {
  const { state, rng } = freshState();
  const g = prepareNextGame(state, { rng });
  fakeRead(state, g);
  assert.throws(() => prepareNextGame(state, { rng }));
});

test("後回し：条件を袋に戻し、ほかの条件を引く。番号は変わらない", () => {
  const { state, rng } = freshState(5);
  const g = prepareNextGame(state, { rng, now: NOW });
  const before = g.condition.key;
  assert.equal(state.bag.length, 9);
  postponeGame(state, { rng, now: NOW });
  assert.notEqual(g.condition.key, before);
  assert.equal(g.gameNo, 1);
  assert.equal(state.bag.length, 9);
  assert.ok(state.bag.includes(before));
  assert.equal(state.games.length, 1);
  assert.equal(g.order.length, g.condition.maxValue);
  // 始めたゲームは後回しにできない。
  fakeRead(state, g);
  assert.throws(() => postponeGame(state, { rng }));
});

test("後回し：袋に1つしか無いときは、同じ条件を引き直す", () => {
  const { state, rng } = freshState();
  state.config = normalizeLabConfig({ tLevels: [0.4], blankLevels: [false] });
  const g = prepareNextGame(state, { rng });
  postponeGame(state, { rng });
  assert.equal(g.condition.key, "t0.4|noblank");
  assert.equal(state.bag.length, 0);
});

test("手動の指定：用意したゲームの条件は袋に戻り、手動の印が付く", () => {
  const { state, rng } = freshState(7);
  const g = prepareNextGame(state, { rng });
  const drawn = g.condition.key;
  setManualGame(state, { tSec: 0.25, blank: true }, { rng });
  assert.equal(g.manual, true);
  assert.equal(g.round, null);
  assert.equal(g.condition.key, "t0.25|blank");
  assert.equal(g.condition.maxValue, 13);
  assert.ok(state.bag.includes(drawn));
  assert.equal(state.bag.length, 10);
  // 手動のゲームを無効にしても、袋は変わらない。
  fakeRead(state, g);
  endGame(state, "void");
  assert.equal(state.bag.length, 10);
  // 終えたあとの手動の指定は、新しい番号のゲームになる。
  const g2 = setManualGame(state, { tSec: 0.8, blank: false }, { rng });
  assert.equal(g2.gameNo, 2);
  assert.throws(() => setManualGame(state, { tSec: "x", blank: false }, { rng }));
});

test("読み：順に進み、読み直しは直前の値を読み、読む順を飛ばさない", () => {
  const { state, rng } = freshState(9);
  const g = prepareNextGame(state, { rng });
  const r1 = fakeRead(state, g);
  assert.equal(g.status, "playing");
  assert.equal(r1.pos, 0);
  assert.equal(r1.value, g.order[0]);
  assert.equal(g.cursor, 1);
  const rr = fakeRead(state, g, "reread");
  assert.equal(rr.reread, true);
  assert.equal(rr.rereadReason, "manual");
  assert.equal(rr.value, g.order[0]);
  assert.equal(g.cursor, 1);
  const r2 = fakeRead(state, g);
  assert.equal(r2.value, g.order[1]);
  assert.equal(r2.reread, false);
  assert.equal(g.cursor, 2);
});

test("中断：止めた読みは中断として残り、次の「読む」で同じ値を読み直す", () => {
  const { state, rng } = freshState(11);
  const g = prepareNextGame(state, { rng });
  fakeRead(state, g);
  const stopped = fakeRead(state, g, "next", { stop: true });
  assert.equal(stopped.status, "interrupted");
  assert.equal(stopped.interruptReason, "stop");
  assert.equal(g.cursor, 1);
  // stopCtx=2.05 より前の音だけが鳴った（準備音は ctx=1、最初の電子音は ctx=2）。
  const played = stopped.events.map((e) => e.played);
  assert.equal(played[0], true);
  assert.equal(played[1], true);
  assert.ok(played.slice(2).every((x) => x === false));
  const again = fakeRead(state, g);
  assert.equal(again.reread, true);
  assert.equal(again.rereadReason, "after-interrupt");
  assert.equal(again.value, stopped.value);
  assert.equal(again.pos, stopped.pos);
  assert.equal(g.cursor, 2);
});

test("読んでいる最中は、次の読みも終え方も受け付けない", () => {
  const { state, rng } = freshState(13);
  const g = prepareNextGame(state, { rng });
  fakeRead(state, g, "next", { finish: false });
  assert.equal(planRead(g, "next"), null);
  assert.equal(planRead(g, "reread"), null);
  assert.throws(() => endGame(state, "completed"));
  assert.throws(() => redoGame(state, { rng }));
});

test("全部読んだら「読む」は無くなり、読み直しはできる", () => {
  const { state, rng } = freshState(15);
  const g = prepareNextGame(state, { rng });
  for (let i = 0; i < g.order.length; i++) fakeRead(state, g);
  assert.equal(g.cursor, g.order.length);
  assert.equal(planRead(g, "next"), null);
  assert.ok(planRead(g, "reread"));
  assert.equal(new Set(g.reads.map((r) => r.value)).size, g.order.length);
});

test("再読み込みからの復元：読んでいる最中の読みを中断にし、同じ値を読み直せる", () => {
  const { state, rng } = freshState(17);
  const g = prepareNextGame(state, { rng });
  fakeRead(state, g);
  const r = fakeRead(state, g, "next", { finish: false });
  // 保存した形（JSON）から戻す。
  const restored = JSON.parse(JSON.stringify(state));
  const n = recoverState(restored, { now: NOW });
  assert.equal(n, 1);
  const g2 = currentGame(restored);
  const last = g2.reads[g2.reads.length - 1];
  assert.equal(last.status, "interrupted");
  assert.equal(last.interruptReason, "reload");
  assert.ok(last.events.every((e) => e.played === null));
  const plan = planRead(g2, "next");
  assert.equal(plan.value, r.value);
  assert.equal(plan.reread, true);
  assert.equal(recoverState(restored), 0);
});

test("終え方：完了、途中終了、無効。無効は条件を袋に戻す", () => {
  const { state, rng } = freshState(19);
  const g = prepareNextGame(state, { rng });
  fakeRead(state, g);
  endGame(state, "stopped");
  assert.equal(g.outcome, "stopped");
  assert.ok(g.endedAtIso);
  assert.equal(state.bag.length, 9);
  const g2 = prepareNextGame(state, { rng });
  fakeRead(state, g2);
  endGame(state, "void");
  assert.equal(state.bag.length, 9);
  assert.ok(state.bag.includes(g2.condition.key));
  assert.throws(() => endGame(state, "completed"));
  assert.throws(() => endGame(state, "weird"));
});

test("終えたゲームを続ける：完了と途中終了だけ", () => {
  const { state, rng } = freshState(21);
  const g = prepareNextGame(state, { rng });
  fakeRead(state, g);
  endGame(state, "completed");
  reopenGame(state);
  assert.equal(g.status, "playing");
  assert.equal(g.outcome, null);
  endGame(state, "void");
  assert.throws(() => reopenGame(state));
});

test("やり直し：前の回に印を付け、同じ条件の新しいゲームを用意する。袋は変わらない", () => {
  const { state, rng } = freshState(23);
  const g = prepareNextGame(state, { rng });
  updateGameMeta(state, g.id, { tables: [{ active: true, tags: ["12", "15"] }, { active: false, tags: ["", ""] }], memo: "物音" });
  fakeRead(state, g);
  const bagBefore = [...state.bag];
  const n = redoGame(state, { rng });
  assert.equal(g.outcome, "redo");
  assert.equal(g.previousOutcome, null);
  assert.equal(n.retryOf, g.id);
  assert.equal(n.gameNo, 2);
  assert.equal(n.condition.key, g.condition.key);
  assert.equal(n.round, g.round);
  assert.equal(n.status, "ready");
  assert.deepEqual(n.tables[0].tags, ["12", "15"]);
  assert.equal(n.tables[1].active, false);
  assert.deepEqual(state.bag, bagBefore);
  assert.equal(currentGame(state).id, n.id);
  // やり直しの印のゲームは取り消せない。
  assert.throws(() => voidGame(state, g.id));
  // やり直しの回を無効にすると、条件は袋に戻る。
  fakeRead(state, n);
  endGame(state, "void");
  assert.ok(state.bag.includes(g.condition.key));
});

test("終えたゲームのやり直しは、前の終え方を残す", () => {
  const { state, rng } = freshState(25);
  const g = prepareNextGame(state, { rng });
  fakeRead(state, g);
  endGame(state, "completed");
  redoGame(state, { rng });
  assert.equal(g.outcome, "redo");
  assert.equal(g.previousOutcome, "completed");
});

test("取り消し：前のゲームを無効にすると条件が袋に戻る", () => {
  const { state, rng } = freshState(27);
  const g1 = prepareNextGame(state, { rng });
  fakeRead(state, g1);
  endGame(state, "completed");
  const g2 = prepareNextGame(state, { rng });
  fakeRead(state, g2);
  endGame(state, "completed");
  assert.equal(state.bag.length, 8);
  voidGame(state, g1.id);
  assert.equal(g1.outcome, "void");
  assert.equal(g1.previousOutcome, "completed");
  assert.equal(state.bag.length, 9);
  assert.ok(state.bag.includes(g1.condition.key));
  assert.throws(() => voidGame(state, g1.id));
});

test("袋の要約：有効なゲームの数と、袋に残る数", () => {
  const { state, rng } = freshState(29);
  const g = prepareNextGame(state, { rng });
  fakeRead(state, g);
  endGame(state, "completed");
  const s = bagSummary(state);
  assert.equal(s.round, 1);
  assert.equal(s.remaining, 9);
  assert.equal(s.total, 10);
  const cell = s.cells.find((c) => c.key === g.condition.key);
  assert.equal(cell.done, 1);
  assert.equal(cell.inBag, 0);
  assert.equal(s.cells.reduce((n, c) => n + c.inBag, 0), 9);
  assert.match(summarizeLabGame(g), /第1ゲーム・第1巡・t=.*・完了/);
});

test("水準を変えると袋を空にし、次に引くときに新しい巡を始める", () => {
  const { state, rng } = freshState(31);
  const g = prepareNextGame(state, { rng });
  fakeRead(state, g);
  endGame(state, "completed");
  const { levelsChanged } = applyConfig(state, { ...state.config, tLevels: [0.2, 0.4] });
  assert.equal(levelsChanged, true);
  assert.equal(state.bag.length, 0);
  const g2 = prepareNextGame(state, { rng });
  assert.equal(g2.round, 2);
  assert.equal(state.bag.length, 3);
  assert.equal(applyConfig(state, { ...state.config, label: "A" }).levelsChanged, false);
  resetBag(state);
  assert.equal(state.bag.length, 0);
});

test("卓と名札：卓の数に合わせてそろえ、CSV では参加した卓だけを並べる", () => {
  const t = normalizeTables([{ active: true, tags: ["12", "15"] }, { active: false, tags: ["1"] }], 3);
  assert.equal(t.length, 3);
  assert.deepEqual(t[2], { table: 3, active: true, tags: ["", ""] });
  assert.equal(tablesText(t), "1[12/15] 3[/]");
});

test("書き出した JSON を読み込むと、同じ続きから進められる", () => {
  const { state, rng } = freshState(33);
  const g = prepareNextGame(state, { rng });
  fakeRead(state, g);
  fakeRead(state, g, "next", { finish: false });
  const exported = JSON.parse(JSON.stringify({ app: "majikaruta-reader", schema: LAB_SCHEMA, state }));
  const s2 = importState(exported);
  recoverState(s2);
  assert.equal(s2.games.length, 1);
  assert.equal(currentGame(s2).cursor, 1);
  assert.deepEqual(s2.bag, state.bag);
  assert.equal(s2.nextGameNo, 2);
  const plan = planRead(currentGame(s2), "next");
  assert.equal(plan.reread, true);
  // 状態そのものを渡しても読める。
  assert.equal(importState(JSON.parse(JSON.stringify(state))).games.length, 1);
  assert.throws(() => importState({ schema: "other" }));
  assert.throws(() => importState({ schema: LAB_SCHEMA, games: [{ id: "x" }] }));
  assert.throws(() => importState(null));
});

test("音の CSV は1行が1つの音で、ゲームと読みの印の列を含む", () => {
  const { state, rng } = freshState(35);
  state.config.label = "会場, A";
  const g = prepareNextGame(state, { rng });
  fakeRead(state, g);
  fakeRead(state, g, "reread");
  fakeRead(state, g, "next", { stop: true });
  const csv = labToCsv(state);
  const lines = csv.trim().split("\r\n");
  assert.equal(lines[0], LAB_CSV_COLUMNS.join(","));
  const expected = g.reads.reduce((n, r) => n + r.events.length, 0);
  assert.equal(lines.length, 1 + expected);
  assert.ok(lines[1].startsWith('"会場, A",'));
  const col = (name) => LAB_CSV_COLUMNS.indexOf(name);
  const rows = lines.slice(1).map((l) => l.replace(/^"会場, A",/, "X,").split(","));
  for (const row of rows) assert.equal(row.length, LAB_CSV_COLUMNS.length);
  assert.ok(rows.some((r) => r[col("reread")] === "1" && r[col("reread_reason")] === "manual"));
  assert.ok(rows.some((r) => r[col("read_status")] === "interrupted" && r[col("event_played")] === "0"));
  assert.equal(rows[0][col("condition_key")], g.condition.key);
  assert.equal(rows[0][col("round")], "1");
  assert.equal(rows[0][col("t_mode")], "bag");
  assert.equal(rows[0][col("perf_time_origin_ms")], "123");
});

test("ゲームの CSV は1行が1つのゲーム", () => {
  const { state, rng } = freshState(37);
  const g = prepareNextGame(state, { rng });
  updateGameMeta(state, g.id, { memo: "改行\nあり" });
  fakeRead(state, g);
  endGame(state, "completed");
  const csv = labGamesCsv(state);
  assert.ok(csv.startsWith(LAB_GAME_CSV_COLUMNS.join(",") + "\r\n"));
  assert.ok(csv.includes('"改行\nあり"'));
  assert.ok(csv.includes(",completed,"));
});
