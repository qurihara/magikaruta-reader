// ==========================
// ui.js
// ==========================
// 公開版（app.js）と実験用のページ（lab-app.js）が共通に使う、小さな画面の部品。
// ダイアログの開け閉め、長押しのボタン、2回押しで実行するボタン、画面の消灯の防止、ファイルの書き出し、オフラインの準備を扱う。
// 画面の状態（ゲームや設定）は持たない。
// ==========================

export const $ = (id) => document.getElementById(id);

export function openDialog(d) {
  if (typeof d.showModal === "function") d.showModal();
  else d.setAttribute("open", "");
}

export function closeDialog(d) {
  if (typeof d.close === "function") d.close();
  else d.removeAttribute("open");
}

// ページの中のすべてのダイアログで、[data-close] のボタンと幕の外の押下で閉じるようにする。
export function wireDialogs() {
  document.querySelectorAll("dialog").forEach((d) => {
    d.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeDialog(d)));
    d.addEventListener("click", (e) => { if (e.target === d) closeDialog(d); });
  });
}

export function anyDialogOpen() {
  return Array.from(document.querySelectorAll("dialog")).some((d) => d.open);
}

// 長押しのボタン。ms ミリ秒押し続けると onHold を呼ぶ。短く押しただけなら onShort を呼ぶ。
export function setupHold(button, ms, onHold, onShort = () => {}) {
  let timer = 0;
  let fired = false;
  const start = (ev) => {
    if (button.disabled) return;
    ev.preventDefault();
    fired = false;
    button.classList.add("holding");
    clearTimeout(timer);
    timer = setTimeout(() => { fired = true; button.classList.remove("holding"); onHold(); }, ms);
  };
  const cancel = () => { clearTimeout(timer); button.classList.remove("holding"); };
  button.style.setProperty("--hold-ms", `${ms}ms`);
  button.addEventListener("pointerdown", start);
  button.addEventListener("pointerup", cancel);
  button.addEventListener("pointerleave", cancel);
  button.addEventListener("pointercancel", cancel);
  button.addEventListener("contextmenu", (e) => e.preventDefault());
  button.addEventListener("click", () => { if (!fired) onShort(); fired = false; });
}

// 2回押しで実行するボタン。1回目でボタンの文字を armedText に替えて待ち、ms ミリ秒の間に2回目を押すと onConfirm を呼ぶ。
// ブラウザの confirm は使わない（画面の中で確かめる）。
export function setupArmed(button, armedText, onConfirm, ms = 4000) {
  let timer = 0;
  const disarm = () => {
    clearTimeout(timer);
    timer = 0;
    button.classList.remove("armed");
    if (button.dataset.label) button.innerHTML = button.dataset.label;
  };
  button.addEventListener("click", () => {
    if (button.disabled) return;
    if (!timer) {
      button.dataset.label = button.innerHTML;
      button.textContent = typeof armedText === "function" ? armedText() : armedText;
      button.classList.add("armed");
      timer = setTimeout(disarm, ms);
      return;
    }
    disarm();
    onConfirm();
  });
  return { disarm };
}

// 画面の消灯を止める。使えない端末では黙って諦める。表示が戻ったら取り直す。
export function keepScreenOn(isActive) {
  let lock = null;
  async function request() {
    try {
      if ("wakeLock" in navigator && document.visibilityState === "visible" && !lock) {
        lock = await navigator.wakeLock.request("screen");
        lock.addEventListener("release", () => { lock = null; });
      }
    } catch (_) { /* 使えない端末では何もしない */ }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && isActive()) request();
  });
  return request;
}

// 書き出すファイルの名前に付ける日時（端末の時刻）。
export function stamp(d = new Date()) {
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function download(name, text, type) {
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

// オフラインでも開き直せるように、サービスワーカー（sw.js）を登録する。使えないブラウザでは何もしない。
export function registerOffline() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register("sw.js").catch(() => { /* 登録できなくても、回線があれば動く */ });
}

export const isTouch = () => matchMedia("(pointer: coarse)").matches;
export const isApple = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && "ontouchend" in document;
