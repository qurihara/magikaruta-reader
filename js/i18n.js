// ==========================
// i18n.js
// ==========================
// 公開版（index.html）の画面の文言を、日本語と英語の辞書としてこの1か所にまとめる（v0.4.0）。
// HTML の側は data-i18n などの印で鍵を指し、app.js の applyI18n が辞書の文言で差し替える。文言を HTML に直接は書かない。
// 実験用のページ（lab.html）は日本語のままで、この辞書を使わない。
// このファイルはブラウザと node --test の両方から読み込むので、DOM に触れない（test/i18n.test.js で検査する）。
//
// 文言の中の {name} は、translate に渡した params の値で置き換える。
// 鍵の末尾が ".html" の文言だけは HTML として差し込む（辞書の中に書いた固定の文字列なので、外から入る値は含まない）。
//
// 英語の用語の対応（2026-11-02 の決定。英語の題名は MagiKaruta）。
//   札 → card、自陣 → your side、敵陣 → your opponent's side、空札 → dead card、お手つき → fault、
//   送り札 → send one of your cards to the opponent、電子音 → beep、準備音 → cue tone、
//   電子音の間隔 → beep interval、いつものルール → Standard、空札あり → Dead card、赤と黒 → Red & Black。
// ==========================

export const LANGS = ["ja", "en"];
export const DEFAULT_LANG = "ja";

// 使う人がまだ言語を選んでいないときの既定。端末の言語が ja で始まれば日本語、それ以外は英語にする。
export function langFromNavigator(navLang) {
  return typeof navLang === "string" && /^ja\b/i.test(navLang.trim()) ? "ja" : "en";
}

// 文字列を "ja" か "en" にそろえる。"en-US" や "JA" も受け付ける。知らない値なら null を返す。
export function normalizeLang(value) {
  if (typeof value !== "string") return null;
  const head = value.trim().toLowerCase().split(/[-_]/)[0];
  return LANGS.includes(head) ? head : null;
}

// 言語を決める。URL の ?lang= の指定を最優先し、次に localStorage に保存した選択、最後に端末の言語を使う。
// ?lang= を最優先にするのは、配った英語版の URL（?lang=en）を開いた人に、以前の選択に関わらず英語を出すためである。
// query は location.search の文字列（"?lang=en" など）、stored は保存してあった値、navLang は navigator.language。
export function resolveLang({ query = "", stored = null, navLang = "" } = {}) {
  let fromQuery = null;
  try {
    fromQuery = normalizeLang(new URLSearchParams(query || "").get("lang"));
  } catch (_) { /* 読めない URL は無視する */ }
  return fromQuery || normalizeLang(stored) || langFromNavigator(navLang);
}

// 辞書を引く。指定の言語に鍵が無ければ日本語の文言を使い、それも無ければ鍵そのものを返す（訳し漏れが画面で分かるように）。
export function translate(lang, key, params = {}) {
  const table = DICT[lang] || DICT[DEFAULT_LANG];
  let text = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : DICT[DEFAULT_LANG][key];
  if (typeof text !== "string") return key;
  for (const [name, value] of Object.entries(params)) {
    text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

// --------------------------
// 辞書
// --------------------------

const JA = {
  // ページ
  "meta.title": "まじかるた 読み上げ",
  "meta.description": "まじかるたの読み上げアプリ。電子音の回数で札の値を、最後の高い音で読みの終わりを伝えます。",
  "lang.group": "言語",

  // 最初の画面
  "splash.kicker": "ことばを外し、戦略を残す",
  "app.name": "まじかるた",
  "app.sub": "読み上げ",
  "splash.lead": "読み手の代わりに電子音を鳴らします。鳴った回数が読まれた札の値で、最後の1回だけ高い音です。",
  "splash.start": "はじめる",
  "splash.silent.html": "<strong>iPhone・iPad</strong>：本体の消音スイッチ（着信／消音）を切り、音量ボタンで音量を上げてください。消音のままだと電子音が鳴らないことがあります。",
  "splash.wake": "画面が消えないようにします（対応していない端末では、画面の自動消灯の設定を長めにしてください）。",

  // 本体の画面の上部と、ルールと速さの札
  "top.rules": "遊び方",
  "top.settings": "ルールと速さ",
  "plate.aria": "ルールと速さを変える",
  "plate.rule": "ルール",
  "plate.speed": "電子音の間隔",
  "plate.every": "{t} 秒ごと",

  // 読んだ札と履歴
  "count.label": "読んだ札",
  "count.of": "／{total}枚",
  "hist.aria": "読まれた札の履歴",
  "hist.seqKey": "読んだ順",
  "hist.empty": "まだありません",
  "hist.pending": "？",
  "hist.pendingAria": "直前の読み（まだ載せていない）",
  "hist.noteNext": "直前の読みは、次を読むか、答えを確かめると加わります。",
  "hist.noteLast": "最後の読みは、答えを確かめると加わります。",
  "hist.cellRead": "{card}：{order}番目に読んだ",
  "hist.cellUnread": "{card}：まだ読んでいない",
  "card.withKind": "{kind}{value}",

  // 状態の文と注意
  "status.first": "「読む」を押すと、準備音のあとに電子音が鳴ります。",
  "status.next": "札を取り終えたら、次を読みます。",
  "status.reading": "{n}枚目を読んでいます。",
  "status.done": "全部の札を読み終えました。押すと次のゲームを始めます。",
  "status.audioFailed": "音を出せませんでした。もう一度押してください。",
  "status.newGame": "新しいゲームを用意しました。",
  "status.ruleChanged": "{rule}で新しいゲームを始めます。",
  "status.speedChanged": "電子音の間隔を {t} 秒（{word}）にしました。",
  "status.holdHint": "答えは、ボタンを長押しすると表示します。",
  "notice.apple": "音が出ないときは、消音スイッチを切り、音量ボタンで音量を上げてください。",

  // ボタン
  "read.label": "読む",
  "read.sub": "{n}枚目",
  "read.readingLabel": "読んでいます",
  "read.readingSub": "音を聞いてください",
  "read.doneLabel": "新しいゲーム",
  "read.doneSub": "{total}枚を読み終えました",
  "reveal.button": "答えを確かめる",
  "reveal.hint": "長押し",
  "newGame.button": "新しいゲーム",
  "common.close": "閉じる",

  // 答えの表示
  "reveal.titleDefault": "直前の読み",
  "reveal.title": "{n}枚目の読み",
  "reveal.face": "（{face}）",
  "reveal.histTitle": "このゲームで読んだ順",
  "reveal.histItem": "{value}{kind}",
  "reveal.closeHint": "画面を触ると閉じます",

  // 遊び方
  "rules.title": "遊び方",
  "rules.video.html": "ルールを映像でも説明しています（3分、音が出ます）。<a href=\"video/majikaruta-rules.mp4\" target=\"_blank\" rel=\"noopener\">ルール紹介の映像を見る</a>",
  "rules.tab.basic": "いつものルール",
  "rules.tab.blank": "空札あり",
  "rules.tab.t": "電子音の間隔",
  "rules.tab.redblack": "赤と黒",
  "rules.basic.html":
    "<h3>いつものルール（1〜12、空札なし）</h3>"
    + "<ol>"
    + "<li>1から12の数字が書かれた札を12枚用意します（トランプの A〜Q でも遊べます）。</li>"
    + "<li>よく混ぜて配ります。2人なら6枚ずつです。数字を表にして、自分の前に並べます（自陣）。相手の手が届く位置に置きます。</li>"
    + "<li>最初の音が鳴るまでは、手を札に乗せずに待ちます。</li>"
    + "<li>「読む」を押すと、準備音のあとに「ピン」が1〜12回鳴ります。最後の1回だけ高い音です。鳴った回数と同じ数字の札を取ります。</li>"
    + "<li>先に札に触れた人がその札を取ります。相手の陣の札を取ったら、自分の陣の札を1枚相手に送ります。</li>"
    + "<li>自分の陣の札が先に無くなった人の勝ちです。アプリは同じ値を2回読みません。</li>"
    + "</ol>"
    + "<p class=\"aside\">同時に触れたときは、その札が置かれていた陣の人の取りとします。どちらが先かは、遊ぶ人どうしで決めます。</p>",
  "rules.blank.html":
    "<h3>空札あり（1〜13を読む）</h3>"
    + "<p>使わない札（空札）を混ぜると、「残りの札を全部払えば取れる」場面が減り、最後の音まで聞く駆け引きが増えます。</p>"
    + "<ol>"
    + "<li>1から13の札を13枚用意し、よく混ぜて2人に6枚ずつ配ります。</li>"
    + "<li>残った1枚は、誰にも見せずに伏せたまま脇へ置きます。これが空札です。</li>"
    + "<li>アプリは、どの値が空札かを知りません。13の値をすべて、無作為の順に読みます。</li>"
    + "<li>空札の値が読まれたら、誰も札に触れてはいけません。触れたらお手つきで、相手から札を1枚送られます。</li>"
    + "</ol>",
  "rules.t.title": "電子音の間隔",
  "rules.t.lead": "電子音の鳴り始めから次の鳴り始めまでの秒数を、「ルールと速さ」で5つから選べます。",
  "rules.t.after": "間隔が長いほど、音を数えながら候補の札へ手を動かす余裕が生まれます。短いと、最後の音を聞いてから取る勝負に近づきます。",
  "rules.t.legend": "{word}：{t} 秒ごと",
  "rules.t.default": "（はじめの設定）",
  "rules.redblack.html":
    "<h3>赤と黒（ほかの遊び方）</h3>"
    + "<p>赤の1〜6と黒の1〜6の、12枚で遊びます（トランプの♥と♠の A〜6 でも遊べます）。同じ数字の札が、赤と黒の2枚ずつあります。</p>"
    + "<p>鳴った回数で数字を、最後の音の高さで色を聞き分けて取ります。</p>"
    + "<ul class=\"kind-legend\">"
    + "<li style=\"--kind: #c8321e\"><span class=\"sw\"></span><b>赤</b><span class=\"d\">最後の音が高い（ふつうの音の1オクターブ上）</span></li>"
    + "<li style=\"--kind: #2b2723\"><span class=\"sw\"></span><b>黒</b><span class=\"d\">最後の音が低い（ふつうの音の1オクターブ下）</span></li>"
    + "</ul>"
    + "<p>最後の音が鳴るまでは色が分からないので、数字が絞れても、まだ取れないことがあります。「ルールと速さ」の「音を確かめる」で、2つの音を聞き比べられます。</p>",

  // ルールと速さ
  "settings.title": "ルールと速さ",
  "settings.rules": "ルール",
  "settings.other": "ほかの遊び方",
  "settings.speed": "電子音の間隔",
  "settings.speedHelp": "電子音の鳴り始めから次の鳴り始めまでの秒数です。",
  "settings.seconds": "{t} 秒",
  "settings.soundCheck": "音を確かめる",
  "settings.soundCheckHelp": "準備音、ふつうの音、最後の高い音の順に鳴ります。",
  "settings.soundCheckHelpKinds": "準備音、ふつうの音のあと、赤の最後の音（高い）と黒の最後の音（低い）が鳴ります。",
  "settings.applyRule": "ルールを変えると、いまのゲームを打ち切って新しいゲームを始めます。",
  "settings.applySpeed": "電子音の間隔は、次に読む札から変わります。",
  "settings.cancel": "やめる",
  "settings.save": "決める",

  // ルールの名前と要約、速さの言葉、札の種類
  "rule.standard.name": "いつものルール",
  "rule.standard.summary": "1〜12 の12枚・空札なし",
  "rule.blank.name": "空札あり",
  "rule.blank.summary": "1〜13 を読む・6枚ずつ配り、1枚は空札",
  "rule.redblack.name": "赤と黒",
  "rule.redblack.summary": "赤の1〜6と黒の1〜6の12枚・最後の音の高さで色を伝える",
  "speed.0.1": "とても速い",
  "speed.0.2": "速い",
  "speed.0.4": "ふつう",
  "speed.0.8": "ゆっくり",
  "speed.1.6": "とてもゆっくり",
  "kind.red": "赤",
  "kind.black": "黒",

  // 新しいゲームの確認
  "confirm.title": "いまのゲームを打ち切りますか",
  "confirm.textDefault": "まだ読んでいない札があります。",
  "confirm.text": "{total}枚のうち {n}枚を読んだところです。",
  "confirm.keep": "続ける",
  "confirm.new": "打ち切って新しいゲーム",
};

const EN = {
  // Page
  "meta.title": "MagiKaruta Reader",
  "meta.description": "A reader app for MagiKaruta. Beeps tell you the number on the card, and a higher last beep marks the end of each reading.",
  "lang.group": "Language",

  // Start screen
  "splash.kicker": "Strip the words, keep the strategy.",
  "app.name": "MagiKaruta",
  "app.sub": "Reader",
  "splash.lead": "The app reads the cards for you with beeps. The number of beeps is the number on the card, and only the last beep is higher.",
  "splash.start": "Start",
  "splash.silent.html": "<strong>iPhone / iPad</strong>: turn off the silent switch (Ring/Silent) and turn up the volume with the volume buttons. In silent mode, the beeps may not play.",
  "splash.wake": "The screen will stay on while you play. (If your device doesn't support this, set a longer auto-lock time.)",

  // Top bar and the rules-and-speed plate
  "top.rules": "How to play",
  "top.settings": "Rules & speed",
  "plate.aria": "Change rules and speed",
  "plate.rule": "Rules",
  "plate.speed": "Beep interval",
  "plate.every": "every {t} s",

  // Cards read and history
  "count.label": "Cards read",
  "count.of": "/ {total}",
  "hist.aria": "Cards read so far",
  "hist.seqKey": "Order",
  "hist.empty": "None yet",
  "hist.pending": "?",
  "hist.pendingAria": "Last card read (hidden for now)",
  "hist.noteNext": "The last card read appears here after you read the next card or check the answer.",
  "hist.noteLast": "The last card appears here after you check the answer.",
  "hist.cellRead": "{card}: read #{order}",
  "hist.cellUnread": "{card}: not read yet",
  "card.withKind": "{kind} {value}",

  // Status messages and notices
  "status.first": "Press Read. A cue tone plays, then the beeps.",
  "status.next": "Once the card has been taken, read the next one.",
  "status.reading": "Reading card {n}…",
  "status.done": "All cards have been read. Press to start the next game.",
  "status.audioFailed": "Couldn't play sound. Please press again.",
  "status.newGame": "A new game is ready.",
  "status.ruleChanged": "Starting a new game: {rule}.",
  "status.speedChanged": "Beep interval set to {t} s ({word}).",
  "status.holdHint": "Press and hold the button to see the answer.",
  "notice.apple": "No sound? Turn off the silent switch and turn up the volume.",

  // Buttons
  "read.label": "Read",
  "read.sub": "Card {n}",
  "read.readingLabel": "Reading",
  "read.readingSub": "Listen to the beeps",
  "read.doneLabel": "New game",
  "read.doneSub": "All {total} cards read",
  "reveal.button": "Check answer",
  "reveal.hint": "hold",
  "newGame.button": "New game",
  "common.close": "Close",

  // Answer
  "reveal.titleDefault": "Last card read",
  "reveal.title": "Card {n}",
  "reveal.face": " ({face})",
  "reveal.histTitle": "Order read this game",
  "reveal.histItem": "{kind} {value}",
  "reveal.closeHint": "Tap anywhere to close",

  // How to play
  "rules.title": "How to play",
  "rules.video.html": "A video explains the rules too (3 min, with sound). <a href=\"video/majikaruta-rules.mp4\" target=\"_blank\" rel=\"noopener\">Rules video (in Japanese)</a>",
  "rules.tab.basic": "Standard",
  "rules.tab.blank": "Dead card",
  "rules.tab.t": "Beep interval",
  "rules.tab.redblack": "Red & Black",
  "rules.basic.html":
    "<h3>Standard rules (1–12, no dead card)</h3>"
    + "<ol>"
    + "<li>Prepare 12 cards numbered 1 to 12. Playing cards A to Q work too (A&nbsp;=&nbsp;1, J&nbsp;=&nbsp;11, Q&nbsp;=&nbsp;12).</li>"
    + "<li>Shuffle and deal. With two players, each gets 6 cards. Lay your cards face up in front of you: this is your side. Place them where your opponent can reach them.</li>"
    + "<li>Keep your hands off the cards until the first beep.</li>"
    + "<li>Press Read. After a cue tone, the app beeps 1 to 12 times; only the last beep is higher. Take the card whose number matches the number of beeps.</li>"
    + "<li>Whoever touches the card first takes it. If you take a card from your opponent's side, send one of your cards to the opponent.</li>"
    + "<li>The first player to clear all the cards from their side wins. The app never reads the same number twice in a game.</li>"
    + "</ol>"
    + "<p class=\"aside\">If both players touch the card at the same moment, it goes to the player on whose side it was. Players decide between themselves who was first.</p>",
  "rules.blank.html":
    "<h3>Dead card (1–13 are read)</h3>"
    + "<p>Mixing in a card that isn't in play makes it harder to win by simply sweeping the remaining cards, so it pays to listen all the way to the last beep.</p>"
    + "<ol>"
    + "<li>Prepare 13 cards numbered 1 to 13 (or playing cards A to K: A&nbsp;=&nbsp;1, J&nbsp;=&nbsp;11, Q&nbsp;=&nbsp;12, K&nbsp;=&nbsp;13). Shuffle and deal 6 cards to each of the two players.</li>"
    + "<li>Put the one card left over aside, face down, without showing anyone. This is the dead card (a number not on the table).</li>"
    + "<li>The app doesn't know which number is the dead card. It reads all 13 numbers in random order.</li>"
    + "<li>When the dead card's number is read, nobody may touch any card. Touching a card on either your side or your opponent's side is a fault (a penalty for touching when you shouldn't): your opponent sends you one of their cards.</li>"
    + "</ol>",
  "rules.t.title": "Beep interval",
  "rules.t.lead": "In Rules & speed, you can choose from five settings for the time from the start of one beep to the start of the next.",
  "rules.t.after": "The longer the interval, the more time you have to move your hand toward likely cards while counting. The shorter it is, the more the game becomes a race to grab the card after the last beep.",
  "rules.t.legend": "{word}: every {t} s",
  "rules.t.default": " (default)",
  "rules.redblack.html":
    "<h3>Red &amp; Black (another way to play)</h3>"
    + "<p>Play with 12 cards: red 1 to 6 and black 1 to 6 (or playing cards ♥ and ♠, A to 6). Each number has two cards, one red and one black.</p>"
    + "<p>Count the beeps for the number, and listen to the pitch of the last beep for the color.</p>"
    + "<ul class=\"kind-legend\">"
    + "<li style=\"--kind: #c8321e\"><span class=\"sw\"></span><b>Red</b><span class=\"d\">The last beep is high (an octave above the normal beep)</span></li>"
    + "<li style=\"--kind: #2b2723\"><span class=\"sw\"></span><b>Black</b><span class=\"d\">The last beep is low (an octave below the normal beep)</span></li>"
    + "</ul>"
    + "<p>You can't tell the color until the last beep, so even when you've narrowed down the number, you may not be able to take a card yet. Use “Test sound” in Rules &amp; speed to compare the two tones.</p>",

  // Rules & speed
  "settings.title": "Rules & speed",
  "settings.rules": "Rules",
  "settings.other": "Other ways to play",
  "settings.speed": "Beep interval",
  "settings.speedHelp": "Seconds from the start of one beep to the start of the next.",
  "settings.seconds": "{t} s",
  "settings.soundCheck": "Test sound",
  "settings.soundCheckHelp": "Plays the cue tone, a normal beep, then the high last beep.",
  "settings.soundCheckHelpKinds": "Plays the cue tone and a normal beep, then the red last beep (high) and the black last beep (low).",
  "settings.applyRule": "Changing the rules ends the current game and starts a new one.",
  "settings.applySpeed": "A new beep interval takes effect from the next card.",
  "settings.cancel": "Cancel",
  "settings.save": "Save",

  // Rule names and summaries, speed words, card colors
  "rule.standard.name": "Standard",
  "rule.standard.summary": "12 cards, 1–12, no dead card",
  "rule.blank.name": "Dead card",
  "rule.blank.summary": "Reads 1–13; deal 6 each, one card is dead",
  "rule.redblack.name": "Red & Black",
  "rule.redblack.summary": "12 cards: red 1–6 and black 1–6; the last beep's pitch tells the color",
  "speed.0.1": "Very fast",
  "speed.0.2": "Fast",
  "speed.0.4": "Normal",
  "speed.0.8": "Slow",
  "speed.1.6": "Very slow",
  "kind.red": "Red",
  "kind.black": "Black",

  // New game confirmation
  "confirm.title": "End the current game?",
  "confirm.textDefault": "Some cards haven't been read yet.",
  "confirm.text": "{n} of {total} cards have been read.",
  "confirm.keep": "Keep playing",
  "confirm.new": "End and start a new game",
};

export const DICT = { ja: JA, en: EN };
