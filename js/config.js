// ==========================
// config.js
// ==========================
// まじかるた読み上げアプリの定数を、この1か所にまとめる。
// 版の数字（APP_VERSION）もここだけで管理する。直したら必ず上げ、README の変更履歴に1行書く。
// このファイルはブラウザと node --test の両方から読み込むので、DOM に触れない。
// ==========================

export const APP_VERSION = "0.1.0";

// localStorage の鍵の接頭辞。形式を変えたら末尾の版を上げる。
export const STORAGE_PREFIX = "majikaruta-reader:v1:";

// 中山ワークショップの実験で使う電子音の間隔 t の5水準（秒）。
// 隣り合う水準の比が2倍の等比の並びである。
export const T_LEVELS = [0.1, 0.2, 0.4, 0.8, 1.6];

// 任意の値として受け付ける t の範囲（秒）。
export const T_MIN = 0.05;
export const T_MAX = 3.0;

// 現行の公式アプリ（unityroom の magikaruta）の電子音の間隔は、公開されている資料からは分からなかった。
// そのため、既定の t は 0.4 秒とする（README と報告に記した）。
export const DEFAULT_SETTINGS = {
  maxValue: 12,        // 読む値の範囲は 1〜maxValue。トランプの A〜K に合わせて 13 まで
  kinds: 1,            // 札の種類の数（1〜4）。同じ値が種類の数だけある
  blankRule: false,    // 空札のルールで遊ぶかどうか。読みには影響せず、記録と説明に使う
  tMode: "fixed",      // "fixed"（決めた t）または "random"（ゲームごとに5水準から無作為）
  tSec: 0.4,           // 電子音の間隔（秒）。tMode が "fixed" のときに使う
  prepGapSec: 1.0,     // 準備音の鳴り始めから最初の電子音の鳴り始めまでの間（秒）
  volume: 0.7,         // 音量（0〜1）
  flash: false,        // 音に合わせて画面を点滅させるかどうか
  flashKindColor: true,// 最後の点滅を種類の色にするかどうか（種類が2つ以上のとき）
  flashOffsetMs: 0,    // 点滅を音より遅らせる量（ミリ秒）。外付けのスピーカの遅れに合わせる
  bigInfo: false,      // ゲームの番号と t を大きく表示するかどうか
  label: "",           // 記録に付ける見出し（会場や端末の名前）
};

export const MAX_VALUE_MIN = 2;
export const MAX_VALUE_MAX = 13;
export const KINDS_MAX = 4;

// 電子音の高さと長さ。
// 通常の音と、種類が1つのときの最後の音は、同じ案件の収集Bのアプリ（collection-b-app）と同じ高さにそろえた。
// 紙のフリープレイ（収集A）とPCの実験（収集B）で、参加者が聞く音を同じにするためである。
export const AUDIO = {
  toneHz: 880,             // 通常の音（「ピン」）
  prepHz: 523.25,          // 準備音（ド。三角波で柔らかくする）
  prepDurationSec: 0.22,   // 準備音の長さ
  maxToneDurationSec: 0.08,// 通常の音の長さの上限。実際の長さは min(t/2, この値)
  lastDurationSec: 0.22,   // 最後の音の長さ。種類を聞き分けやすいように通常の音より長くする
  attackSec: 0.005,        // 立ち上がりの傾斜（クリック音を避ける）
  releaseSec: 0.012,       // 減衰の傾斜
  leadSec: 0.12,           // ボタンを押してから準備音までの余白（予約が過去にならないように）
};

// 札の種類。最後の音を「高さ（高・低）」と「音色（澄んだ正弦波・ざらついた矩形波）」の2つの性質の組み合わせで区別する。
// 種類が2つなら高さだけが違い、3つと4つでは音色も使う。
// 赤の札は高い音、黒の札は低い音にそろえ、トランプの4つの印に対応させた。
// 点滅の色は、遠くのカメラでも見分けやすいように、色相が大きく離れた鮮やかな色にした。
// 黒の札は黒では点滅させられないので、藍の青で点滅させる。
// 画面での呼び名は、種類が2つなら「赤」「黒」、3つ以上ならトランプの印（♥ハートなど）にする（core.js の kindLabel）。
export const KIND_DEFS = [
  { key: "heart",   name: "赤", suit: "♥", suitName: "ハート", lastHz: 1760, wave: "sine",   gainScale: 1.0, color: "#ff2a12", ink: "#c8321e" },
  { key: "spade",   name: "黒", suit: "♠", suitName: "スペード", lastHz: 440, wave: "sine",   gainScale: 1.0, color: "#1e50ff", ink: "#2b2723" },
  { key: "diamond", name: "ダイヤ", suit: "♦", suitName: "ダイヤ", lastHz: 1760, wave: "square", gainScale: 0.35, color: "#ffc400", ink: "#b8860b" },
  { key: "club",    name: "クラブ", suit: "♣", suitName: "クラブ", lastHz: 440, wave: "square", gainScale: 0.35, color: "#12b04a", ink: "#1f6b3c" },
];

// 点滅の色。夜の黒い地の上で光らせる。
export const FLASH = {
  baseColor: "#000000",   // 読んでいる間の地の色
  prepColor: "#8c8c8c",   // 準備音の点滅（灰色。明るさで通常の音と区別する）
  toneColor: "#ffffff",   // 通常の音の点滅（白）
  lastColor: "#ff2a12",   // 種類が1つのとき（または種類の色を使わないとき）の最後の音の点滅（朱）
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
