// ==========================
// app.js
// ==========================
// 公開版（index.html）の画面の操作とゲームの進行。使う人の体験を重視して簡素にしてある。
// 研究用の機能（カメラ用の全画面の点滅、点滅の遅れの補正、記録の保存と書き出し、条件の管理）は、実験用のページ（lab.html、lab-app.js）にだけある。
// 音は audio.js、点滅は flash.js、計算は core.js、設定の保存は storage.js が受け持つ。
// 読んでいる最中と読む前には、札の値を画面に出さない。値を出すのは「答えを確かめる」を長押ししたときだけである。
// ==========================

import {
  APP_VERSION, T_LEVELS, RULES, PREP_GAP_SEC, AFTER_READ_SEC, REVEAL_HOLD_MS, REVEAL_SHOW_MS, KIND_DEFS,
} from "./config.js";
import {
  normalizePublicSettings, ruleOf, buildReadingOrder, glowSpecFor, ctxToPerf, formatT, speedWord, kindLabel, cardFace,
} from "./core.js";
import { unlockAudio, audioState, setVolume, scheduleRead, stopAll, playSoundCheck } from "./audio.js";
import { createFlasher } from "./flash.js";
import * as store from "./storage.js";
import {
  $, openDialog, closeDialog, wireDialogs, anyDialogOpen, setupHold, keepScreenOn, registerOffline, isTouch, isApple,
} from "./ui.js";

// --------------------------
// 状態（ゲームは保存しない。設定だけを保存する）
// --------------------------

let settings = normalizePublicSettings(store.loadSettings());
store.saveSettings(settings);
store.removeLegacyKeys();

let game = null;      // { rule, order, reads: [{ value, kind }] }
let reading = false;
let readEndTimer = 0;
const VOLUME = 0.7;

// 「読む」の札をほのかに光らせる。光らせる色は CSS の側で、data-glow の印から決める。
const glow = createFlasher({
  apply: (token) => {
    const card = $("btnRead");
    if (token) card.dataset.glow = token;
    else delete card.dataset.glow;
  },
});

// --------------------------
// ゲーム
// --------------------------

function newGame() {
  const rule = ruleOf(settings.rule);
  game = { rule: rule.key, order: buildReadingOrder(rule), reads: [] };
  render();
}

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
  await unlockAudio();
  if (audioState() !== "running") {
    setStatus("音を出せませんでした。もう一度押してください。");
    return;
  }
  if (!game || game.reads.length >= game.order.length) {
    newGame();
    setStatus("新しいゲームを用意しました。");
    return;
  }
  const rule = ruleOf(game.rule);
  const card = game.order[game.reads.length];
  setVolume(VOLUME);
  const sched = scheduleRead({ count: card.value, kind: card.kind, tSec: settings.tSec, prepGapSec: PREP_GAP_SEC });
  game.reads.push({ value: card.value, kind: card.kind });
  reading = true;
  render();

  // 光らせる時刻は、音が実際にスピーカから出る時刻（AudioContext が報告する遅れを足した時刻）に合わせる。
  const latencyMs = ((sched.outputLatencySec || 0) + (sched.baseLatencySec || 0)) * 1000;
  const timeline = sched.events.map((e) => {
    const start = ctxToPerf(e.at, sched.base) + latencyMs;
    const spec = glowSpecFor(e, { kind: card.kind, kinds: rule.kinds, tSec: settings.tSec });
    return { startPerf: start, endPerf: start + spec.durationSec * 1000, color: spec.token };
  });
  glow.run(timeline);

  // 画面の状態を戻す時刻だけを setTimeout で決める（音の時刻には使わない）。
  const last = timeline[timeline.length - 1];
  clearTimeout(readEndTimer);
  readEndTimer = setTimeout(finishRead, Math.max(0, last.endPerf + AFTER_READ_SEC * 1000 - performance.now()));
}

function finishRead() {
  glow.stop();
  reading = false;
  render();
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

function render() {
  if (!game) return;
  const rule = ruleOf(game.rule);
  const n = game.reads.length;
  const total = game.order.length;
  $("infoRule").textContent = rule.name;
  $("infoRuleNote").textContent = rule.summary;
  $("infoSpeed").textContent = speedWord(settings.tSec);
  $("infoT").textContent = formatT(settings.tSec);
  $("readCount").textContent = n;
  $("totalCount").textContent = total;

  // 読んだ札の数だけ、札の裏（常磐色）を並べる。値は出さない。
  const slots = $("slots");
  if (slots.childElementCount !== total) {
    slots.replaceChildren(...Array.from({ length: total }, () => document.createElement("i")));
  }
  Array.from(slots.children).forEach((el, i) => {
    el.className = i < n - (reading ? 1 : 0) ? "done" : (reading && i === n - 1 ? "now" : "");
  });

  const done = n >= total;
  const btn = $("btnRead");
  btn.disabled = reading;
  btn.classList.toggle("is-reading", reading);
  btn.classList.toggle("is-done", done && !reading);
  if (reading) {
    $("readLabel").textContent = "読んでいます";
    $("readSub").textContent = "音を聞いてください";
    setStatus(`${n}枚目を読んでいます。`);
  } else if (done) {
    $("readLabel").textContent = "新しいゲーム";
    $("readSub").textContent = `${total}枚を読み終えました`;
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
}

// --------------------------
// 答えの確認（長押し）
// --------------------------

let revealTimer = 0;

function showReveal() {
  if (reading || !game || game.reads.length === 0) return;
  const rule = ruleOf(game.rule);
  const last = game.reads[game.reads.length - 1];
  $("revealTitle").textContent = `${game.reads.length}枚目の読み`;
  $("revealValue").textContent = last.value;
  const face = rule.kinds > 1 ? "" : cardFace(last.value);
  $("revealFace").textContent = face ? `（${face}）` : "";
  const kl = kindLabel(last.kind, rule.kinds);
  const kindEl = $("revealKind");
  kindEl.textContent = kl;
  kindEl.hidden = !kl;
  kindEl.style.setProperty("--kind", KIND_DEFS[last.kind].ink);
  $("revealHistory").replaceChildren(...game.reads.map((r) => {
    const li = document.createElement("li");
    li.textContent = `${r.value}${rule.kinds > 1 ? KIND_DEFS[r.kind].name : ""}`;
    if (rule.kinds > 1) li.style.setProperty("--kind", KIND_DEFS[r.kind].ink);
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
// ルールと速さ
// --------------------------

function buildSpeedChoices() {
  const seg = $("speedSeg");
  seg.replaceChildren(...T_LEVELS.map((t) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="radio" name="tSec"><span><b></b><small></small></span>`;
    label.querySelector("input").value = String(t);
    label.querySelector("b").textContent = speedWord(t);
    label.querySelector("small").textContent = `${formatT(t)} 秒`;
    return label;
  }));
  $("speedLegend").replaceChildren(...T_LEVELS.map((t) => {
    const li = document.createElement("li");
    li.textContent = `${speedWord(t)}：${formatT(t)} 秒ごと${t === 0.4 ? "（はじめの設定）" : ""}`;
    return li;
  }));
}

function fillSettingsForm() {
  const f = $("settingsForm");
  f.rule.value = settings.rule;
  f.tSec.value = String(settings.tSec);
  $("otherRules").open = ruleOf(settings.rule).other === true;
  updateApplyHelp();
}

function readSettingsForm() {
  const f = $("settingsForm");
  return normalizePublicSettings({ rule: f.rule.value, tSec: Number(f.tSec.value) });
}

function updateApplyHelp() {
  const next = readSettingsForm();
  const ruleChanged = next.rule !== game.rule;
  const midGame = game.reads.length > 0 && game.reads.length < game.order.length;
  $("applyHelp").textContent = ruleChanged && midGame
    ? "ルールを変えると、いまのゲームを打ち切って新しいゲームを始めます。"
    : "電子音の間隔は、次に読む札から変わります。";
  $("soundCheckHelp").textContent = ruleOf(next.rule).kinds > 1
    ? "準備音、ふつうの音のあと、赤の最後の音（高い）と黒の最後の音（低い）が鳴ります。"
    : "準備音、ふつうの音、最後の高い音の順に鳴ります。";
}

function saveSettingsFromForm() {
  const next = readSettingsForm();
  const ruleChanged = next.rule !== game.rule;
  settings = next;
  store.saveSettings(settings);
  if (ruleChanged) {
    newGame();
    setStatus(`${ruleOf(settings.rule).name}で新しいゲームを始めます。`);
  } else {
    render();
    setStatus(`電子音の間隔を ${formatT(settings.tSec)} 秒（${speedWord(settings.tSec)}）にしました。`);
  }
}

// --------------------------
// ダイアログと操作
// --------------------------

function setupControls() {
  wireDialogs();

  const tabs = document.querySelectorAll("#dlgRules .tab");
  tabs.forEach((t) => t.addEventListener("click", () => {
    tabs.forEach((x) => x.setAttribute("aria-selected", String(x === t)));
    document.querySelectorAll("#dlgRules .tabpanel").forEach((p) => { p.hidden = p.id !== t.dataset.tab; });
  }));

  $("btnRules").addEventListener("click", () => openDialog($("dlgRules")));
  const openSettings = () => { if (reading) return; fillSettingsForm(); openDialog($("dlgSettings")); };
  $("btnSettings").addEventListener("click", openSettings);
  $("plate").addEventListener("click", openSettings);
  $("settingsForm").addEventListener("change", updateApplyHelp);
  $("settingsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    saveSettingsFromForm();
    closeDialog($("dlgSettings"));
  });
  $("btnSoundCheck").addEventListener("click", async () => {
    await unlockAudio();
    setVolume(VOLUME);
    playSoundCheck(ruleOf(readSettingsForm().rule).kinds);
  });

  $("btnNewGame").addEventListener("click", () => {
    if (game && game.reads.length > 0 && game.reads.length < game.order.length) {
      $("confirmText").textContent = `${game.order.length}枚のうち ${game.reads.length}枚を読んだところです。`;
      openDialog($("dlgConfirm"));
    } else {
      newGame();
      setStatus("新しいゲームを用意しました。");
    }
  });
  $("btnConfirmNew").addEventListener("click", () => {
    closeDialog($("dlgConfirm"));
    newGame();
    setStatus("新しいゲームを用意しました。");
  });

  setupHold($("btnReveal"), REVEAL_HOLD_MS, showReveal, () => {
    if ($("reveal").hidden) setStatus("答えは、ボタンを長押しすると表示します。");
  });
  $("reveal").addEventListener("pointerdown", hideReveal);
}

// --------------------------
// 起動
// --------------------------

function boot() {
  $("version").textContent = `v${APP_VERSION}`;
  if (!isApple() && !isTouch()) $("noteSilent").hidden = true;
  buildSpeedChoices();
  newGame();
  setupControls();
  const wake = keepScreenOn(() => !$("app").hidden);

  $("btnStart").addEventListener("click", async () => {
    await unlockAudio();
    wake();
    $("splash").hidden = true;
    $("app").hidden = false;
    if (isApple()) showNotice("音が出ないときは、消音スイッチを切り、音量ボタンで音量を上げてください。");
    render();
  });
  $("btnRead").addEventListener("click", onRead);
  document.addEventListener("keydown", (e) => {
    if ($("app").hidden || anyDialogOpen() || !$("reveal").hidden || e.repeat) return;
    if (e.target instanceof HTMLElement && e.target.closest("input, select, textarea")) return;
    if (e.code === "Space" || e.code === "Enter") {
      if (e.target instanceof HTMLButtonElement && e.target.id !== "btnRead") return;
      e.preventDefault();
      onRead();
    }
  });
  // 電話の着信などで止まった音を、次のタップで起こす。
  document.addEventListener("pointerdown", () => { if (audioState() !== "running" && audioState() !== "none") unlockAudio(); });
  window.addEventListener("pagehide", () => { stopAll(); glow.stop(); });
  registerOffline();
  render();
}

boot();

// 検査のために、いまのゲームを外から読めるようにする（値の表示には使わない）。
window.__majikaruta = { get game() { return game; }, get settings() { return settings; }, RULES };
