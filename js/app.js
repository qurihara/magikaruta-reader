// ==========================
// app.js
// ==========================
// 画面の操作とゲームの進行。音は audio.js、点滅は flash.js、保存は storage.js、計算は core.js が受け持つ。
// 読んでいる最中と読む前には、札の値を画面に出さない。値を出すのは、運営者が「答えを確かめる」を長押ししたときだけである。
// ==========================

import {
  APP_VERSION, T_LEVELS, KIND_DEFS, MAX_VALUE_MIN, MAX_VALUE_MAX,
  AFTER_READ_SEC, REVEAL_HOLD_MS, REVEAL_SHOW_MS,
} from "./config.js";
import {
  normalizeSettings, buildReadingOrder, drawTFromBag, createGame, flashSpecFor, ctxToPerf, ctxToEpoch,
  formatT, kindLabel, cardFace, gamesToCsv, summarizeGame, roundT, shuffle,
} from "./core.js";
import { unlockAudio, audioState, setVolume, scheduleRead, stopAll, playSoundCheck } from "./audio.js";
import { initFlash, runFlash, stopFlash } from "./flash.js";
import * as store from "./storage.js";

const $ = (id) => document.getElementById(id);

// --------------------------
// 状態
// --------------------------

let settings = normalizeSettings(store.loadSettings());
let games = store.loadGames();
let game = null;
let reading = false;
let readEndTimer = 0;
let wakeLock = null;

const isTouch = matchMedia("(pointer: coarse)").matches;
const isApple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && "ontouchend" in document;

// --------------------------
// ゲーム
// --------------------------

function persist() {
  const ok = store.saveGames(games);
  store.saveCurrentId(game ? game.id : null);
  if (!ok) {
    showNotice("記録を保存できませんでした。設定の「運営者」から書き出し、記録を消してから続けてください。");
  }
}

// 次のゲームの t を決める。無作為のときは袋から取り出す。
function chooseT() {
  if (settings.tMode !== "random") return settings.tSec;
  const r = drawTFromBag(store.loadTBag());
  store.saveTBag(r.bag);
  return r.t;
}

function startNewGame() {
  // 1枚も読んでいないゲームは記録から外し、同じ番号を使い直す。
  let gameNo;
  if (game && game.reads.length === 0) {
    games = games.filter((g) => g.id !== game.id);
    gameNo = game.gameNo;
    if (game.settings.tMode === "random") {
      // 使わなかった t は袋に戻してかき混ぜ直し、5水準の回数の釣り合いを保つ。
      store.saveTBag(shuffle([...store.loadTBag(), game.settings.tSec]));
    }
  } else {
    gameNo = store.loadNextGameNo();
    store.saveNextGameNo(gameNo + 1);
  }
  const tSec = chooseT();
  game = createGame({ gameNo, settings, tSec, order: buildReadingOrder(settings) });
  games.push(game);
  persist();
  render();
}

function ensureGame() {
  const id = store.loadCurrentId();
  game = games.find((g) => g.id === id) || null;
  if (!game) startNewGame();
}

// 「読む」を押したとき。
let pressing = false;
async function onRead() {
  // キーとクリックが続けて届いても、1回の読みしか予約しない。
  if (reading || pressing) return;
  pressing = true;
  try {
    await readOnce();
  } finally {
    pressing = false;
  }
}

async function readOnce() {
  const pressedPerfMs = performance.now();
  const pressedEpochMs = Date.now();
  await unlockAudio();
  if (audioState() !== "running") {
    setStatus("音を出せませんでした。もう一度押してください。");
    return;
  }
  if (!game || game.completed) {
    startNewGame();
    return;
  }
  const card = game.order[game.reads.length];
  const st = game.settings;
  setVolume(settings.volume);
  const sched = scheduleRead({ count: card.value, kind: card.kind, tSec: st.tSec, prepGapSec: st.prepGapSec });

  // 点滅は、音が実際にスピーカから出る時刻に合わせる。AudioContext が報告する遅れと、手で入れた補正を足す。
  const latencyMs = ((sched.outputLatencySec || 0) + (sched.baseLatencySec || 0)) * 1000;
  const flashCompMs = latencyMs + settings.flashOffsetMs;

  const read = {
    index: game.reads.length + 1,
    value: card.value,
    kind: card.kind,
    pressedPerfMs: round3(pressedPerfMs),
    pressedEpochMs,
    base: { ctxNow: sched.base.ctxNow, perfNow: round3(sched.base.perfNow), epochNow: sched.base.epochNow },
    outputLatencySec: sched.outputLatencySec,
    baseLatencySec: sched.baseLatencySec,
    sampleRate: sched.sampleRate,
    flash: settings.flash,
    flashCompMs: round3(flashCompMs),
    events: sched.events.map((e) => {
      const perf = ctxToPerf(e.at, sched.base);
      return {
        index: e.index,
        role: e.role,
        ctx: Math.round(e.at * 1e6) / 1e6,
        perf: round3(perf),
        epoch: round3(ctxToEpoch(e.at, sched.base)),
        durationSec: e.durationSec,
        flashPerf: settings.flash ? round3(perf + flashCompMs) : null,
        flashShownPerf: null,
      };
    }),
  };
  game.reads.push(read);
  if (game.reads.length >= game.order.length) {
    game.completed = true;
    game.endedAtIso = new Date().toISOString();
  }
  persist();

  reading = true;
  render();

  if (settings.flash) {
    runFlash(read.events.map((e) => {
      const spec = flashSpecFor(e, { kind: card.kind, kinds: st.kinds, tSec: st.tSec, flashKindColor: settings.flashKindColor });
      return {
        startPerf: e.flashPerf,
        endPerf: e.flashPerf + spec.durationSec * 1000,
        color: spec.color,
        onShown: (frameTime) => { e.flashShownPerf = round3(frameTime); },
      };
    }));
  }

  // 画面の状態を戻す時刻だけを setTimeout で決める（音の時刻には使わない）。
  const lastEvent = read.events[read.events.length - 1];
  const endPerf = lastEvent.perf + lastEvent.durationSec * 1000 + Math.max(0, flashCompMs) + AFTER_READ_SEC * 1000;
  clearTimeout(readEndTimer);
  readEndTimer = setTimeout(finishRead, Math.max(0, endPerf - performance.now()));
}

function finishRead() {
  stopFlash();
  reading = false;
  persist(); // 点滅が実際に出たコマの時刻を書き足して保存する
  render();
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

// --------------------------
// 表示
// --------------------------

function ruleText(st) {
  const parts = [`1〜${st.maxValue}`];
  if (st.kinds > 1) parts.push(`${st.kinds}種類`);
  parts.push(st.blankRule ? "空札あり" : "空札なし");
  if (st.tMode === "random") parts.push("t は無作為");
  return parts.join("・");
}

function setStatus(text) {
  $("statusText").textContent = text;
}

function showNotice(text) {
  const n = $("mainNotice");
  n.textContent = text;
  n.hidden = !text;
}

function render() {
  if (!game) return;
  const st = game.settings;
  const n = game.reads.length;
  const total = game.order.length;
  $("infoGameNo").textContent = game.gameNo;
  $("infoT").textContent = formatT(st.tSec);
  $("ruleLine").textContent = ruleText(st);
  $("readCount").textContent = n;
  $("totalCount").textContent = total;

  // 読んだ札の数だけ、札の裏（常磐色）を並べる。値は出さない。
  const slots = $("slots");
  if (slots.childElementCount !== total) {
    slots.replaceChildren(...Array.from({ length: total }, () => document.createElement("i")));
  }
  slots.classList.toggle("dense", total > 26);
  Array.from(slots.children).forEach((el, i) => {
    el.className = i < n - (reading ? 1 : 0) ? "done" : (reading && i === n - 1 ? "now" : "");
  });

  const btn = $("btnRead");
  btn.disabled = reading;
  btn.classList.toggle("is-reading", reading);
  btn.classList.toggle("is-done", game.completed && !reading);
  if (reading) {
    $("readLabel").textContent = "読んでいます";
    $("readSub").textContent = "音を聞いてください";
    setStatus(`${n}枚目を読んでいます。`);
  } else if (game.completed) {
    $("readLabel").textContent = "新しいゲーム";
    $("readSub").textContent = `第${game.gameNo}ゲームの${total}枚を読み終えました`;
    setStatus("全部の札を読み終えました。押すと次のゲームを始めます。");
  } else {
    $("readLabel").textContent = "読む";
    $("readSub").textContent = `${n + 1}枚目`;
    setStatus(n === 0
      ? "「読む」を押すと、準備音のあとに電子音が鳴ります。"
      : "札を取り終えたら、次を読みます。");
  }
  $("btnReveal").disabled = reading || n === 0;
  $("btnNewGame").disabled = reading;
  document.documentElement.classList.toggle("big-info", settings.bigInfo);
}

// --------------------------
// 答えの確認（長押し）
// --------------------------

let holdTimer = 0;
let revealTimer = 0;

function setupReveal() {
  const b = $("btnReveal");
  const start = (ev) => {
    if (b.disabled) return;
    ev.preventDefault();
    b.classList.add("holding");
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { b.classList.remove("holding"); showReveal(); }, REVEAL_HOLD_MS);
  };
  const cancel = () => { clearTimeout(holdTimer); b.classList.remove("holding"); };
  b.style.setProperty("--hold-ms", `${REVEAL_HOLD_MS}ms`);
  b.addEventListener("pointerdown", start);
  b.addEventListener("pointerup", cancel);
  b.addEventListener("pointerleave", cancel);
  b.addEventListener("pointercancel", cancel);
  b.addEventListener("contextmenu", (e) => e.preventDefault());
  // 短く押しただけのときは、長押しが要ることを知らせる。
  b.addEventListener("click", () => { if (!$("reveal").hidden) return; setStatus("答えは、ボタンを長押しすると表示します（運営者用）。"); });
  $("reveal").addEventListener("pointerdown", hideReveal);
}

function showReveal() {
  if (reading || !game || game.reads.length === 0) return;
  const st = game.settings;
  const last = game.reads[game.reads.length - 1];
  $("revealTitle").textContent = `第${game.gameNo}ゲーム　${last.index}枚目の読み`;
  $("revealValue").textContent = last.value;
  const face = cardFace(last.value);
  $("revealFace").textContent = face ? `（${face}）` : "";
  const kl = kindLabel(last.kind, st.kinds);
  const kindEl = $("revealKind");
  kindEl.textContent = kl;
  kindEl.hidden = !kl;
  kindEl.style.setProperty("--kind", KIND_DEFS[last.kind].color);
  $("revealHistory").replaceChildren(...game.reads.map((r) => {
    const li = document.createElement("li");
    // 種類が2つなら「赤」「黒」、3つ以上ならトランプの印を値に添える。
    const mark = st.kinds === 2 ? KIND_DEFS[r.kind].name : (st.kinds > 2 ? KIND_DEFS[r.kind].suit : "");
    li.textContent = `${r.value}${mark}`;
    if (st.kinds > 1) li.style.setProperty("--kind", KIND_DEFS[r.kind].color);
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

function fillSettingsForm() {
  const f = $("settingsForm");
  const sel = $("fMaxValue");
  if (!sel.options.length) {
    for (let v = MAX_VALUE_MIN; v <= MAX_VALUE_MAX; v++) {
      const face = cardFace(v);
      sel.add(new Option(face ? `${v}（${face}）` : String(v), String(v)));
    }
  }
  sel.value = String(settings.maxValue);
  f.kinds.value = String(settings.kinds);
  f.blankRule.checked = settings.blankRule;
  const preset = T_LEVELS.find((x) => x === settings.tSec);
  f.tChoice.value = settings.tMode === "random" ? "random" : (preset !== undefined ? String(preset) : "custom");
  f.tCustom.value = settings.tSec;
  f.prepGapSec.value = settings.prepGapSec;
  f.volume.value = settings.volume;
  f.flash.checked = settings.flash;
  f.flashKindColor.checked = settings.flashKindColor;
  f.flashOffsetMs.value = settings.flashOffsetMs;
  f.bigInfo.checked = settings.bigInfo;
  f.label.value = settings.label;
  f.nextGameNo.value = store.loadNextGameNo();
  updateFormHelp();
  renderLogInfo();
}

function readSettingsForm() {
  const f = $("settingsForm");
  const choice = f.tChoice.value;
  let tMode = "fixed";
  let tSec = settings.tSec;
  if (choice === "random") tMode = "random";
  else if (choice === "custom") tSec = Number(f.tCustom.value);
  else tSec = Number(choice);
  return normalizeSettings({
    maxValue: f.maxValue.value,
    kinds: f.kinds.value,
    blankRule: f.blankRule.checked,
    tMode, tSec,
    prepGapSec: f.prepGapSec.value,
    volume: f.volume.value,
    flash: f.flash.checked,
    flashKindColor: f.flashKindColor.checked,
    flashOffsetMs: f.flashOffsetMs.value,
    bigInfo: f.bigInfo.checked,
    label: f.label.value.trim(),
  });
}

function updateFormHelp() {
  const f = $("settingsForm");
  const s = readSettingsForm();
  const total = s.maxValue * s.kinds;
  let text = `1ゲームで ${total} 枚を読みます（値 1〜${s.maxValue}${s.kinds > 1 ? ` × ${s.kinds}種類` : ""}）。`;
  if (s.blankRule) {
    const per = Math.floor(total / 2) - (total % 2 === 0 ? 1 : 0);
    text += ` 2人なら ${per} 枚ずつ配ると、空札は ${total - per * 2} 枚です。`;
  }
  $("deckHelp").textContent = text;
  $("customTRow").hidden = f.tChoice.value !== "custom";
  f.flashKindColor.disabled = !f.flash.checked;
  renderKindLegend($("soundCheckLegend"), s.kinds);
}

const RULE_KEYS = ["maxValue", "kinds", "blankRule", "tMode", "tSec", "prepGapSec"];

function saveSettingsFromForm() {
  const next = readSettingsForm();
  const ruleChanged = RULE_KEYS.some((k) => next[k] !== settings[k]);
  settings = next;
  store.saveSettings(settings);
  const nextNo = Math.max(1, Math.round(Number($("settingsForm").nextGameNo.value) || 1));
  const noChanged = nextNo !== store.loadNextGameNo();
  if (noChanged) store.saveNextGameNo(nextNo);
  setVolume(settings.volume);
  if (game && game.reads.length === 0 && (ruleChanged || noChanged)) {
    // まだ1枚も読んでいなければ、新しい設定でゲームを作り直す。番号を変えたときは、その番号から始める。
    if (noChanged) {
      games = games.filter((g) => g.id !== game.id);
      game = null;
    }
    startNewGame();
    setStatus("設定を保存しました。");
  } else if (ruleChanged && game && !game.completed) {
    render();
    setStatus("設定を保存しました。ルールと t の変更は、次のゲームから反映します。");
  } else {
    render();
    setStatus("設定を保存しました。");
  }
}

function renderKindLegend(ul, kinds) {
  ul.replaceChildren(...Array.from({ length: Math.max(1, kinds) }, (_, k) => {
    const li = document.createElement("li");
    const def = KIND_DEFS[k];
    li.style.setProperty("--kind", kinds > 1 ? def.color : "var(--shu)");
    const name = kinds > 1 ? kindLabel(k, kinds) : "最後の音";
    const pitch = def.lastHz > 1000 ? "高い" : "低い";
    const tone = def.wave === "sine" ? "澄んだ音" : "ざらついた音";
    li.innerHTML = `<span class="sw"></span><b></b><span class="d"></span>`;
    li.querySelector("b").textContent = name;
    li.querySelector(".d").textContent = kinds > 1 ? `${pitch}${tone}（${def.lastHz} Hz）` : `高い澄んだ音（${def.lastHz} Hz）`;
    return li;
  }));
}

function renderLogInfo() {
  const st = store.storageStatus();
  const count = games.filter((g) => g.reads.length > 0).length;
  $("logInfo").textContent = st.available
    ? `この端末に ${count} ゲームの記録があります（約 ${store.gamesSizeKb()} KB）。記録はこの端末のブラウザにだけ残ります。`
    : "この端末では記録を保存できません（プライベートブラウズなど）。";
  const items = games.filter((g) => g.reads.length > 0).slice(-8).reverse();
  $("logList").replaceChildren(...items.map((g) => {
    const li = document.createElement("li");
    li.textContent = summarizeGame(g);
    return li;
  }));
}

// --------------------------
// 書き出し
// --------------------------

function stamp() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportJson() {
  const data = {
    app: "majikaruta-reader",
    appVersion: APP_VERSION,
    exportedAtIso: new Date().toISOString(),
    userAgent: navigator.userAgent,
    screen: { width: screen.width, height: screen.height, devicePixelRatio: window.devicePixelRatio },
    games: games.filter((g) => g.reads.length > 0),
  };
  download(`majikaruta-log-${stamp()}.json`, JSON.stringify(data, null, 2), "application/json");
}

function exportCsv() {
  // 表計算ソフトで文字化けしないように、先頭に BOM を付ける。
  download(`majikaruta-log-${stamp()}.csv`, "﻿" + gamesToCsv(games.filter((g) => g.reads.length > 0)), "text/csv");
}

let clearArmed = 0;
function onClearLog() {
  const b = $("btnClearLog");
  if (!clearArmed) {
    b.textContent = "もう一度押すと全部消えます";
    b.classList.add("armed");
    clearArmed = setTimeout(() => { clearArmed = 0; b.textContent = "記録を消す"; b.classList.remove("armed"); }, 4000);
    return;
  }
  clearTimeout(clearArmed);
  clearArmed = 0;
  b.textContent = "記録を消す";
  b.classList.remove("armed");
  store.clearGames();
  games = [];
  game = null;
  startNewGame();
  renderLogInfo();
}

// --------------------------
// 画面の消灯を止める
// --------------------------

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }
  } catch (_) { /* 使えない端末では黙って諦める */ }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !wakeLock && !$("app").hidden) requestWakeLock();
});

// --------------------------
// ダイアログ
// --------------------------

function openDialog(d) {
  if (typeof d.showModal === "function") d.showModal();
  else d.setAttribute("open", "");
}
function closeDialog(d) {
  if (typeof d.close === "function") d.close();
  else d.removeAttribute("open");
}

function setupDialogs() {
  document.querySelectorAll("dialog").forEach((d) => {
    d.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeDialog(d)));
    // 幕の外を押したら閉じる。
    d.addEventListener("click", (e) => { if (e.target === d) closeDialog(d); });
  });

  // 遊び方のタブ
  const tabs = document.querySelectorAll("#dlgRules .tab");
  tabs.forEach((t) => t.addEventListener("click", () => {
    tabs.forEach((x) => x.setAttribute("aria-selected", String(x === t)));
    document.querySelectorAll("#dlgRules .tabpanel").forEach((p) => { p.hidden = p.id !== t.dataset.tab; });
  }));

  $("btnRules").addEventListener("click", () => {
    renderKindLegend($("kindLegend"), Math.max(2, settings.kinds));
    openDialog($("dlgRules"));
  });
  $("btnSettings").addEventListener("click", () => { fillSettingsForm(); openDialog($("dlgSettings")); });
  $("settingsForm").addEventListener("input", updateFormHelp);
  $("settingsForm").addEventListener("change", updateFormHelp);
  $("settingsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    saveSettingsFromForm();
    closeDialog($("dlgSettings"));
  });
  $("btnSoundCheck").addEventListener("click", async () => {
    await unlockAudio();
    setVolume(Number($("settingsForm").volume.value));
    const kinds = readSettingsForm().kinds;
    const marks = playSoundCheck(kinds);
    const items = $("soundCheckLegend").children;
    marks.forEach((m, k) => {
      setTimeout(() => {
        items[k]?.classList.add("ping");
        setTimeout(() => items[k]?.classList.remove("ping"), 600);
      }, Math.max(0, m - performance.now()));
    });
  });
  $("btnExportJson").addEventListener("click", exportJson);
  $("btnExportCsv").addEventListener("click", exportCsv);
  $("btnClearLog").addEventListener("click", onClearLog);

  $("btnNewGame").addEventListener("click", () => {
    if (game && game.reads.length > 0 && !game.completed) {
      $("confirmText").textContent = `第${game.gameNo}ゲームは ${game.order.length} 枚のうち ${game.reads.length} 枚を読んだところです。打ち切って新しいゲームを始めると、いまのゲームは途中までの記録として残ります。`;
      openDialog($("dlgConfirm"));
    } else {
      startNewGame();
      setStatus(`第${game.gameNo}ゲームを用意しました。`);
    }
  });
  $("btnConfirmNew").addEventListener("click", () => {
    closeDialog($("dlgConfirm"));
    if (game) { game.endedAtIso = new Date().toISOString(); game.aborted = true; }
    startNewGame();
    setStatus(`第${game.gameNo}ゲームを用意しました。`);
  });
}

// --------------------------
// 起動
// --------------------------

function anyDialogOpen() {
  return Array.from(document.querySelectorAll("dialog")).some((d) => d.open) || !$("reveal").hidden;
}

function boot() {
  $("version").textContent = `v${APP_VERSION}`;
  initFlash($("flash"));
  if (!isApple && !isTouch) $("noteSilent").hidden = true;
  ensureGame();
  setupDialogs();
  setupReveal();

  $("btnStart").addEventListener("click", async () => {
    await unlockAudio();
    requestWakeLock();
    $("splash").hidden = true;
    $("app").hidden = false;
    if (isApple) showNotice("音が出ないときは、消音スイッチを切り、音量ボタンで音量を上げてください。");
    render();
  });
  $("btnRead").addEventListener("click", onRead);
  document.addEventListener("keydown", (e) => {
    if ($("app").hidden || anyDialogOpen() || e.repeat) return;
    if (e.target instanceof HTMLElement && e.target.closest("input, select, textarea")) return;
    if (e.code === "Space" || e.code === "Enter") {
      if (e.target instanceof HTMLButtonElement && e.target.id !== "btnRead") return;
      e.preventDefault();
      onRead();
    }
  });
  // 電話の着信などで止まった音を、次のタップで起こす。
  document.addEventListener("pointerdown", () => { if (audioState() !== "running" && audioState() !== "none") unlockAudio(); });
  window.addEventListener("pagehide", () => { stopAll(); stopFlash(); persist(); });
  render();
}

boot();

// 検査と調査のために、記録を外から読めるようにする（値の表示には使わない）。
window.__majikaruta = { get games() { return games; }, get game() { return game; }, roundT };
