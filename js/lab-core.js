// ==========================
// lab-core.js
// ==========================
// 実験用のページ（lab.html）の純粋な処理。画面にも音にも保存にも触れない。node --test で検査する（test/lab-core.test.js）。
// 扱うもの：
// - 条件（電子音の間隔 t × 空札の有無）と、まだ行っていない条件の袋
// - ゲームの用意、後回し、手動の指定、やり直し、取り消し（無効）、終え方
// - 読みの記録（読み直し、中断）と、再読み込みのあとの復元
// - 状態の読み込みの検査、CSV の組み立て
// 状態（state）は1つのオブジェクトで、操作の関数はそれをその場で書き換える。呼び出し元（lab-app.js）は操作のたびに保存する。
// ==========================

import {
  APP_VERSION, LAB_SCHEMA, LAB_DEFAULT_CONFIG, T_MIN, T_MAX, TABLE_COUNT_MAX, DEAL_PER_PLAYER, DEFAULT_BLANK_RULE_TEXT,
} from "./config.js";
import { shuffle, roundT, formatT, clampNumber, buildReadingOrder, csvEscape, round3 } from "./core.js";

const iso = (ms) => new Date(ms).toISOString();

// 終え方の呼び名。
export const OUTCOME_LABELS = {
  completed: "完了",
  stopped: "途中終了",
  void: "無効",
  redo: "やり直し",
};

// 中断の理由の呼び名。
export const INTERRUPT_LABELS = {
  stop: "止める操作",
  reload: "再読み込み・閉じ直し",
  pagehide: "ページを離れた",
  import: "別の端末から読み込んだ",
};

// --------------------------
// 設定
// --------------------------

// t の水準を、文字列（「0.1, 0.2」）でも配列でも受け取り、範囲の中の値だけを小さい順に重複なく並べる。
export function parseTLevels(raw) {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(/[\s,、，]+/);
  const nums = list
    .filter((x) => x !== "" && x !== null && x !== undefined)
    .map(Number)
    .filter((x) => Number.isFinite(x) && x >= T_MIN && x <= T_MAX)
    .map(roundT);
  return [...new Set(nums)].sort((a, b) => a - b);
}

// 保存されていた設定や入力欄の値を、使える形にそろえる。範囲の外の値は端に寄せ、読めない値は既定に戻す。
export function normalizeLabConfig(raw = {}) {
  const r = { ...LAB_DEFAULT_CONFIG, ...(raw || {}) };
  let tLevels = parseTLevels(r.tLevels);
  if (tLevels.length === 0) tLevels = [...LAB_DEFAULT_CONFIG.tLevels];
  let blankLevels = Array.isArray(r.blankLevels) ? [...new Set(r.blankLevels.map(Boolean))] : [];
  if (blankLevels.length === 0) blankLevels = [...LAB_DEFAULT_CONFIG.blankLevels];
  blankLevels.sort((a, b) => Number(a) - Number(b)); // 空札なしを先に置く
  const text = String(r.blankRuleText ?? "").trim().slice(0, 300);
  return {
    tLevels,
    blankLevels,
    prepGapSec: Math.round(clampNumber(r.prepGapSec, 0.3, 3.0, LAB_DEFAULT_CONFIG.prepGapSec) * 100) / 100,
    volume: clampNumber(r.volume, 0, 1, LAB_DEFAULT_CONFIG.volume),
    flash: r.flash === undefined ? LAB_DEFAULT_CONFIG.flash : Boolean(r.flash),
    flashOffsetMs: Math.round(clampNumber(r.flashOffsetMs, -300, 500, 0)),
    tableCount: Math.round(clampNumber(r.tableCount, 1, TABLE_COUNT_MAX, LAB_DEFAULT_CONFIG.tableCount)),
    label: String(r.label ?? "").slice(0, 60),
    blankRuleText: text || DEFAULT_BLANK_RULE_TEXT,
  };
}

// --------------------------
// 条件
// --------------------------

// 条件の鍵。例：「t0.4|blank」「t1.6|noblank」。
export function condKey({ tSec, blank }) {
  return `t${formatT(tSec)}|${blank ? "blank" : "noblank"}`;
}

export function parseCondKey(key) {
  const m = /^t([\d.]+)\|(blank|noblank)$/.exec(String(key));
  if (!m) return null;
  return { tSec: roundT(Number(m[1])), blank: m[2] === "blank" };
}

// 設定の水準から、全部の条件の鍵を作る。空札の有無ごとに、t の小さい順に並べる。
export function conditionKeys(config) {
  const keys = [];
  for (const blank of config.blankLevels) {
    for (const tSec of config.tLevels) keys.push(condKey({ tSec, blank }));
  }
  return keys;
}

// 条件の詳しい中身。空札なしは 1〜12 を6枚ずつ、空札ありは 1〜13 から6枚ずつ配り、1枚が空札になる。
export function describeCondition({ tSec, blank }) {
  const t = roundT(tSec);
  return {
    key: condKey({ tSec: t, blank }),
    tSec: t,
    blank: Boolean(blank),
    maxValue: blank ? 13 : 12,
    dealPerPlayer: DEAL_PER_PLAYER,
    blankCards: blank ? 1 : 0,
  };
}

// 配り方の文。参加者に伝えるために、画面に大きく出す。
export function dealText(cond) {
  return cond.blank
    ? `${cond.dealPerPlayer}枚ずつ・空札1枚`
    : `${cond.dealPerPlayer}枚ずつ・空札なし`;
}

export function rangeText(cond) {
  return `1〜${cond.maxValue} の${cond.maxValue}枚`;
}

// --------------------------
// 状態
// --------------------------

export function createLabState({ config, now = Date.now(), id } = {}) {
  return {
    schema: LAB_SCHEMA,
    id: id || `s${now.toString(36)}`,
    createdAtIso: iso(now),
    createdByVersion: APP_VERSION,
    config: normalizeLabConfig(config),
    round: 0,          // 何巡目か。袋が空のときに次の条件を引くと1つ増える
    bag: [],           // まだ行っていない条件の鍵（同じ鍵が2つ入ることもある）
    nextGameNo: 1,
    currentId: null,   // 画面に出しているゲーム（用意したゲーム、進行中のゲーム、終えたばかりのゲーム）
    games: [],
    log: [],           // 監督者の操作の履歴
  };
}

export function currentGame(state) {
  return state.games.find((g) => g.id === state.currentId) || null;
}

export function findGame(state, id) {
  return state.games.find((g) => g.id === id) || null;
}

function addLog(state, now, op, game, detail = "") {
  state.log.push({ atIso: iso(now), op, gameNo: game ? game.gameNo : null, gameId: game ? game.id : null, detail });
}

// 読んでいる最中の読み（あれば）。
export function playingRead(game) {
  if (!game) return null;
  const last = game.reads[game.reads.length - 1];
  return last && last.status === "playing" ? last : null;
}

// --------------------------
// 条件の袋
// --------------------------

// 袋から条件を1つ無作為に取り出す。袋が空なら、全部の条件を詰め直して次の巡に進む。
// avoid を渡すと、袋にほかの条件があるかぎり、その条件を避ける（後回しにした条件をすぐに引き直さないため）。
export function drawFromBag(state, rng = Math.random, { avoid = null, now = Date.now() } = {}) {
  if (state.bag.length === 0) {
    state.round += 1;
    state.bag = shuffle(conditionKeys(state.config), rng);
    addLog(state, now, "round", null, `第${state.round}巡の袋を作った（${state.bag.length}条件）`);
  }
  let candidates = state.bag.map((_, i) => i);
  if (avoid && state.bag.some((k) => k !== avoid)) candidates = candidates.filter((i) => state.bag[i] !== avoid);
  const pick = candidates[Math.floor(rng() * candidates.length)];
  const [key] = state.bag.splice(pick, 1);
  return { key, round: state.round };
}

// 条件を袋に戻す。いまの設定の水準に無い条件は戻さない（水準を変えたあとの古い条件）。
export function returnToBag(state, key) {
  if (!conditionKeys(state.config).includes(key)) return false;
  state.bag.push(key);
  return true;
}

// 袋を空にする。次に条件を引くときに、全部の条件を詰め直して次の巡に進む。
export function resetBag(state, { now = Date.now() } = {}) {
  const dropped = state.bag.length;
  state.bag = [];
  addLog(state, now, "bag-reset", null, `袋を作り直す（残っていた${dropped}条件を捨てた）`);
}

// --------------------------
// ゲームの用意
// --------------------------

// 卓と名札の欄を、卓の数に合わせてそろえる。各卓は2人で、名札の番号は空でもよい。
export function normalizeTables(tables, count) {
  const src = Array.isArray(tables) ? tables : [];
  return Array.from({ length: count }, (_, i) => {
    const t = src[i] || {};
    const tags = Array.isArray(t.tags) ? t.tags : [];
    return {
      table: i + 1,
      active: t.active === undefined ? true : Boolean(t.active),
      tags: [String(tags[0] ?? "").slice(0, 20), String(tags[1] ?? "").slice(0, 20)],
    };
  });
}

// 新しいゲームの卓と名札は、直前のゲームから写す（参加者はゲームをまたいで同じことが多いため）。
function inheritTables(state) {
  const prev = state.games[state.games.length - 1];
  return normalizeTables(prev ? prev.tables : null, state.config.tableCount);
}

function makeGameId(state, now) {
  return `g${state.nextGameNo}-${now.toString(36)}`;
}

function newGame(state, { cond, manual, fromBag, round, now, rng, retryOf = null, tables = null }) {
  const c = describeCondition(cond);
  const g = {
    id: makeGameId(state, now),
    gameNo: state.nextGameNo,
    round: manual ? null : round,
    condition: c,
    manual: Boolean(manual),
    fromBag: Boolean(fromBag),   // 袋から引いた条件か（無効にしたときに袋へ戻すかどうか）
    retryOf,                     // やり直しなら、前の回のゲームの id
    status: "ready",             // "ready"（用意した）、"playing"（進行中）、"ended"（終えた）
    outcome: null,               // 終え方。"completed"、"stopped"、"void"、"redo"
    previousOutcome: null,       // 無効ややり直しにする前の終え方
    createdAtIso: iso(now),
    startedAtIso: null,          // 最初の読みの時刻
    endedAtIso: null,
    prepGapSec: state.config.prepGapSec,
    order: buildReadingOrder({ maxValue: c.maxValue, kinds: 1 }, rng).map((x) => x.value),
    cursor: 0,                   // 読み終えた札の数（読む順の何番目まで進んだか）
    reads: [],
    tables: tables ? normalizeTables(tables, state.config.tableCount) : inheritTables(state),
    memo: "",
    appVersion: APP_VERSION,
  };
  state.nextGameNo += 1;
  return g;
}

// 「次のゲームへ」：袋から条件を引いて、新しいゲームを用意する。いまのゲームが終わっていなければ使えない。
export function prepareNextGame(state, { rng = Math.random, now = Date.now() } = {}) {
  const cur = currentGame(state);
  if (cur && cur.status !== "ended") throw new Error("いまのゲームが終わっていません");
  const { key, round } = drawFromBag(state, rng, { now });
  const g = newGame(state, { cond: parseCondKey(key), manual: false, fromBag: true, round, now, rng });
  state.games.push(g);
  state.currentId = g.id;
  addLog(state, now, "next", g, `${key}（第${round}巡）`);
  return g;
}

// 用意したゲームの条件を差し替える。読む順も作り直す。
function setCondition(g, cond, { manual, fromBag, round, rng }) {
  const c = describeCondition(cond);
  g.condition = c;
  g.manual = Boolean(manual);
  g.fromBag = Boolean(fromBag);
  g.round = manual ? null : round;
  g.order = buildReadingOrder({ maxValue: c.maxValue, kinds: 1 }, rng).map((x) => x.value);
  g.cursor = 0;
}

// 後回し：まだ始めていない（1枚も読んでいない）ゲームの条件を袋に戻し、別の条件を引く。ゲームの番号は変えない。
export function postponeGame(state, { rng = Math.random, now = Date.now() } = {}) {
  const g = currentGame(state);
  if (!g || g.status !== "ready") throw new Error("後回しにできるのは、まだ始めていないゲームだけです");
  const oldKey = g.condition.key;
  if (g.fromBag) returnToBag(state, oldKey);
  const { key, round } = drawFromBag(state, rng, { avoid: oldKey, now });
  setCondition(g, parseCondKey(key), { manual: false, fromBag: true, round, rng });
  addLog(state, now, "postpone", g, `${oldKey} を袋に戻し、${key} を引いた`);
  return g;
}

// 手動の指定：監督者が選んだ t と空札の有無で1ゲームを用意する。袋の条件は使わない（記録に「手動」の印）。
// まだ始めていないゲームがあれば、その条件を袋に戻してから差し替える。
export function setManualGame(state, { tSec, blank }, { rng = Math.random, now = Date.now() } = {}) {
  const t = roundT(clampNumber(tSec, T_MIN, T_MAX, NaN));
  if (!Number.isFinite(t)) throw new Error(`t は ${T_MIN}〜${T_MAX} 秒で指定します`);
  const cond = { tSec: t, blank: Boolean(blank) };
  const cur = currentGame(state);
  if (cur && cur.status === "playing") throw new Error("進行中のゲームがあります");
  if (cur && cur.status === "ready") {
    if (cur.fromBag) returnToBag(state, cur.condition.key);
    const oldKey = cur.condition.key;
    setCondition(cur, cond, { manual: true, fromBag: false, round: null, rng });
    addLog(state, now, "manual", cur, `${oldKey} を ${cur.condition.key}（手動）に替えた`);
    return cur;
  }
  const g = newGame(state, { cond, manual: true, fromBag: false, round: null, now, rng });
  state.games.push(g);
  state.currentId = g.id;
  addLog(state, now, "manual", g, `${g.condition.key}（手動）`);
  return g;
}

// --------------------------
// 読み
// --------------------------

// 次の読みで読む札を決める。
// mode が "next"：直前の読みが中断なら同じ札を読み直し、そうでなければ読む順の次の札を読む。
// mode が "reread"：直前の読みと同じ札をもう一度読む（聞き逃しや物音のとき）。
// 読めないとき（ゲームが無い、終えた、読んでいる最中、全部読んだ）は null。
export function planRead(game, mode = "next") {
  if (!game || game.status === "ended") return null;
  if (playingRead(game)) return null;
  const last = game.reads[game.reads.length - 1] || null;
  if (mode === "reread") {
    if (!last) return null;
    return {
      pos: last.pos, value: game.order[last.pos], reread: true,
      rereadReason: last.status === "interrupted" ? "after-interrupt" : "manual",
    };
  }
  if (last && last.status === "interrupted") {
    return { pos: last.pos, value: game.order[last.pos], reread: true, rereadReason: "after-interrupt" };
  }
  if (game.cursor >= game.order.length) return null;
  return { pos: game.cursor, value: game.order[game.cursor], reread: false, rereadReason: null };
}

// 読みを始めた記録を足す。read は planRead の結果に、音の予約の結果（events など）を足したもの。
// 状態の保存はこの直後に行うので、読んでいる最中に端末が落ちても、この読みが「読んでいる最中」として残る。
export function startRead(state, game, read, { now = Date.now() } = {}) {
  if (playingRead(game)) throw new Error("読んでいる最中です");
  const r = { ...read, seq: game.reads.length + 1, status: "playing", interruptReason: null, startedAtEpochMs: now };
  if (game.status === "ready") {
    game.status = "playing";
    game.startedAtIso = iso(now);
    addLog(state, now, "start", game, game.condition.key);
  }
  game.reads.push(r);
  return r;
}

// 読みが最後まで鳴った。読む順を1つ進める（読み直しでも、中断した札を読み終えたなら進める）。
export function completeRead(game, seq) {
  const r = game.reads.find((x) => x.seq === seq);
  if (!r || r.status !== "playing") return null;
  r.status = "done";
  for (const e of r.events || []) e.played = true;
  game.cursor = Math.max(game.cursor, r.pos + 1);
  return r;
}

// 読みを途中で止めた（止める操作、再読み込み、ページを離れた）。読む順は進めない。
// stopCtx（止めた時点の AudioContext の時刻）が分かれば、どの音まで鳴ったかを各音の played に残す。分からなければ null。
export function interruptRead(game, seq, { reason = "stop", stopCtx = null, now = Date.now() } = {}) {
  const r = game.reads.find((x) => x.seq === seq);
  if (!r || r.status !== "playing") return null;
  r.status = "interrupted";
  r.interruptReason = reason;
  r.interruptedAtEpochMs = now;
  for (const e of r.events || []) e.played = typeof stopCtx === "number" ? e.ctx <= stopCtx : null;
  return r;
}

// --------------------------
// ゲームの終え方
// --------------------------

const ENDINGS = ["completed", "stopped", "void"];

// ゲームを終える。完了（札が無くなった）、途中終了（時間切れなど）、無効（記録に使わない）のどれか。
// 無効にしたときは、袋から引いた条件を袋に戻す。
export function endGame(state, outcome, { now = Date.now() } = {}) {
  if (!ENDINGS.includes(outcome)) throw new Error(`知らない終え方：${outcome}`);
  const g = currentGame(state);
  if (!g || g.status !== "playing") throw new Error("終えられるのは、進行中のゲームだけです");
  if (playingRead(g)) throw new Error("読んでいる最中です");
  g.status = "ended";
  g.outcome = outcome;
  g.endedAtIso = iso(now);
  let returned = false;
  if (outcome === "void" && g.fromBag) returned = returnToBag(state, g.condition.key);
  addLog(state, now, "end", g, `${OUTCOME_LABELS[outcome]}${returned ? "（条件を袋に戻した）" : ""}`);
  return g;
}

// 終えたゲームを続ける（終え方を押し間違えたとき）。完了と途中終了だけを戻せる。次のゲームを用意する前に限る。
export function reopenGame(state, { now = Date.now() } = {}) {
  const g = currentGame(state);
  if (!g || g.status !== "ended" || !(g.outcome === "completed" || g.outcome === "stopped")) {
    throw new Error("続けられるのは、完了か途中終了で終えた、いまのゲームだけです");
  }
  addLog(state, now, "reopen", g, `${OUTCOME_LABELS[g.outcome]}を取り消して続ける`);
  g.status = "playing";
  g.outcome = null;
  g.endedAtIso = null;
  return g;
}

// やり直し：同じ条件でもう一度。前の回は「やり直し」の印で残し、新しい番号のゲームを用意する。
// 進行中のゲームと、完了か途中終了で終えたいまのゲームに使える。条件の袋は変えない（前の回の条件を引き継ぐ）。
export function redoGame(state, { rng = Math.random, now = Date.now() } = {}) {
  const g = currentGame(state);
  const ok = g && (g.status === "playing" || (g.status === "ended" && (g.outcome === "completed" || g.outcome === "stopped")));
  if (!ok) throw new Error("やり直せるのは、進行中か、完了か途中終了で終えたいまのゲームだけです");
  if (playingRead(g)) throw new Error("読んでいる最中です");
  g.previousOutcome = g.outcome;
  g.status = "ended";
  g.outcome = "redo";
  if (!g.endedAtIso) g.endedAtIso = iso(now);
  const n = newGame(state, {
    cond: g.condition, manual: g.manual, fromBag: g.fromBag, round: g.round, now, rng, retryOf: g.id, tables: g.tables,
  });
  state.games.push(n);
  state.currentId = n.id;
  addLog(state, now, "redo", g, `第${n.gameNo}ゲームで同じ条件をやり直す`);
  return n;
}

// 取り消し：終えたゲームに「無効」の印を付け、袋から引いた条件を袋に戻す。
// 進行中のゲームを取り消すときは endGame(state, "void") を使う。やり直しの印のゲームは、条件を次の回に渡しているので取り消せない。
export function voidGame(state, id, { now = Date.now() } = {}) {
  const g = findGame(state, id);
  if (!g || g.status !== "ended" || g.outcome === "void" || g.outcome === "redo") {
    throw new Error("取り消せるのは、完了か途中終了で終えたゲームだけです");
  }
  g.previousOutcome = g.outcome;
  g.outcome = "void";
  const returned = g.fromBag ? returnToBag(state, g.condition.key) : false;
  addLog(state, now, "void", g, `${OUTCOME_LABELS[g.previousOutcome]}を無効にした${returned ? "（条件を袋に戻した）" : ""}`);
  return g;
}

// 卓と名札とメモを書き換える。
export function updateGameMeta(state, id, { tables, memo } = {}) {
  const g = findGame(state, id);
  if (!g) return null;
  if (tables) g.tables = normalizeTables(tables, Math.max(state.config.tableCount, tables.length));
  if (memo !== undefined) g.memo = String(memo).slice(0, 2000);
  return g;
}

// --------------------------
// 設定の変更
// --------------------------

// 設定を変える。条件の水準が変わったときは袋を空にし、次に引くときに新しい水準で次の巡を始める。
export function applyConfig(state, raw, { now = Date.now() } = {}) {
  const next = normalizeLabConfig(raw);
  const before = conditionKeys(state.config).join(",");
  const levelsChanged = before !== conditionKeys(next).join(",");
  state.config = next;
  if (levelsChanged) {
    state.bag = [];
    addLog(state, now, "levels", null, `条件の水準を変えた（${conditionKeys(next).length}条件）。次に引くときに新しい巡を始める`);
  }
  return { levelsChanged };
}

// --------------------------
// 復元と読み込み
// --------------------------

// 保存されていた状態を開き直したときに呼ぶ。読んでいる最中のまま残っていた読みを「中断」にする。
// 返り値は中断にした読みの数。
export function recoverState(state, { now = Date.now(), reason = "reload" } = {}) {
  let n = 0;
  for (const g of state.games) {
    for (const r of g.reads) {
      if (r.status === "playing") {
        interruptRead(g, r.seq, { reason, now });
        n++;
        addLog(state, now, "recover", g, `${r.seq}回目の読みを中断として記録した`);
      }
    }
  }
  return n;
}

// 書き出した JSON（または状態そのもの）を検査して、使える状態にして返す。形が合わなければ例外を投げる。
export function importState(obj) {
  const s = obj && typeof obj === "object" && obj.state && typeof obj.state === "object" ? obj.state : obj;
  if (!s || typeof s !== "object" || s.schema !== LAB_SCHEMA) {
    throw new Error("実験用のページの記録ではありません（schema が違います）");
  }
  if (!Array.isArray(s.games)) throw new Error("ゲームの一覧がありません");
  const copy = JSON.parse(JSON.stringify(s));
  copy.config = normalizeLabConfig(copy.config);
  copy.bag = (Array.isArray(copy.bag) ? copy.bag : []).filter((k) => parseCondKey(k));
  copy.round = Math.max(0, Math.round(Number(copy.round) || 0));
  copy.log = Array.isArray(copy.log) ? copy.log : [];
  for (const g of copy.games) {
    if (!g || typeof g !== "object" || !g.id || !g.condition || !Array.isArray(g.order) || !Array.isArray(g.reads)) {
      throw new Error("ゲームの記録の形が壊れています");
    }
    g.tables = normalizeTables(g.tables, Math.max(copy.config.tableCount, Array.isArray(g.tables) ? g.tables.length : 0));
  }
  const maxNo = copy.games.reduce((m, g) => Math.max(m, Number(g.gameNo) || 0), 0);
  copy.nextGameNo = Math.max(maxNo + 1, Math.round(Number(copy.nextGameNo) || 1));
  if (!copy.games.some((g) => g.id === copy.currentId)) copy.currentId = null;
  return copy;
}

// --------------------------
// 袋と進み具合の要約
// --------------------------

// 有効なゲーム（完了か途中終了）の数を、条件ごとに数える。手動のゲームは別に数える。
export function bagSummary(state) {
  const keys = conditionKeys(state.config);
  const cur = currentGame(state);
  const cells = keys.map((key) => {
    const c = parseCondKey(key);
    const games = state.games.filter((g) => g.condition.key === key && (g.outcome === "completed" || g.outcome === "stopped"));
    return {
      key,
      tSec: c.tSec,
      blank: c.blank,
      inBag: state.bag.filter((k) => k === key).length,
      done: games.filter((g) => !g.manual).length,
      manualDone: games.filter((g) => g.manual).length,
      current: Boolean(cur && cur.status !== "ended" && cur.condition.key === key),
    };
  });
  return { round: state.round, remaining: state.bag.length, total: keys.length, cells };
}

// ゲームの1行の要約（記録の一覧に出す）。
export function summarizeLabGame(g) {
  const c = g.condition;
  const parts = [`第${g.gameNo}ゲーム`];
  parts.push(g.manual ? "手動" : `第${g.round}巡`);
  parts.push(`t=${formatT(c.tSec)}秒`);
  parts.push(c.blank ? "空札あり" : "空札なし");
  parts.push(`${g.cursor}/${g.order.length}枚`);
  const rereads = g.reads.filter((r) => r.reread).length;
  const interrupted = g.reads.filter((r) => r.status === "interrupted").length;
  if (rereads) parts.push(`読み直し${rereads}`);
  if (interrupted) parts.push(`中断${interrupted}`);
  if (g.status === "ready") parts.push("用意");
  else if (g.status === "playing") parts.push("進行中");
  else parts.push(OUTCOME_LABELS[g.outcome] || g.outcome);
  if (g.retryOf) parts.push("やり直しの回");
  return parts.join("・");
}

// --------------------------
// CSV
// --------------------------

// 卓と名札を1つの欄にまとめる。例：「1[12/15] 2[3/]」（参加した卓だけ）。
export function tablesText(tables) {
  return (tables || []).filter((t) => t.active).map((t) => `${t.table}[${t.tags[0] || ""}/${t.tags[1] || ""}]`).join(" ");
}

// 1行が1つの音（準備音を含む）。v0.1.0 の CSV の列を土台に、ゲームの印と読みの印の列を足した。
export const LAB_CSV_COLUMNS = [
  "label", "app_version", "game_no", "game_id", "game_started_iso",
  "round", "condition_key", "manual", "retry_of", "outcome", "game_ended_iso", "tables",
  "max_value", "kinds", "blank_rule", "deal_per_player", "blank_cards", "t_mode", "t_sec", "prep_gap_sec",
  "read_index", "read_pos", "value", "kind_index", "kind_label", "reread", "reread_reason", "read_status", "interrupt_reason",
  "pressed_perf_ms", "pressed_epoch_ms", "perf_time_origin_ms",
  "event_index", "event_role", "event_played", "ctx_time_s", "perf_ms", "epoch_ms", "epoch_iso",
  "flash_scheduled_perf_ms", "flash_shown_perf_ms", "output_latency_s", "base_latency_s",
];

const flag = (b) => (b === null || b === undefined ? "" : (b ? 1 : 0));

export function labToCsv(state) {
  const label = state.config.label;
  const lines = [LAB_CSV_COLUMNS.join(",")];
  for (const g of state.games) {
    const c = g.condition;
    for (const r of g.reads) {
      for (const e of r.events || []) {
        const row = [
          label, g.appVersion, g.gameNo, g.id, g.startedAtIso,
          g.round ?? "", c.key, flag(g.manual), g.retryOf || "", g.outcome || "", g.endedAtIso || "", tablesText(g.tables),
          c.maxValue, 1, flag(c.blank), c.dealPerPlayer, c.blankCards, g.manual ? "manual" : "bag", c.tSec, g.prepGapSec,
          r.seq, r.pos, r.value, 0, "", flag(r.reread), r.rereadReason || "", r.status, r.interruptReason || "",
          round3(r.pressedPerfMs), r.pressedEpochMs, round3(r.base && r.base.timeOrigin),
          e.index, e.role, flag(e.played), e.ctx, round3(e.perf), round3(e.epoch),
          Number.isFinite(e.epoch) ? new Date(Math.round(e.epoch)).toISOString() : "",
          round3(e.flashPerf), round3(e.flashShownPerf), r.outputLatencySec, r.baseLatencySec,
        ];
        lines.push(row.map(csvEscape).join(","));
      }
    }
  }
  return lines.join("\r\n") + "\r\n";
}

// 1行が1つのゲーム。映像と照らし合わせて卓や名札を補うときに使う。
export const LAB_GAME_CSV_COLUMNS = [
  "label", "app_version", "game_no", "game_id", "round", "condition_key", "t_sec", "blank_rule", "max_value",
  "deal_per_player", "blank_cards", "manual", "retry_of", "status", "outcome", "previous_outcome",
  "created_iso", "game_started_iso", "game_ended_iso", "cards_read", "cards_total", "reads", "rereads", "interrupted",
  "tables", "memo",
];

export function labGamesCsv(state) {
  const label = state.config.label;
  const lines = [LAB_GAME_CSV_COLUMNS.join(",")];
  for (const g of state.games) {
    const c = g.condition;
    const row = [
      label, g.appVersion, g.gameNo, g.id, g.round ?? "", c.key, c.tSec, flag(c.blank), c.maxValue,
      c.dealPerPlayer, c.blankCards, flag(g.manual), g.retryOf || "", g.status, g.outcome || "", g.previousOutcome || "",
      g.createdAtIso, g.startedAtIso || "", g.endedAtIso || "", g.cursor, g.order.length, g.reads.length,
      g.reads.filter((r) => r.reread).length, g.reads.filter((r) => r.status === "interrupted").length,
      tablesText(g.tables), g.memo || "",
    ];
    lines.push(row.map(csvEscape).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
