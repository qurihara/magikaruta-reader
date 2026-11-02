// ==========================
// storage.js
// ==========================
// 公開版（index.html）の localStorage への保存と読み出し。公開版は設定（ルールと電子音の間隔）と、画面の言語（v0.4.0）だけを保存し、
// ゲームの記録は残さない。プライベートブラウズなどで使えない場合も、アプリは動き続ける。すべての読み書きを try/catch で包む。
// 実験用のページの保存は lab-storage.js が受け持つ。
// ==========================

import { STORAGE_PREFIX, LEGACY_STORAGE_PREFIX } from "./config.js";

const SETTINGS_KEY = STORAGE_PREFIX + "settings";
const LANG_KEY = STORAGE_PREFIX + "lang";

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw !== null) return JSON.parse(raw);
    // v0.1.0 の設定が残っていれば、t だけを引き継ぐ（ルールの形が変わったので、ルールは引き継がない）。
    const old = localStorage.getItem(LEGACY_STORAGE_PREFIX + "settings");
    return old ? { tSec: JSON.parse(old).tSec } : null;
  } catch (_) {
    return null;
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ rule: s.rule, tSec: s.tSec }));
    return true;
  } catch (_) {
    return false;
  }
}

// 画面の言語（"ja" か "en"）。読めなければ null を返し、呼び出し元が端末の言語から決める。
export function loadLang() {
  try {
    return localStorage.getItem(LANG_KEY);
  } catch (_) {
    return null;
  }
}

export function saveLang(lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
    return true;
  } catch (_) {
    return false;
  }
}

// v0.1.0 が残した鍵（ゲームの記録、ゲームの番号、t の袋、設定）を消す。公開版は設定のほかに何も残さない。
export function removeLegacyKeys() {
  try {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LEGACY_STORAGE_PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
    return doomed.length;
  } catch (_) {
    return 0;
  }
}
