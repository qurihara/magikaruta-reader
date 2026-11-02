// ==========================
// app.js
// ==========================
// 公開版（index.html）の画面の操作とゲームの進行。使う人の体験を重視して簡素にしてある。
// 研究用の機能（カメラ用の全画面の点滅、点滅の遅れの補正、記録の保存と書き出し、条件の管理）は、実験用のページ（lab.html、lab-app.js）にだけある。
// 音は audio.js、点滅は flash.js、計算は core.js、設定の保存は storage.js が受け持つ。
// 読んでいる最中と読む前には、札の値を画面に出さない。直前の読みの値を出すのは「答えを確かめる」を長押ししたときだけである。
// 本体の画面には、読まれた札の履歴を常に出す（v0.2.2）。ただし直前の読みは、次の「読む」を押すか、長押しで答えを見るまで履歴に載せない。
// 画面の文言は日本語と英語の2つで、辞書は i18n.js にある（v0.4.0）。T() で引き、applyI18n で HTML の印のある要素を差し替える。
// 言語は最初の画面と本体の下の欄のボタンで切り替え、localStorage に保存する。
// ==========================

import {
  APP_VERSION, T_LEVELS, RULES, PREP_GAP_SEC, AFTER_READ_SEC, REVEAL_HOLD_MS, REVEAL_SHOW_MS, KIND_DEFS,
  DEFAULT_PUBLIC_SETTINGS,
} from "./config.js";
import {
  normalizePublicSettings, ruleOf, ruleName, ruleSummary, buildReadingOrder, glowSpecFor, ctxToPerf, formatT, speedWord,
  kindLabel, cardFace, cardLabel, buildHistoryView,
} from "./core.js";
import { translate, resolveLang, normalizeLang } from "./i18n.js";
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

// 画面の言語。URL の ?lang=、保存した選択、端末の言語の順に決める（i18n.js の resolveLang）。
let lang = resolveLang({ query: location.search, stored: store.loadLang(), navLang: navigator.language });
const T = (key, params) => translate(lang, key, params);

// 最後に出した状態の文を、鍵と値で覚えておく。言語を切り替えたときに、同じ文を新しい言語で出し直すためである。
let lastStatus = null;
let noticeKey = "";

// lastShown は、直前の読みを履歴に載せてよいかどうか。長押しで答えを見たら true にし、次を読んだら false に戻す。
// 次を読んだ時点で、それまでの読みはすべて履歴に載る（buildHistoryView が、最後の1つを除いて載せる）。
let game = null;      // { rule, order, reads: [{ value, kind }], lastShown }
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
  game = { rule: rule.key, order: buildReadingOrder(rule), reads: [], lastShown: false };
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
    setStatus("status.audioFailed");
    return;
  }
  if (!game || game.reads.length >= game.order.length) {
    newGame();
    setStatus("status.newGame");
    return;
  }
  const rule = ruleOf(game.rule);
  const card = game.order[game.reads.length];
  setVolume(VOLUME);
  const sched = scheduleRead({ count: card.value, kind: card.kind, tSec: settings.tSec, prepGapSec: PREP_GAP_SEC });
  game.reads.push({ value: card.value, kind: card.kind });
  // いま読む札は、次を読むか答えを見るまで履歴に載せない。1つ前の読みは、ここで履歴に載る。
  game.lastShown = false;
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

// 状態の文を出す。文言は辞書の鍵と差し込む値で受け取る。
function setStatus(key, params = {}) {
  lastStatus = { key, params };
  $("statusText").textContent = T(key, params);
}

function showNotice(key) {
  noticeKey = key;
  const n = $("mainNotice");
  n.textContent = key ? T(key) : "";
  n.hidden = !key;
}

function render() {
  if (!game) return;
  const rule = ruleOf(game.rule);
  const n = game.reads.length;
  const total = game.order.length;
  $("infoRule").textContent = ruleName(rule.key, lang);
  $("infoRuleNote").textContent = ruleSummary(rule.key, lang);
  $("infoSpeed").textContent = speedWord(settings.tSec, lang);
  $("infoT").textContent = T("plate.every", { t: formatT(settings.tSec) });
  $("readCount").textContent = n;
  $("totalCount").textContent = T("count.of", { total });

  renderHistory(rule);

  const done = n >= total;
  const btn = $("btnRead");
  btn.disabled = reading;
  btn.classList.toggle("is-reading", reading);
  btn.classList.toggle("is-done", done && !reading);
  if (reading) {
    $("readLabel").textContent = T("read.readingLabel");
    $("readSub").textContent = T("read.readingSub");
    setStatus("status.reading", { n });
  } else if (done) {
    $("readLabel").textContent = T("read.doneLabel");
    $("readSub").textContent = T("read.doneSub", { total });
    setStatus("status.done");
  } else {
    $("readLabel").textContent = T("read.label");
    $("readSub").textContent = T("read.sub", { n: n + 1 });
    setStatus(n === 0 ? "status.first" : "status.next");
  }
  $("btnReveal").disabled = reading || n === 0;
  $("btnNewGame").disabled = reading;
}

// 読まれた札の履歴を描く。札の並びと読んだ順の列の両方を、core.js の buildHistoryView の結果から作る。
function renderHistory(rule) {
  const view = buildHistoryView({ rule, reads: game.reads, lastShown: game.lastShown, lang });
  const board = $("histBoard");
  // 幅の狭い電話では、種類が1つのルールの札を2段に折り返す（--cols-half）。折り返す幅は style.css で決める。
  board.style.setProperty("--cols", String(view.columns));
  board.style.setProperty("--cols-half", String(Math.ceil(view.columns / 2)));
  board.classList.toggle("is-kinds", view.rows.length > 1);
  board.replaceChildren(...view.rows.map((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "hist-row";
    rowEl.dataset.kind = KIND_DEFS[row.kind].key;
    if (row.label) {
      const lab = document.createElement("span");
      lab.className = "hist-row-label";
      lab.textContent = row.label;
      rowEl.append(lab);
    }
    const cells = document.createElement("ol");
    cells.className = "hist-cells";
    cells.append(...row.cells.map((c) => {
      const li = document.createElement("li");
      li.className = "hist-cell";
      if (c.order) li.classList.add("is-read");
      if (c.latest) li.classList.add("is-latest");
      const num = document.createElement("span");
      num.className = "hist-num";
      num.textContent = c.value;
      li.append(num);
      if (c.order) {
        const ord = document.createElement("span");
        ord.className = "hist-ord";
        ord.textContent = c.order;
        li.append(ord);
      }
      const card = cardLabel(c.value, c.kind, rule.kinds, lang);
      li.setAttribute("aria-label", c.order ? T("hist.cellRead", { card, order: c.order }) : T("hist.cellUnread", { card }));
      return li;
    }));
    rowEl.append(cells);
    return rowEl;
  }));

  // 読んだ順の数字の列（例：7 → 3 → 11）。まだ載せていない直前の読みは「？」で示す。
  const seq = $("histSeq");
  const items = view.sequence.map((s) => {
    const b = document.createElement("b");
    b.textContent = s.label;
    if (rule.kinds > 1) b.dataset.kind = KIND_DEFS[s.kind].key;
    return b;
  });
  if (view.pending) {
    const q = document.createElement("b");
    q.className = "hist-pending";
    q.textContent = T("hist.pending");
    q.setAttribute("aria-label", T("hist.pendingAria"));
    items.push(q);
  }
  if (items.length === 0) {
    const empty = document.createElement("span");
    empty.className = "hist-empty";
    empty.textContent = T("hist.empty");
    seq.replaceChildren(empty);
  } else {
    const parts = [];
    items.forEach((el, i) => {
      if (i > 0) {
        const arrow = document.createElement("span");
        arrow.className = "hist-arrow";
        arrow.textContent = "→";
        arrow.setAttribute("aria-hidden", "true");
        parts.push(arrow);
      }
      parts.push(el);
    });
    seq.replaceChildren(...parts);
  }
  seq.classList.toggle("is-reading", reading);

  const note = $("histNote");
  note.hidden = !view.pending;
  note.textContent = T(game.reads.length >= game.order.length ? "hist.noteLast" : "hist.noteNext");
}

// --------------------------
// 答えの確認（長押し）
// --------------------------

let revealTimer = 0;

function showReveal() {
  if (reading || !game || game.reads.length === 0) return;
  fillReveal();
  $("reveal").hidden = false;
  // 答えを見たので、直前の読みを履歴に載せる。
  game.lastShown = true;
  render();
  clearTimeout(revealTimer);
  revealTimer = setTimeout(hideReveal, REVEAL_SHOW_MS);
}

// 答えの表示の中身を、いまの言語で書く。表示している最中に言語を切り替えたときにも呼ぶ。
function fillReveal() {
  const rule = ruleOf(game.rule);
  const last = game.reads[game.reads.length - 1];
  if (!last) return;
  $("revealTitle").textContent = T("reveal.title", { n: game.reads.length });
  $("revealValue").textContent = last.value;
  const face = rule.kinds > 1 ? "" : cardFace(last.value);
  $("revealFace").textContent = face ? T("reveal.face", { face }) : "";
  const kl = kindLabel(last.kind, rule.kinds, lang);
  const kindEl = $("revealKind");
  kindEl.textContent = kl;
  kindEl.hidden = !kl;
  kindEl.style.setProperty("--kind", KIND_DEFS[last.kind].ink);
  $("revealHistory").replaceChildren(...game.reads.map((r) => {
    const li = document.createElement("li");
    const kind = kindLabel(r.kind, rule.kinds, lang);
    li.textContent = kind ? T("reveal.histItem", { value: r.value, kind }) : String(r.value);
    if (rule.kinds > 1) li.style.setProperty("--kind", KIND_DEFS[r.kind].ink);
    return li;
  }));
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
    label.querySelector("b").textContent = speedWord(t, lang);
    label.querySelector("small").textContent = T("settings.seconds", { t: formatT(t) });
    return label;
  }));
  $("speedLegend").replaceChildren(...T_LEVELS.map((t) => {
    const li = document.createElement("li");
    li.textContent = T("rules.t.legend", { word: speedWord(t, lang), t: formatT(t) })
      + (t === DEFAULT_PUBLIC_SETTINGS.tSec ? T("rules.t.default") : "");
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
  $("applyHelp").textContent = T(ruleChanged && midGame ? "settings.applyRule" : "settings.applySpeed");
  $("soundCheckHelp").textContent = T(ruleOf(next.rule).kinds > 1 ? "settings.soundCheckHelpKinds" : "settings.soundCheckHelp");
}

function saveSettingsFromForm() {
  const next = readSettingsForm();
  const ruleChanged = next.rule !== game.rule;
  settings = next;
  store.saveSettings(settings);
  if (ruleChanged) {
    newGame();
    setStatus("status.ruleChanged", { rule: ruleName(settings.rule, lang) });
  } else {
    render();
    setStatus("status.speedChanged", { t: formatT(settings.tSec), word: speedWord(settings.tSec, lang) });
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
      $("confirmText").textContent = T("confirm.text", { total: game.order.length, n: game.reads.length });
      openDialog($("dlgConfirm"));
    } else {
      newGame();
      setStatus("status.newGame");
    }
  });
  $("btnConfirmNew").addEventListener("click", () => {
    closeDialog($("dlgConfirm"));
    newGame();
    setStatus("status.newGame");
  });

  setupHold($("btnReveal"), REVEAL_HOLD_MS, showReveal, () => {
    if ($("reveal").hidden) setStatus("status.holdHint");
  });
  $("reveal").addEventListener("pointerdown", hideReveal);
}

// --------------------------
// 言語
// --------------------------

// HTML の印（data-i18n、data-i18n-html、data-i18n-attr）のある要素の文言を、いまの言語で差し替える。
function applyI18n() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = T(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = T(el.dataset.i18nHtml); });
  document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    el.dataset.i18nAttr.split(";").forEach((pair) => {
      const [attr, key] = pair.split(":").map((x) => x.trim());
      if (attr && key) el.setAttribute(attr, T(key));
    });
  });
  document.querySelectorAll(".lang-btn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
}

// 言語を切り替える。辞書の文言を差し替え、JavaScript で組み立てる部分（札、履歴、状態の文、設定の選択肢）も描き直す。
function setLang(next) {
  const l = normalizeLang(next);
  if (!l) return;
  lang = l;
  store.saveLang(lang);
  // URL に ?lang= があれば、選んだ言語に書き換える（再読み込みしても選んだ言語のままにするため）。
  try {
    const url = new URL(location.href);
    if (url.searchParams.has("lang")) {
      url.searchParams.set("lang", lang);
      history.replaceState(history.state, "", url);
    }
  } catch (_) { /* 書き換えられなくても切り替えは効く */ }
  applyI18n();
  // 速さの選択肢は作り直すので、選んであった値を写し直す（言語のボタンは本体の画面にあり、設定を開いたままでは押せないが、念のため）。
  const form = $("settingsForm");
  const chosenT = form.tSec ? form.tSec.value : "";
  buildSpeedChoices();
  if (chosenT) form.tSec.value = chosenT;
  if ($("dlgSettings").open) updateApplyHelp();
  render();
  if (lastStatus) setStatus(lastStatus.key, lastStatus.params);
  showNotice(noticeKey);
  if (!$("reveal").hidden) fillReveal();
}

// --------------------------
// 起動
// --------------------------

function boot() {
  applyI18n();
  document.documentElement.classList.remove("i18n-pending");
  document.querySelectorAll(".lang-btn").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));
  $("version").textContent = `v${APP_VERSION}`;
  $("splashVersion").textContent = `v${APP_VERSION}`;
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
    if (isApple()) showNotice("notice.apple");
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
window.__majikaruta = { get game() { return game; }, get settings() { return settings; }, get lang() { return lang; }, RULES };
