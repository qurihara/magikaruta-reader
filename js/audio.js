// ==========================
// audio.js
// ==========================
// Web Audio で電子音を作る。1回の読みのすべての音を、ボタンを押した時点で AudioContext の時刻で予約する。
// setTimeout では鳴らさないので、端末が忙しくても音の間隔はずれない。
// 同じ案件の収集Bのアプリ（collection-b-app/js/audio.js）の予約の仕方を流用した。
// ==========================

import { AUDIO, KIND_DEFS } from "./config.js";
import { buildToneTimeline } from "./core.js";

let ctx = null;
let master = null;
let live = []; // 予約中または鳴っている発振器。中断のために持つ

// AudioContext を用意する。iOS では、最初の作成と再開を利用者のタップの中で行う必要がある。
export function getAudioContext() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctor({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
  }
  return ctx;
}

// タップの中で呼び、AudioContext を起こす。
// iOS の Safari では、無音の短い音を1回鳴らすと、その後の予約した音が確実に鳴る。
// Safari 16.4 以降は navigator.audioSession で「再生」の扱いにでき、消音スイッチが入っていても鳴る端末がある。
export async function unlockAudio() {
  try {
    if (navigator.audioSession && navigator.audioSession.type !== "playback") {
      navigator.audioSession.type = "playback";
    }
  } catch (_) { /* 対応していないブラウザでは何もしない */ }
  const c = getAudioContext();
  if (c.state !== "running") {
    try { await c.resume(); } catch (_) { /* 再開できなければ次のタップで再試行する */ }
  }
  try {
    const buf = c.createBuffer(1, 1, c.sampleRate);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(0);
  } catch (_) { /* 無音を鳴らせなくても先へ進む */ }
  return c.state;
}

export function audioState() {
  return ctx ? ctx.state : "none";
}

export function setVolume(v) {
  getAudioContext();
  master.gain.value = Math.max(0, Math.min(1, Number(v)));
}

// 1つの音を時刻 when に予約する。
function scheduleTone(c, { when, durationSec, hz, wave = "sine", gainScale = 1, decay = false }) {
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = wave;
  osc.frequency.value = hz;
  const attack = Math.min(AUDIO.attackSec, durationSec / 4);
  const release = Math.min(AUDIO.releaseSec, durationSec / 4);
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(gainScale, when + attack);
  if (decay) {
    // 準備音は鐘のように減衰させ、通常の音と聞き分けやすくする。
    env.gain.exponentialRampToValueAtTime(Math.max(0.001, gainScale * 0.25), when + durationSec - release);
  } else {
    env.gain.setValueAtTime(gainScale, when + durationSec - release);
  }
  env.gain.linearRampToValueAtTime(0, when + durationSec);
  osc.connect(env);
  env.connect(master);
  osc.start(when);
  osc.stop(when + durationSec + 0.02);
  live.push(osc);
  osc.onended = () => { live = live.filter((o) => o !== osc); };
}

// 1つの出来事（準備音、通常の音、最後の音）を鳴らす。
function playEvent(c, e, kind) {
  if (e.role === "prep") {
    scheduleTone(c, { when: e.at, durationSec: e.durationSec, hz: AUDIO.prepHz, wave: "triangle", gainScale: 0.9, decay: true });
  } else if (e.role === "tone") {
    scheduleTone(c, { when: e.at, durationSec: e.durationSec, hz: AUDIO.toneHz });
  } else {
    const def = KIND_DEFS[kind] || KIND_DEFS[0];
    scheduleTone(c, { when: e.at, durationSec: e.durationSec, hz: def.lastHz, wave: def.wave, gainScale: def.gainScale });
  }
}

// 1回の読みを予約する。count は鳴らす回数（読まれた札の値）、kind は種類の番号。
// 返り値は、予約した出来事の一覧と、時間軸の換算の基準（同じ瞬間に読んだ ctx、performance.now、Date.now）。
export function scheduleRead({ count, kind, tSec, prepGapSec }) {
  const c = getAudioContext();
  // 3つの時計を、できるだけ同じ瞬間に読む。
  const perfNow = performance.now();
  const ctxNow = c.currentTime;
  const epochNow = Date.now();
  const events = buildToneTimeline({ startCtx: ctxNow + AUDIO.leadSec, count, tSec, prepGapSec });
  for (const e of events) playEvent(c, e, kind);
  return {
    events,
    base: { perfNow, ctxNow, epochNow },
    outputLatencySec: typeof c.outputLatency === "number" ? c.outputLatency : null,
    baseLatencySec: typeof c.baseLatency === "number" ? c.baseLatency : null,
    sampleRate: c.sampleRate,
  };
}

// 予約済みの音をすべて止める。
export function stopAll() {
  for (const o of live) { try { o.stop(); } catch (_) { /* 既に止まっている */ } }
  live = [];
}

// 音の確認。準備音、通常の音2回、最後の音（種類ごと）を順に鳴らす。
// 返り値は、各種類の最後の音が鳴る時刻（performance.now の時間軸、ミリ秒）の配列。画面で種類の名前を光らせるのに使う。
export function playSoundCheck(kinds) {
  const c = getAudioContext();
  const perfNow = performance.now();
  const ctxNow = c.currentTime;
  const marks = [];
  let at = ctxNow + 0.1;
  scheduleTone(c, { when: at, durationSec: AUDIO.prepDurationSec, hz: AUDIO.prepHz, wave: "triangle", gainScale: 0.9, decay: true });
  at += 0.7;
  for (let k = 0; k < kinds; k++) {
    scheduleTone(c, { when: at, durationSec: 0.08, hz: AUDIO.toneHz });
    scheduleTone(c, { when: at + 0.4, durationSec: 0.08, hz: AUDIO.toneHz });
    const def = KIND_DEFS[k];
    scheduleTone(c, { when: at + 0.8, durationSec: AUDIO.lastDurationSec, hz: def.lastHz, wave: def.wave, gainScale: def.gainScale });
    marks.push(perfNow + (at + 0.8 - ctxNow) * 1000);
    at += 1.7;
  }
  return marks;
}
