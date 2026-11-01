// ==========================
// lab-storage.js
// ==========================
// 実験用のページ（lab.html）の状態の保存。状態の全部を1つの値として、操作のたびに書き込む。
// 保存先は IndexedDB を使う。localStorage は配信元（unryu.org）のほかのページと容量（約5MB）を分け合い、
// 1日の実験の音の記録（数ゲームで数百KB、数十ゲームで1MB を超える）で溢れるおそれがあるためである。
// IndexedDB が使えないブラウザ（一部のプライベートブラウズ）では localStorage に保存し、画面にその旨を出す。
// ==========================

import { LAB_DB, LAB_LOCAL_KEY } from "./config.js";

let db = null;
let mode = "none"; // "idb"、"local"、"none"

function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { reject(new Error("IndexedDB がありません")); return; }
    const req = indexedDB.open(LAB_DB.name, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(LAB_DB.store)) d.createObjectStore(LAB_DB.store);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB が別のタブで使われています"));
  });
}

// 保存先を開く。返り値は "idb"、"local"、"none" のどれか。
export async function openLabStore() {
  try {
    db = await openDb();
    mode = "idb";
  } catch (_) {
    try {
      localStorage.setItem(LAB_LOCAL_KEY + ":probe", "1");
      localStorage.removeItem(LAB_LOCAL_KEY + ":probe");
      mode = "local";
    } catch (__) {
      mode = "none";
    }
  }
  // ブラウザが容量の逼迫で消さないように、永続の保存を頼む（認められなくても動く）。
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (_) { /* 何もしない */ }
  return mode;
}

export function storeMode() {
  return mode;
}

export async function loadLabState() {
  if (mode === "idb") {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LAB_DB.store, "readonly");
      const req = tx.objectStore(LAB_DB.store).get(LAB_DB.key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }
  if (mode === "local") {
    const raw = localStorage.getItem(LAB_LOCAL_KEY);
    return raw ? JSON.parse(raw) : null;
  }
  return null;
}

// 状態を書き込む。IndexedDB の put は呼んだ時点で値を複製するので、書き込みの完了を待たずに状態を書き換えてよい。
// 書き込みは呼んだ順に行われる。返り値の Promise は、書き込みが確定したら解決する。
export function saveLabState(state) {
  if (mode === "idb") {
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(LAB_DB.store, "readwrite");
        tx.objectStore(LAB_DB.store).put(state, LAB_DB.key);
      } catch (e) {
        reject(e);
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("保存が中止されました"));
    });
  }
  if (mode === "local") {
    try {
      localStorage.setItem(LAB_LOCAL_KEY, JSON.stringify(state));
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  }
  return Promise.reject(new Error("この端末では保存できません"));
}

export async function clearLabState() {
  if (mode === "idb") {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(LAB_DB.store, "readwrite");
      tx.objectStore(LAB_DB.store).delete(LAB_DB.key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } else if (mode === "local") {
    localStorage.removeItem(LAB_LOCAL_KEY);
  }
}

// 状態のおよその大きさ（キロバイト）。画面に出して、書き出しの目安にする。
export function stateSizeKb(state) {
  try {
    return Math.round(JSON.stringify(state).length / 1024);
  } catch (_) {
    return 0;
  }
}
