// ==========================
// config.js
// ==========================
// まじかるた読み上げアプリの定数を、この1か所にまとめる。公開版（index.html）と実験用のページ（lab.html）の両方が読む。
// 版の数字（APP_VERSION）もここだけで管理する。直したら必ず上げ、README の変更履歴に1行書く。
// このファイルはブラウザと node --test の両方から読み込むので、DOM に触れない。
// ==========================

export const APP_VERSION = "0.2.0";

// --------------------------
// 電子音の間隔 t
// --------------------------

// 電子音の間隔 t の5水準（秒）。隣り合う水準の比が2倍の等比の並びである。
export const T_LEVELS = [0.1, 0.2, 0.4, 0.8, 1.6];

// 手で指定する t として受け付ける範囲（秒）。実験用のページの設定と手動の指定で使う。
export const T_MIN = 0.05;
export const T_MAX = 3.0;

// 公開版で t の5水準に添える、速さの言葉。
export const SPEED_WORDS = {
  0.1: "とても速い",
  0.2: "速い",
  0.4: "ふつう",
  0.8: "ゆっくり",
  1.6: "とてもゆっくり",
};

// 準備音の鳴り始めから最初の電子音の鳴り始めまでの間（秒）。公開版はこの値に固定する。
export const PREP_GAP_SEC = 1.0;

// --------------------------
// 公開版
// --------------------------

// 公開版の localStorage の鍵の接頭辞。公開版は設定（ルールと間隔）だけを保存する。
export const STORAGE_PREFIX = "majikaruta-reader:v2:";
// v0.1.0 が使っていた鍵の接頭辞。公開版を開いたときに、記録などの古い鍵を消す。
export const LEGACY_STORAGE_PREFIX = "majikaruta-reader:v1:";

// 公開版のルール。値の範囲と札の種類の数を、ここで決める。
// 赤と黒は「ほかの遊び方」として目立たない位置に置く（other: true）。
export const RULES = {
  standard: {
    key: "standard",
    name: "いつものルール",
    maxValue: 12,
    kinds: 1,
    blank: false,
    summary: "1〜12 の12枚・空札なし",
  },
  blank: {
    key: "blank",
    name: "空札あり",
    maxValue: 13,
    kinds: 1,
    blank: true,
    summary: "1〜13 を読む・6枚ずつ配り、1枚は空札",
  },
  redblack: {
    key: "redblack",
    name: "赤と黒",
    maxValue: 6,
    kinds: 2,
    blank: false,
    other: true,
    summary: "赤の1〜6と黒の1〜6の12枚・最後の音の高さで色を伝える",
  },
};
export const RULE_KEYS = ["standard", "blank", "redblack"];

export const DEFAULT_PUBLIC_SETTINGS = {
  rule: "standard",
  tSec: 0.4,
};

// --------------------------
// 実験用のページ
// --------------------------

// 実験用のページの状態の形式の名前。書き出した JSON にも入れ、読み込むときに照らし合わせる。
export const LAB_SCHEMA = "majikaruta-lab/1";

// 実験用のページの状態を保存する IndexedDB の名前。IndexedDB が使えないときだけ localStorage の鍵を使う。
export const LAB_DB = { name: "majikaruta-lab", store: "kv", key: "state" };
export const LAB_LOCAL_KEY = "majikaruta-lab:v1:state";

// 2人に配る枚数。空札なしは 1〜12 を6枚ずつ、空札ありは 1〜13 から6枚ずつ配り、残りの1枚が空札になる。
export const DEAL_PER_PLAYER = 6;

// 同時に遊ぶ組（卓）の数の上限。
export const TABLE_COUNT_MAX = 4;

// 空札のルールの説明の既定の文。お手つきの罰はまだ決まっていないので、設定で書き換えられるようにする。
export const DEFAULT_BLANK_RULE_TEXT = "空札が読まれたら、どの札にも触れません。触れたらお手つきで、相手から 1 枚送られます";

export const LAB_DEFAULT_CONFIG = {
  tLevels: [0.1, 0.2, 0.4, 0.8, 1.6], // 条件の t の水準（秒）
  blankLevels: [false, true],         // 条件の空札の有無の水準
  prepGapSec: 1.0,                    // 準備音から最初の電子音までの間（秒）
  volume: 0.7,                        // 音量（0〜1）
  flash: true,                        // 読んでいる間、画面を黒くして音の時刻に光らせるかどうか
  flashOffsetMs: 0,                   // 点滅を音より遅らせる量（ミリ秒）。外付けのスピーカの遅れに合わせる
  tableCount: 4,                      // 同時に遊ぶ組（卓）の数（1〜4）
  label: "",                          // 記録に付ける見出し（会場や日付）
  blankRuleText: DEFAULT_BLANK_RULE_TEXT,
};

// --------------------------
// 音
// --------------------------

// 電子音の高さと長さ。
// 通常の音と、種類が1つのときの最後の音は、同じ案件の収集Bのアプリ（collection-b-app）と同じ高さにそろえた。
// 紙のフリープレイ（収集A）とPCの実験（収集B）で、参加者が聞く音を同じにするためである。
export const AUDIO = {
  toneHz: 880,             // 通常の音（「ピン」）
  prepHz: 523.25,          // 準備音（ド。三角波で柔らかくする）
  prepDurationSec: 0.22,   // 準備音の長さ
  maxToneDurationSec: 0.08,// 通常の音の長さの上限。実際の長さは min(t/2, この値)
  lastDurationSec: 0.22,   // 最後の音の長さ。色を聞き分けやすいように通常の音より長くする
  attackSec: 0.005,        // 立ち上がりの傾斜（クリック音を避ける）
  releaseSec: 0.012,       // 減衰の傾斜
  leadSec: 0.12,           // ボタンを押してから準備音までの余白（予約が過去にならないように）
};

// 札の種類。公開版の「赤と黒」で使う。種類が1つのルールでは、最後の音は赤（高い音）の定義を使う。
// 赤の札は通常の音の1オクターブ上、黒の札は1オクターブ下で終わる。
// color はカメラ用の点滅の色、ink は画面の文字の色である。黒の札は黒では点滅させられないので、藍の青で点滅させる。
export const KIND_DEFS = [
  { key: "red",   name: "赤", lastHz: 1760, wave: "sine", gainScale: 1.0, color: "#ff2a12", ink: "#c8321e" },
  { key: "black", name: "黒", lastHz: 440,  wave: "sine", gainScale: 1.0, color: "#1e50ff", ink: "#2b2723" },
];

// --------------------------
// 点滅
// --------------------------

// 実験用のページのカメラ用の点滅の色。黒い地の上で光らせる。
export const FLASH = {
  baseColor: "#000000",   // 読んでいる間の地の色
  prepColor: "#8c8c8c",   // 準備音の点滅（灰色。明るさで通常の音と区別する）
  toneColor: "#ffffff",   // 通常の音の点滅（白）
  lastColor: "#ff2a12",   // 最後の音の点滅（朱）
  maxToneFlashSec: 0.1,   // 通常の音の点滅の長さの上限。実際の長さは min(t/2, この値)
  prepFlashSec: 0.15,
  lastFlashSec: 0.35,
};

// 読み終えてから次の読みを受け付けるまでの間（秒）。最後の音が鳴り終わるのを待つ。
export const AFTER_READ_SEC = 0.35;

// 答えの確認の長押しの時間（ミリ秒）。
export const REVEAL_HOLD_MS = 900;
// 答えを表示しておく時間（ミリ秒）。画面を触れば早く消せる。
export const REVEAL_SHOW_MS = 8000;

// 実験用のページで、重い操作の2回目の押下を待つ時間（ミリ秒）。この間に2回目を押さなければ元に戻る。
export const ARM_MS = 4000;
