// ==========================
// storage.js
// ==========================
// localStorage への保存と読み出し。プライベートブラウズなどで使えない場合も、アプリは動き続ける
// （そのときは記録が残らない旨を画面に出す）。すべての読み書きを try/catch で包む。
// ==========================

import { STORAGE_PREFIX } from "./config.js";

const KEYS = {
  settings: STORAGE_PREFIX + "settings",
  games: STORAGE_PREFIX + "games",
  currentId: STORAGE_PREFIX + "currentGameId",
  nextGameNo: STORAGE_PREFIX + "nextGameNo",
  tBag: STORAGE_PREFIX + "tBag",
};

let available = true;
let lastError = null;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) {
    available = false;
    lastError = e;
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    lastError = e;
    // 容量の上限に達したときは QuotaExceededError になる。
    if (e && e.name !== "QuotaExceededError") available = false;
    return false;
  }
}

export function storageStatus() {
  return { available, lastError: lastError ? String(lastError.name || lastError) : null };
}

export const loadSettings = () => read(KEYS.settings, null);
export const saveSettings = (s) => write(KEYS.settings, s);

export const loadGames = () => {
  const g = read(KEYS.games, []);
  return Array.isArray(g) ? g : [];
};
export const saveGames = (games) => write(KEYS.games, games);

export const loadCurrentId = () => read(KEYS.currentId, null);
export const saveCurrentId = (id) => write(KEYS.currentId, id);

export const loadNextGameNo = () => {
  const n = Number(read(KEYS.nextGameNo, 1));
  return Number.isInteger(n) && n >= 1 ? n : 1;
};
export const saveNextGameNo = (n) => write(KEYS.nextGameNo, n);

export const loadTBag = () => read(KEYS.tBag, []);
export const saveTBag = (bag) => write(KEYS.tBag, bag);

// 記録が占めているおよその量（キロバイト）。
export function gamesSizeKb() {
  try {
    const raw = localStorage.getItem(KEYS.games) || "";
    return Math.round((raw.length * 2) / 1024);
  } catch (_) {
    return 0;
  }
}

// ゲームの記録だけを消す（設定は残す）。
export function clearGames() {
  try {
    localStorage.removeItem(KEYS.games);
    localStorage.removeItem(KEYS.currentId);
  } catch (_) { /* 何もしない */ }
}
