// ==========================
// lab-app.js
// ==========================
// 実験用のページ（lab.html）の画面の操作。監督者が1台の端末で、読み上げと進行管理を行う。
// 状態の操作（条件の袋、やり直し、取り消し、読みの記録、復元）は lab-core.js の関数で行い、
// 操作のたびに状態の全部を lab-storage.js で保存する。音は audio.js、点滅は flash.js が受け持つ（公開版と共有）。
// 自動では次のゲームへ進まない。1ゲームが終わったら、監督者が「次のゲームへ」を押すまで待つ。
// ==========================

import {
  APP_VERSION, LAB_SCHEMA, FLASH, AFTER_READ_SEC, REVEAL_HOLD_MS, REVEAL_SHOW_MS, ARM_MS, T_LEVELS,
} from "./config.js";
import { formatT, cardFace, ctxToPerf, ctxToEpoch, flashSpecFor, round3, roundT } from "./core.js";
import {
  createLabState, currentGame, findGame, playingRead, prepareNextGame, postponeGame, setManualGame,
  planRead, startRead, completeRead, interruptRead, endGame, reopenGame, redoGame, voidGame, updateGameMeta,
  applyConfig, resetBag, recoverState, importState, bagSummary, summarizeLabGame, labToCsv, labGamesCsv,
  dealText, rangeText, normalizeTables, conditionKeys, OUTCOME_LABELS, INTERRUPT_LABELS,
} from "./lab-core.js";
import {
  unlockAudio, audioState, setVolume, scheduleRead, stopAll, playSoundCheck, currentCtxTime,
} from "./audio.js";
import { createFlasher } from "./flash.js";
import { openLabStore, loadLabState, saveLabState, stateSizeKb, storeMode } from "./lab-storage.js";
import {
  $, openDialog, closeDialog, wireDialogs, anyDialogOpen, setupHold, setupArmed, keepScreenOn, stamp, download,
  registerOffline, isTouch, isApple,
} from "./ui.js";

// --------------------------
// 状態
// --------------------------

let state = null;
let reading = null;     // 読んでいる最中の読み { gameId, seq, timer }
let pressing = false;   // 「読む」の二重押しを防ぐ
let saveSeq = 0;
let lastSavedAt = null;
let saveError = null;

const flasher = createFlasher({
  base: FLASH.baseColor,
  apply: (color) => { $("flash").style.backgroundColor = color || ""; },
  onStart: () => { $("flash").hidden = false; document.documentElement.classList.add("is-flashing"); },
  onStop: () => { $("flash").hidden = true; document.documentElement.classList.remove("is-flashing"); },
});

// --------------------------
// 保存
// --------------------------

// 操作のたびに呼ぶ。書き込みは呼んだ順に確定する。最後の書き込みが確定したら「保存済み」を出す。
function persist() {
  state.updatedAtIso = new Date().toISOString();
  const my = ++saveSeq;
  setSaveBadge();
  saveLabState(state).then(() => {
    if (my !== saveSeq) return;
    lastSavedAt = new Date();
    saveError = null;
    setSaveBadge();
  }).catch((e) => {
    saveError = e;
    setSaveBadge();
    showNotice("この端末に保存できませんでした。すぐに「書き出し・読み込み」から JSON を書き出してください。");
  });
}

function setSaveBadge() {
  const b = $("saveBadge");
  if (saveError) {
    b.textContent = "保存できません";
    b.dataset.state = "error";
  } else if (lastSavedAt && saveSeq > 0) {
    const p = (x) => String(x).padStart(2, "0");
    b.textContent = `保存済み ${p(lastSavedAt.getHours())}:${p(lastSavedAt.getMinutes())}:${p(lastSavedAt.getSeconds())}`;
    b.dataset.state = "ok";
  } else {
    b.textContent = "保存しています";
    b.dataset.state = "saving";
  }
}

// 操作を行い、保存し、画面を描き直す。操作が例外を投げたら、その文を画面に出す。
function act(fn, message) {
  try {
    fn();
  } catch (e) {
    setStatus(String(e.message || e));
    return false;
  }
  persist();
  render();
  if (message) setStatus(typeof message === "function" ? message() : message);
  return true;
}

// --------------------------
// 読み
// --------------------------

async function onRead(mode) {
  // キーとクリックが続けて届いても、1回の読みしか予約しない。
  if (reading || pressing) return;
  pressing = true;
  try {
    await readOnce(mode);
  } finally {
    pressing = false;
  }
}

async function readOnce(mode) {
  const pressedPerfMs = performance.now();
  const pressedEpochMs = Date.now();
  await unlockAudio();
  if (audioState() !== "running") {
    setStatus("音を出せませんでした。もう一度押してください。");
    return;
  }
  const g = currentGame(state);
  const plan = planRead(g, mode);
  if (!plan) return;
  const cfg = state.config;
  setVolume(cfg.volume);
  const sched = scheduleRead({ count: plan.value, kind: 0, tSec: g.condition.tSec, prepGapSec: g.prepGapSec });

  // 点滅は、音が実際にスピーカから出る時刻に合わせる。AudioContext が報告する遅れと、手で入れた補正を足す。
  const latencyMs = ((sched.outputLatencySec || 0) + (sched.baseLatencySec || 0)) * 1000;
  const flashCompMs = latencyMs + cfg.flashOffsetMs;
  const events = sched.events.map((e) => {
    const perf = ctxToPerf(e.at, sched.base);
    return {
      index: e.index,
      role: e.role,
      ctx: Math.round(e.at * 1e6) / 1e6,
      perf: round3(perf),
      epoch: round3(ctxToEpoch(e.at, sched.base)),
      durationSec: e.durationSec,
      played: null,
      flashPerf: cfg.flash ? round3(perf + flashCompMs) : null,
      flashShownPerf: null,
    };
  });
  const read = startRead(state, g, {
    ...plan,
    kind: 0,
    pressedPerfMs: round3(pressedPerfMs),
    pressedEpochMs,
    base: { ctxNow: sched.base.ctxNow, perfNow: round3(sched.base.perfNow), epochNow: sched.base.epochNow, timeOrigin: round3(sched.base.timeOrigin) },
    outputLatencySec: sched.outputLatencySec,
    baseLatencySec: sched.baseLatencySec,
    sampleRate: sched.sampleRate,
    flash: cfg.flash,
    flashOffsetMs: cfg.flashOffsetMs,
    flashCompMs: round3(flashCompMs),
    events,
  }, { now: pressedEpochMs });
  // 鳴らし始める前に保存する。読んでいる最中に端末が落ちても、この読みが残り、開き直すと「中断」になる。
  persist();
  reading = { gameId: g.id, seq: read.seq, timer: 0 };

  if (cfg.flash) {
    flasher.run(read.events.map((e) => {
      const spec = flashSpecFor(e, { kind: 0, kinds: 1, tSec: g.condition.tSec });
      return {
        startPerf: e.flashPerf,
        endPerf: e.flashPerf + spec.durationSec * 1000,
        color: spec.color,
        onShown: (frameTime) => { e.flashShownPerf = round3(frameTime); },
      };
    }));
  }
  render();

  // 画面の状態を戻す時刻だけを setTimeout で決める（音の時刻には使わない）。
  const last = read.events[read.events.length - 1];
  const endPerf = last.perf + last.durationSec * 1000 + Math.max(0, flashCompMs) + AFTER_READ_SEC * 1000;
  reading.timer = setTimeout(finishRead, Math.max(0, endPerf - performance.now()));
}

function finishRead() {
  if (!reading) return;
  flasher.stop();
  const g = findGame(state, reading.gameId);
  const r = g ? completeRead(g, reading.seq) : null;
  reading = null;
  persist(); // 点滅が実際に出たコマの時刻を書き足して保存する
  render();
  if (r && g) {
    setStatus(g.cursor >= g.order.length
      ? "全部の札を読みました。札が無くなったら「ゲームを終える」を押します。"
      : `${r.reread ? "読み直し" : `${g.cursor}枚目`}を読み終えました。札を取り終えたら、次を読みます。`);
  }
}

// 読んでいる最中に止める。その読みは「中断」として残り、次の「読む」で同じ札を読み直す。
function stopReading(reason = "stop") {
  if (!reading) return;
  const stopCtx = currentCtxTime();
  stopAll();
  flasher.stop();
  clearTimeout(reading.timer);
  const g = findGame(state, reading.gameId);
  if (g) interruptRead(g, reading.seq, { reason, stopCtx, now: Date.now() });
  reading = null;
  persist();
  render();
  setStatus("読みを止めました。「読む」か「読み直す」で、同じ札をもう一度読みます。");
}

// --------------------------
// 表示
// --------------------------

function setStatus(text) {
  $("statusText").textContent = text;
}

function showNotice(text) {
  const n = $("mainNotice");
  n.textContent = text;
  n.hidden = !text;
}

function show(id, on) {
  $(id).hidden = !on;
}

function render() {
  if (!state) return;
  const g = currentGame(state);
  const busy = Boolean(reading);
  renderPlate(g);
  renderReader(g, busy);
  renderFlow(g, busy);
  renderMeta(g);
  renderBag();
  renderHistory();
  $("btnSettings").disabled = busy;
  $("btnData").disabled = busy;
}

function phaseText(g) {
  if (!g) return "まだゲームがありません";
  const tag = g.manual ? "手動" : `第${g.round}巡`;
  const retry = g.retryOf ? "・やり直しの回" : "";
  if (g.status === "ready") return `用意しました（まだ読んでいません）・${tag}${retry}`;
  if (g.status === "playing") return `進行中・${tag}${retry}`;
  return `終えました（${OUTCOME_LABELS[g.outcome]}）・${tag}${retry}`;
}

function renderPlate(g) {
  $("pGameNo").textContent = g ? g.gameNo : "—";
  $("pT").textContent = g ? formatT(g.condition.tSec) : "—";
  $("pDeal").textContent = g ? dealText(g.condition) : "—";
  $("pRange").textContent = g ? rangeText(g.condition) : "";
  $("pPhase").textContent = phaseText(g);
  $("plate").dataset.blank = g && g.condition.blank ? "1" : "0";
  $("plate").dataset.phase = g ? g.status : "none";
  // 点滅の上に出す札も同じ内容にする。
  $("fGameNo").textContent = g ? g.gameNo : "";
  $("fT").textContent = g ? formatT(g.condition.tSec) : "";
  $("fDeal").textContent = g ? dealText(g.condition) : "";
}

function renderReader(g, busy) {
  const total = g ? g.order.length : 0;
  const n = g ? g.cursor : 0;
  $("readCount").textContent = n;
  $("totalCount").textContent = total;

  const slots = $("slots");
  if (slots.childElementCount !== total) {
    slots.replaceChildren(...Array.from({ length: total }, () => document.createElement("i")));
  }
  const playing = g ? playingRead(g) : null;
  Array.from(slots.children).forEach((el, i) => {
    el.className = playing && i === playing.pos ? "now" : (i < n ? "done" : "");
  });

  const plan = g ? planRead(g, "next") : null;
  const btn = $("btnRead");
  btn.disabled = busy || !plan;
  btn.classList.toggle("is-reading", busy);
  btn.classList.toggle("is-done", !busy && Boolean(g) && !plan);
  let label = "読む";
  let sub = "";
  if (busy) {
    label = "読んでいます";
    sub = "止めるときは「止める」か Esc";
  } else if (!g) {
    label = "読む";
    sub = "先に「次のゲームへ」でゲームを用意します";
  } else if (g.status === "ended") {
    label = "終えました";
    sub = "「次のゲームへ」で次へ進みます";
  } else if (!plan) {
    label = "全部読みました";
    sub = "札が無くなったら「ゲームを終える」";
  } else if (plan.reread) {
    label = "読み直す";
    sub = "中断した札をもう一度読みます";
  } else {
    sub = n === 0 ? "1枚目（このゲームを始めます）" : `${n + 1}枚目`;
  }
  $("readLabel").textContent = label;
  $("readSub").textContent = sub;

  $("btnReread").disabled = busy || !(g && planRead(g, "reread"));
  $("btnStop").disabled = !busy;
  $("btnReveal").disabled = busy || !(g && g.reads.length > 0);
  if (!busy && !$("statusText").textContent) {
    setStatus(g ? "" : "「次のゲームへ」を押すと、袋から条件を引いて第1ゲームを用意します。");
  }
}

function renderFlow(g, busy) {
  const phase = g ? g.status : "none";
  const title = $("flowTitle");
  const text = $("flowText");
  show("flowReady", phase === "ready");
  show("flowPlaying", phase === "playing");
  show("flowEnded", phase === "ended" || phase === "none");
  if (phase !== "playing") show("endChoices", false);
  if (phase === "none") {
    title.textContent = "最初のゲーム";
    text.textContent = "「次のゲームへ」を押すと、まだ行っていない条件の袋から1つを無作為に引き、第1ゲームを用意します。";
    $("btnNext").textContent = "最初のゲームを用意する";
  } else if (phase === "ready") {
    title.textContent = `第${g.gameNo}ゲームを用意しました`;
    text.textContent = `参加者に「${dealText(g.condition)}」と伝えて、${rangeText(g.condition)}から配ってもらいます。準備ができたら「読む」を押します。`;
  } else if (phase === "playing") {
    title.textContent = `第${g.gameNo}ゲームの進行中`;
    text.textContent = "札が無くなったら「ゲームを終える」を押し、終え方を選びます。";
  } else {
    title.textContent = `第${g.gameNo}ゲームを終えました（${OUTCOME_LABELS[g.outcome]}）`;
    text.textContent = "休憩や説明のあと、準備ができたら「次のゲームへ」を押します。自動では次へ進みません。";
    $("btnNext").textContent = "次のゲームへ";
  }
  // 空札のルールの表示。空札ありのゲームで、直前の有効なゲームが空札なしだったときは目立たせる。
  if (g) {
    $("btnShowRule").textContent = g.condition.blank ? "空札のルールを参加者に見せる" : "ルールを参加者に見せる（空札なし）";
    const prev = state.games.filter((x) => x.id !== g.id && x.reads.length > 0 && x.outcome !== "void").pop();
    $("btnShowRule").classList.toggle("attention", g.condition.blank && (!prev || !prev.condition.blank));
  }
  $("btnReopen").hidden = !(g && g.status === "ended" && (g.outcome === "completed" || g.outcome === "stopped"));
  $("btnManual2").hidden = false;

  const canRedo = !busy && g && (g.status === "playing" || (g.status === "ended" && (g.outcome === "completed" || g.outcome === "stopped")));
  $("btnRedo").disabled = !canRedo;
  $("btnVoid").disabled = !canRedo;
  ["btnPostpone", "btnManual", "btnShowRule", "btnEnd", "btnEndCompleted", "btnEndStopped", "btnEndVoid", "btnNext", "btnManual2", "btnReopen"]
    .forEach((id) => { $(id).disabled = busy; });
}

// 卓と名札の欄。打っている最中に描き直さないように、ゲームか卓の数が変わったときだけ作り直す。
let metaKey = "";
function renderMeta(g, force = false) {
  show("metaPanel", Boolean(g));
  if (!g) { metaKey = ""; return; }
  const key = `${g.id}|${g.tables.length}`;
  if (!force && key === metaKey) return;
  metaKey = key;
  $("metaGameNo").textContent = `（第${g.gameNo}ゲーム）`;
  $("metaTables").replaceChildren(...buildTableEditor(g));
  $("metaMemo").value = g.memo || "";
  $("metaMemo").oninput = () => { updateGameMeta(state, g.id, { memo: $("metaMemo").value }); persistSoon(); };
}

// 卓ごとに「参加」と2人の名札の番号の欄を作る。書き換えたら、その場で記録に入れる。
function buildTableEditor(g) {
  return g.tables.map((t, i) => {
    const row = document.createElement("div");
    row.className = "meta-row";
    row.innerHTML = `<label class="inline-check"><input type="checkbox"> <b></b></label>
      <input type="text" class="tag" inputmode="numeric" maxlength="20" placeholder="名札">
      <input type="text" class="tag" inputmode="numeric" maxlength="20" placeholder="名札">`;
    const [chk, a, b] = row.querySelectorAll("input");
    row.querySelector("b").textContent = `${t.table}卓`;
    chk.checked = t.active;
    a.value = t.tags[0];
    b.value = t.tags[1];
    a.setAttribute("aria-label", `${t.table}卓の1人目の名札の番号`);
    b.setAttribute("aria-label", `${t.table}卓の2人目の名札の番号`);
    const update = () => {
      const tables = g.tables.map((x) => ({ ...x, tags: [...x.tags] }));
      tables[i] = { table: t.table, active: chk.checked, tags: [a.value.trim(), b.value.trim()] };
      updateGameMeta(state, g.id, { tables });
      row.classList.toggle("off", !chk.checked);
      persistSoon();
    };
    row.classList.toggle("off", !t.active);
    chk.addEventListener("change", update);
    a.addEventListener("input", update);
    b.addEventListener("input", update);
    return row;
  });
}

let persistTimer = 0;
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 400);
}

function renderBag() {
  const s = bagSummary(state);
  $("bagRound").textContent = s.round === 0
    ? "（まだ引いていません）"
    : `（第${s.round}巡・袋の残り ${s.remaining}／${s.total}${s.remaining === 0 ? "、次は第" + (s.round + 1) + "巡" : ""}）`;
  const ts = state.config.tLevels;
  const table = $("bagTable");
  const head = document.createElement("tr");
  head.innerHTML = `<th scope="col">t（秒）</th>`;
  ts.forEach((t) => { const th = document.createElement("th"); th.scope = "col"; th.textContent = formatT(t); head.appendChild(th); });
  const rows = state.config.blankLevels.map((blank) => {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = blank ? "空札あり" : "空札なし";
    tr.appendChild(th);
    ts.forEach((t) => {
      const cell = s.cells.find((c) => c.tSec === t && c.blank === blank);
      const td = document.createElement("td");
      td.className = cell.current ? "current" : "";
      td.innerHTML = `<span class="n"></span><span class="dots"></span>`;
      td.querySelector(".n").textContent = cell.done + (cell.manualDone ? `+${cell.manualDone}` : "");
      td.querySelector(".dots").textContent = "●".repeat(cell.inBag);
      td.title = `${formatT(t)}秒・${blank ? "空札あり" : "空札なし"}：有効 ${cell.done}（手動 ${cell.manualDone}）・袋に ${cell.inBag}`;
      tr.appendChild(td);
    });
    return tr;
  });
  table.replaceChildren(head, ...rows);
}

// ゲームの記録の一覧。中の欄を書き換えている最中は描き直さず、欄を離れたときに描き直す。
let historySig = "";
let historyPending = false;
const openHistory = new Set();
function renderHistory(force = false) {
  const sig = state.games.map((g) => `${g.id}:${g.status}:${g.outcome}:${g.cursor}:${g.reads.length}:${g.condition.key}`).join("|") + `|${state.currentId}|${Boolean(reading)}`;
  if (!force && sig === historySig) return;
  if ($("historyList").contains(document.activeElement) && document.activeElement.matches("input, textarea")) {
    historyPending = true;
    return;
  }
  historySig = sig;
  historyPending = false;
  const played = state.games.filter((g) => g.reads.length > 0);
  $("historyInfo").textContent = `${played.length}ゲームの記録（約 ${stateSizeKb(state)} KB）。項目を押すと、読んだ値、卓と名札、取り消しの操作を開きます。`;
  const items = [...state.games].reverse().map((g) => buildHistoryItem(g));
  $("historyList").replaceChildren(...items);
}

function timeOf(isoText) {
  if (!isoText) return "";
  const d = new Date(isoText);
  const p = (x) => String(x).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function buildHistoryItem(g) {
  const li = document.createElement("li");
  li.className = `hist-item outcome-${g.outcome || g.status}`;
  const det = document.createElement("details");
  det.open = openHistory.has(g.id);
  det.addEventListener("toggle", () => { if (det.open) openHistory.add(g.id); else openHistory.delete(g.id); });
  const sum = document.createElement("summary");
  const span = (cls, text) => { const s = document.createElement("span"); s.className = cls; s.textContent = text; return s; };
  sum.append(span("h-main", summarizeLabGame(g)), span("h-time", [timeOf(g.startedAtIso), timeOf(g.endedAtIso)].filter(Boolean).join("〜")));
  det.appendChild(sum);
  const body = document.createElement("div");
  body.className = "hist-body";
  const isCurrent = g.id === state.currentId;

  if (g.status !== "ready" && !(isCurrent && g.status === "playing")) {
    const p = document.createElement("p");
    p.className = "hist-reads";
    p.textContent = "読んだ値：" + (g.reads.map((r) => {
      const mark = r.status === "interrupted" ? `（中断：${INTERRUPT_LABELS[r.interruptReason] || r.interruptReason}）` : (r.reread ? "（読み直し）" : "");
      return `${r.value}${mark}`;
    }).join("、") || "なし");
    body.appendChild(p);
  } else if (g.status === "playing") {
    body.appendChild(span("help", "進行中のゲームの読んだ値は、「答えを確かめる」の長押しで確かめます。"));
  }
  if (g.retryOf) {
    const prev = findGame(state, g.retryOf);
    body.appendChild(span("help", `第${prev ? prev.gameNo : "?"}ゲームのやり直しの回です。`));
  }
  if (isCurrent) {
    body.appendChild(span("help hist-note", "いまのゲームの卓と名札、メモは、上の「卓と名札」の欄で書き換えます。"));
  } else {
    const box = document.createElement("div");
    box.className = "meta-tables";
    box.append(...buildTableEditor(g));
    const memo = document.createElement("label");
    memo.className = "meta-memo";
    memo.innerHTML = `<span>メモ</span><textarea rows="2" maxlength="2000"></textarea>`;
    const ta = memo.querySelector("textarea");
    ta.value = g.memo || "";
    ta.addEventListener("input", () => { updateGameMeta(state, g.id, { memo: ta.value }); persistSoon(); });
    body.append(box, memo);
    if (g.status === "ended" && (g.outcome === "completed" || g.outcome === "stopped")) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn-danger";
      b.textContent = "このゲームを取り消す（無効にして条件を袋に戻す）";
      setupArmed(b, "もう一度押すと、無効にします", () => {
        act(() => voidGame(state, g.id), `第${g.gameNo}ゲームを無効にしました。条件を袋に戻しました。`);
      }, ARM_MS);
      body.appendChild(b);
    }
  }
  det.appendChild(body);
  li.appendChild(det);
  return li;
}

// --------------------------
// 参加者に見せるルール
// --------------------------

function showRuleBoard() {
  const g = currentGame(state);
  if (!g) return;
  const c = g.condition;
  $("rbKicker").textContent = `第${g.gameNo}ゲーム・電子音の間隔 ${formatT(c.tSec)} 秒`;
  const items = c.blank
    ? [
      `1〜13 の札13枚を混ぜて、2人に ${c.dealPerPlayer} 枚ずつ配ります。`,
      "残った1枚は、誰にも見せずに伏せたまま脇に置きます。これが空札です。",
      "読み上げは、空札の値も読みます。",
    ]
    : [
      `1〜12 の札12枚を混ぜて、2人に ${c.dealPerPlayer} 枚ずつ配ります。`,
      "このゲームに空札はありません。読まれた値の札は、どちらかの陣に必ずあります。",
    ];
  $("ruleBoardTitle").textContent = c.blank ? "空札のルール" : "このゲームは空札なし";
  $("rbList").replaceChildren(...items.map((t) => { const li = document.createElement("li"); li.textContent = t; return li; }));
  $("rbEmph").textContent = c.blank ? state.config.blankRuleText : "";
  $("rbEmph").hidden = !c.blank;
  $("ruleBoard").hidden = false;
  $("btnRuleClose").focus();
}

function hideRuleBoard() {
  $("ruleBoard").hidden = true;
}

// --------------------------
// 手動の指定
// --------------------------

function openManual() {
  const g = currentGame(state);
  const levels = [...new Set([...state.config.tLevels, ...T_LEVELS])].sort((a, b) => a - b);
  const seg = $("manualTSeg");
  seg.replaceChildren(...[...levels.map(String), "custom"].map((v) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="radio" name="manualT"><span></span>`;
    label.querySelector("input").value = v;
    label.querySelector("span").textContent = v === "custom" ? "自由" : v;
    return label;
  }));
  const t = g && g.status !== "ended" ? g.condition.tSec : state.config.tLevels[0];
  const preset = levels.includes(t);
  seg.querySelector(`input[value="${preset ? String(t) : "custom"}"]`).checked = true;
  $("manualCustom").value = t;
  const blank = g ? g.condition.blank : false;
  document.querySelector(`input[name="manualBlank"][value="${blank ? 1 : 0}"]`).checked = true;
  updateManualCustom();
  show("manualPanel", true);
  $("manualPanel").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function updateManualCustom() {
  const v = document.querySelector('input[name="manualT"]:checked');
  $("manualCustomRow").hidden = !(v && v.value === "custom");
}

function applyManual() {
  const v = document.querySelector('input[name="manualT"]:checked');
  const tSec = v && v.value !== "custom" ? Number(v.value) : Number($("manualCustom").value);
  const blank = document.querySelector('input[name="manualBlank"]:checked')?.value === "1";
  const ok = act(() => setManualGame(state, { tSec, blank }), () => {
    const g = currentGame(state);
    return `第${g.gameNo}ゲームを、手で指定した条件（t=${formatT(g.condition.tSec)}秒・${g.condition.blank ? "空札あり" : "空札なし"}）で用意しました。`;
  });
  if (ok) show("manualPanel", false);
}

// --------------------------
// 答えの確認（長押し）
// --------------------------

let revealTimer = 0;
function showReveal() {
  const g = currentGame(state);
  if (reading || !g || g.reads.length === 0) return;
  const last = g.reads[g.reads.length - 1];
  $("revealTitle").textContent = `第${g.gameNo}ゲーム　${last.seq}回目の読み${last.reread ? "（読み直し）" : ""}${last.status === "interrupted" ? "（中断）" : ""}`;
  $("revealValue").textContent = last.value;
  const face = cardFace(last.value);
  $("revealFace").textContent = face ? `（${face}）` : "";
  $("revealHistory").replaceChildren(...g.reads.map((r) => {
    const li = document.createElement("li");
    li.textContent = `${r.value}${r.reread ? "再" : ""}${r.status === "interrupted" ? "止" : ""}`;
    return li;
  }));
  $("reveal").hidden = false;
  clearTimeout(revealTimer);
  revealTimer = setTimeout(hideReveal, REVEAL_SHOW_MS);
}
function hideReveal() {
  clearTimeout(revealTimer);
  $("reveal").hidden = true;
}

// --------------------------
// 設定
// --------------------------

function fillSettings() {
  const f = $("settingsForm");
  const c = state.config;
  f.tLevels.value = c.tLevels.map(formatT).join(", ");
  f.blankNo.checked = c.blankLevels.includes(false);
  f.blankYes.checked = c.blankLevels.includes(true);
  f.prepGapSec.value = c.prepGapSec;
  f.volume.value = c.volume;
  f.flash.checked = c.flash;
  f.flashOffsetMs.value = c.flashOffsetMs;
  f.tableCount.value = String(c.tableCount);
  f.label.value = c.label;
  f.blankRuleText.value = c.blankRuleText;
  updateLevelsHelp();
}

function readSettings() {
  const f = $("settingsForm");
  const blankLevels = [];
  if (f.blankNo.checked) blankLevels.push(false);
  if (f.blankYes.checked) blankLevels.push(true);
  return {
    tLevels: f.tLevels.value,
    blankLevels,
    prepGapSec: f.prepGapSec.value,
    volume: f.volume.value,
    flash: f.flash.checked,
    flashOffsetMs: f.flashOffsetMs.value,
    tableCount: f.tableCount.value,
    label: f.label.value.trim(),
    blankRuleText: f.blankRuleText.value,
  };
}

function updateLevelsHelp() {
  const probe = createLabState({ config: readSettings() });
  const n = conditionKeys(probe.config).length;
  $("levelsHelp").textContent = `t の水準 ${probe.config.tLevels.map(formatT).join("、")} 秒 × 空札 ${probe.config.blankLevels.map((b) => (b ? "あり" : "なし")).join("・")} で、1巡は ${n} 条件です。水準を変えて保存すると、袋を空にし、次に引くときに新しい巡を始めます。`;
}

function saveSettings() {
  const raw = readSettings();
  let changed = null;
  act(() => {
    changed = applyConfig(state, raw);
    // 卓の数を変えたら、いまのゲームの卓の欄もそろえる。
    const g = currentGame(state);
    if (g && g.status !== "ended") g.tables = normalizeTables(g.tables, state.config.tableCount);
  }, () => (changed && changed.levelsChanged
    ? "設定を保存しました。条件の水準を変えたので袋を空にしました。次に引くときに新しい巡を始めます。"
    : "設定を保存しました。"));
  setVolume(state.config.volume);
  renderMeta(currentGame(state), true);
}

// --------------------------
// 書き出しと読み込み
// --------------------------

function exportPayload() {
  return {
    app: "majikaruta-reader",
    page: "lab",
    schema: LAB_SCHEMA,
    appVersion: APP_VERSION,
    exportedAtIso: new Date().toISOString(),
    userAgent: navigator.userAgent,
    screen: { width: screen.width, height: screen.height, devicePixelRatio: window.devicePixelRatio },
    state,
  };
}

function exportJson(prefix = "majikaruta-lab") {
  download(`${prefix}-${stamp()}.json`, JSON.stringify(exportPayload(), null, 1), "application/json");
}

function fillDataInfo() {
  const where = { idb: "この端末の IndexedDB", local: "この端末の localStorage（容量が小さい）", none: "保存できない（書き出しだけが頼り）" }[storeMode()];
  const played = state.games.filter((g) => g.reads.length > 0).length;
  $("dataInfo").textContent = `保存先：${where}。記録 ${played} ゲーム、約 ${stateSizeKb(state)} KB。記録の名前：${state.id}（${timeOf(state.createdAtIso)} に作成）。`;
  $("fImport").value = "";
  $("importInfo").textContent = "";
  $("btnImport").disabled = true;
  pendingImport = null;
}

let pendingImport = null;
async function onImportFile() {
  const file = $("fImport").files[0];
  pendingImport = null;
  $("btnImport").disabled = true;
  if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    pendingImport = importState(obj);
    const played = pendingImport.games.filter((g) => g.reads.length > 0).length;
    const cur = pendingImport.games.find((g) => g.id === pendingImport.currentId);
    $("importInfo").textContent = `読み込める記録です：${played} ゲーム、第${pendingImport.round}巡、袋の残り ${pendingImport.bag.length}。${cur ? `画面には第${cur.gameNo}ゲーム（${cur.status === "ended" ? OUTCOME_LABELS[cur.outcome] : cur.status === "playing" ? "進行中" : "用意"}）を出します。` : ""}`;
    $("btnImport").disabled = false;
  } catch (e) {
    $("importInfo").textContent = `読み込めません：${e.message || e}`;
  }
}

function doImport() {
  if (!pendingImport || reading) return;
  if (state.games.length > 0) exportJson("majikaruta-lab-backup");
  state = pendingImport;
  pendingImport = null;
  const n = recoverState(state, { reason: "import" });
  persist();
  renderAll();
  closeDialog($("dlgData"));
  setStatus(`記録を読み込みました。続きから進めます。${n ? `読んでいる最中だった ${n} 回の読みを中断として記録しました。` : ""}`);
}

function clearAll() {
  if (reading) return;
  if (state.games.length > 0) exportJson("majikaruta-lab-backup");
  state = createLabState({ config: state.config });
  persist();
  renderAll();
  closeDialog($("dlgData"));
  setStatus("記録を全部消しました（消す前の記録は書き出しました）。設定は残しています。");
}

function renderAll() {
  historySig = "";
  metaKey = "";
  $("statusText").textContent = "";
  render();
}

// --------------------------
// 操作のつなぎ込み
// --------------------------

function wire() {
  wireDialogs();
  $("btnRead").addEventListener("click", () => onRead("next"));
  $("btnReread").addEventListener("click", () => onRead("reread"));
  $("btnStop").addEventListener("click", () => stopReading("stop"));
  $("btnFlashStop").addEventListener("click", () => stopReading("stop"));

  $("btnNext").addEventListener("click", () => {
    act(() => prepareNextGame(state), () => {
      const g = currentGame(state);
      return `第${g.gameNo}ゲームを用意しました。参加者に「${dealText(g.condition)}」と伝えてください。`;
    });
  });
  $("btnPostpone").addEventListener("click", () => {
    const before = currentGame(state)?.condition.key;
    act(() => postponeGame(state), () => {
      const g = currentGame(state);
      return `前の条件を袋に戻し、t=${formatT(g.condition.tSec)}秒・${g.condition.blank ? "空札あり" : "空札なし"}を引きました。${g.condition.key === before ? "（袋にほかの条件が無かったので、同じ条件です）" : ""}`;
    });
  });
  $("btnManual").addEventListener("click", openManual);
  $("btnManual2").addEventListener("click", openManual);
  $("btnManualCancel").addEventListener("click", () => show("manualPanel", false));
  $("btnManualApply").addEventListener("click", applyManual);
  $("manualTSeg").addEventListener("change", updateManualCustom);
  $("btnShowRule").addEventListener("click", showRuleBoard);
  $("btnRuleClose").addEventListener("click", hideRuleBoard);
  $("ruleBoard").addEventListener("click", (e) => { if (e.target === $("ruleBoard")) hideRuleBoard(); });

  $("btnEnd").addEventListener("click", () => { show("endChoices", $("endChoices").hidden); });
  $("btnEndCancel").addEventListener("click", () => show("endChoices", false));
  $("btnEndCompleted").addEventListener("click", () => act(() => endGame(state, "completed"), "完了として終えました。"));
  $("btnEndStopped").addEventListener("click", () => act(() => endGame(state, "stopped"), "途中終了として終えました。"));
  setupArmed($("btnEndVoid"), "もう一度押すと、無効にします", () => {
    act(() => endGame(state, "void"), "無効として終えました。条件を袋に戻しました。");
  }, ARM_MS);
  $("btnReopen").addEventListener("click", () => act(() => reopenGame(state), "終えたのを取り消しました。このゲームを続けます。"));

  setupArmed($("btnRedo"), "もう一度押すと、やり直します", () => {
    act(() => redoGame(state), () => {
      const g = currentGame(state);
      return `前の回に「やり直し」の印を付け、同じ条件で第${g.gameNo}ゲームを用意しました。`;
    });
  }, ARM_MS);
  setupArmed($("btnVoid"), "もう一度押すと、取り消します", () => {
    const g = currentGame(state);
    if (!g) return;
    act(() => (g.status === "playing" ? endGame(state, "void") : voidGame(state, g.id)),
      `第${g.gameNo}ゲームを無効にしました。条件を袋に戻しました。`);
  }, ARM_MS);

  setupHold($("btnReveal"), REVEAL_HOLD_MS, showReveal, () => {
    if ($("reveal").hidden) setStatus("答えは、ボタンを長押しすると表示します。");
  });
  $("reveal").addEventListener("pointerdown", hideReveal);

  $("btnSettings").addEventListener("click", () => { if (reading) return; fillSettings(); openDialog($("dlgSettings")); });
  $("settingsForm").addEventListener("input", updateLevelsHelp);
  $("settingsForm").addEventListener("submit", (e) => { e.preventDefault(); saveSettings(); closeDialog($("dlgSettings")); });
  $("btnSoundCheck").addEventListener("click", async () => {
    await unlockAudio();
    setVolume(Number($("settingsForm").volume.value));
    playSoundCheck(1);
  });
  setupArmed($("btnResetBag"), "もう一度押すと、袋を作り直します", () => {
    act(() => resetBag(state), "袋を空にしました。次に引くときに、全部の条件で次の巡を始めます。");
  }, ARM_MS);

  $("btnData").addEventListener("click", () => { if (reading) return; fillDataInfo(); openDialog($("dlgData")); });
  $("btnExportJson").addEventListener("click", () => exportJson());
  $("btnExportCsv").addEventListener("click", () => download(`majikaruta-lab-tones-${stamp()}.csv`, "﻿" + labToCsv(state), "text/csv"));
  $("btnExportGames").addEventListener("click", () => download(`majikaruta-lab-games-${stamp()}.csv`, "﻿" + labGamesCsv(state), "text/csv"));
  $("fImport").addEventListener("change", onImportFile);
  setupArmed($("btnImport"), "もう一度押すと、いまの記録と置き換えます", doImport, ARM_MS);
  setupArmed($("btnClearAll"), "もう一度押すと、全部消します", clearAll, ARM_MS);

  $("historyList").addEventListener("focusout", () => {
    setTimeout(() => { if (historyPending) renderHistory(true); }, 0);
  });

  document.addEventListener("keydown", (e) => {
    if ($("app").hidden || e.repeat) return;
    if (e.code === "Escape") {
      if (reading) { e.preventDefault(); stopReading("stop"); return; }
      if (!$("ruleBoard").hidden) { hideRuleBoard(); return; }
      if (!$("reveal").hidden) { hideReveal(); return; }
      return;
    }
    if (anyDialogOpen() || !$("ruleBoard").hidden || !$("reveal").hidden) return;
    if (e.target instanceof HTMLElement && e.target.closest("input, select, textarea, summary")) return;
    if (e.code === "Space" || e.code === "Enter") {
      if (e.target instanceof HTMLButtonElement && e.target.id !== "btnRead") return;
      e.preventDefault();
      onRead("next");
    }
  });
  // 電話の着信などで止まった音を、次のタップで起こす。
  document.addEventListener("pointerdown", () => { if (audioState() !== "running" && audioState() !== "none") unlockAudio(); });
  // ページを離れるとき（タブを閉じる、再読み込み）は、読んでいる最中の読みを中断にして保存する。
  // 保存が間に合わなくても、開き直したときに recoverState が中断にする。
  window.addEventListener("pagehide", () => {
    if (reading) stopReading("pagehide");
    else if (state) persist();
  });
}

// 同じ端末の別のタブで、このページが開かれていないかを確かめる（2つのタブが同じ保存先を上書きし合うのを防ぐ）。
function watchOtherTabs() {
  if (!("BroadcastChannel" in window)) return;
  const bc = new BroadcastChannel("majikaruta-lab");
  const warn = () => showNotice("別のタブでも、この実験用のページが開いています。記録が上書きされるおそれがあるので、どちらか一方を閉じてください。");
  bc.onmessage = (e) => {
    if (e.data === "hello") { bc.postMessage("here"); warn(); }
    else if (e.data === "here") warn();
  };
  bc.postMessage("hello");
}

// --------------------------
// 起動
// --------------------------

async function boot() {
  $("version").textContent = `v${APP_VERSION}`;
  if (!isApple() && !isTouch()) $("noteSilent").hidden = true;
  wire();
  watchOtherTabs();
  registerOffline();
  const wake = keepScreenOn(() => !$("app").hidden);

  const mode = await openLabStore();
  let loaded = null;
  let loadProblem = null;
  try {
    loaded = await loadLabState();
  } catch (e) {
    loadProblem = e;
  }
  let recovered = 0;
  if (loaded) {
    try {
      state = importState(loaded);
      recovered = recoverState(state, { reason: "reload" });
    } catch (e) {
      loadProblem = e;
      state = null;
    }
  }
  if (!state) {
    if (loaded) {
      // 保存されていた記録が読めないときは、上書きする前に、そのままの形で書き出しておく。
      download(`majikaruta-lab-unreadable-${stamp()}.json`, JSON.stringify(loaded), "application/json");
    }
    state = createLabState({});
  }
  persist();

  const info = $("resumeInfo");
  const played = state.games.filter((g) => g.reads.length > 0);
  const notes = [];
  if (played.length > 0) {
    const cur = currentGame(state);
    notes.push(`保存されていた記録があります（${played.length} ゲーム、第${state.round}巡、袋の残り ${state.bag.length}）。続きから始めます。`);
    if (cur) notes.push(`画面には第${cur.gameNo}ゲーム（${cur.status === "ended" ? OUTCOME_LABELS[cur.outcome] : cur.status === "playing" ? "進行中" : "用意"}）を出します。`);
  }
  if (recovered > 0) notes.push(`読んでいる最中に閉じられた ${recovered} 回の読みを「中断」として記録しました。「読む」で同じ札を読み直せます。`);
  if (loadProblem) notes.push(`保存されていた記録を読めませんでした（${loadProblem.message || loadProblem}）。読めなかった記録は書き出しました。`);
  info.textContent = notes.join("");
  info.hidden = notes.length === 0;
  if (mode === "local") showNotice("この端末では IndexedDB が使えないため、localStorage に保存しています。容量が小さいので、こまめに JSON を書き出してください。");
  if (mode === "none") showNotice("この端末では保存ができません。ゲームごとに JSON を書き出してください。");

  const start = $("btnStart");
  start.disabled = false;
  start.textContent = played.length > 0 ? "音を出して続きから" : "音を出してはじめる";
  start.addEventListener("click", async () => {
    await unlockAudio();
    wake();
    $("splash").hidden = true;
    $("app").hidden = false;
    if (recovered > 0) setStatus("中断した読みがあります。「読む」で同じ札を読み直します。");
    renderAll();
    if (recovered > 0) setStatus("中断した読みがあります。「読む」で同じ札を読み直します。");
  });
  renderAll();
}

boot();

// 検査と調査のために、状態を外から読めるようにする（値の表示には使わない）。
window.__majikarutaLab = { get state() { return state; }, get reading() { return reading; }, roundT };
