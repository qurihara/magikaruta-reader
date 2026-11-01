// ==========================
// flash.js
// ==========================
// 音に合わせて画面全体を点滅させる。天井のカメラの映像と電子音を、あとで同期させるために使う。
// 点滅の時刻は、音の予約時刻を performance.now の時間軸に換算した値で決める（audio.js と core.js）。
// 描画は requestAnimationFrame の各コマで「いま光らせるべき色」を判定して行う。
// 画面が実際に光ったコマの時刻（requestAnimationFrame の時刻）を、点滅ごとに記録へ返す。
// ==========================

import { FLASH } from "./config.js";

let overlay = null;
let rafId = 0;
let items = [];
let currentColor = null;

export function initFlash(el) {
  overlay = el;
}

// 読みの点滅を始める。list の各要素は { startPerf, endPerf, color, onShown }。
// 読んでいる間は画面を黒い地にし、音の時刻にだけ色を出す。
export function runFlash(list) {
  if (!overlay) return;
  stopFlash();
  items = list.map((x) => ({ ...x, shown: false }));
  overlay.hidden = false;
  overlay.style.backgroundColor = FLASH.baseColor;
  currentColor = FLASH.baseColor;
  document.documentElement.classList.add("is-flashing");
  rafId = requestAnimationFrame(tick);
}

function tick(frameTime) {
  // requestAnimationFrame の時刻はそのコマの始まりを表す。半コマ（約8ミリ秒）手前から光らせ、
  // 実際に画面へ出る時刻が予約の時刻に近づくようにする。
  const now = performance.now();
  const t = Math.max(frameTime, now) + 8;
  let color = FLASH.baseColor;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const next = items[i + 1];
    // コマが落ちて点滅の時間を丸ごと飛ばしたときも、次の点滅が始まる前なら1コマだけ遅れて光らせる。
    // 点滅の数を数えて音の数と照合できるようにするためである。遅れた量は記録の flashShownPerf に残る。
    const missed = !it.shown && now >= it.endPerf && !(next && t >= next.startPerf);
    if (t >= it.startPerf && (now < it.endPerf || missed)) {
      color = it.color;
      if (!it.shown) {
        it.shown = true;
        if (it.onShown) it.onShown(frameTime);
      }
    }
  }
  if (color !== currentColor) {
    overlay.style.backgroundColor = color;
    currentColor = color;
  }
  rafId = requestAnimationFrame(tick);
}

// 点滅を終え、黒い地を外す。
export function stopFlash() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  items = [];
  if (overlay) {
    overlay.hidden = true;
    overlay.style.backgroundColor = "";
  }
  currentColor = null;
  document.documentElement.classList.remove("is-flashing");
}
