// ==========================
// flash.js
// ==========================
// 音に合わせて画面を光らせる。公開版と実験用のページの両方が使う。
// - 公開版：「読む」の札をほのかに光らせる控えめな演出（耳が聞こえにくい人の助けにもなる）。
// - 実験用のページ：画面全体を黒くし、音の時刻にだけ光らせる。天井のカメラの映像と電子音を、あとで同期させるために使う。
// 点滅の時刻は、音の予約時刻を performance.now の時間軸に換算した値で決める（audio.js と core.js）。
// 描画は requestAnimationFrame の各コマで「いま光らせるべき色」を判定して行い、
// 画面が実際に光ったコマの時刻（requestAnimationFrame の時刻）を、点滅ごとに呼び出し元へ返す。
// 色をどう画面に出すかは、呼び出し元が apply で決める。
// ==========================

// 点滅を受け持つ物を作る。
// apply(color)：そのコマで出す色（光っていないときは base）を画面に反映する。
// base：光っていないときの色。公開版は null（何も出さない）、実験用のページは黒。
// onStart()、onStop()：点滅の始まりと終わりに呼ぶ（幕を出す、隠すなど）。
export function createFlasher({ apply, base = null, onStart = () => {}, onStop = () => {} }) {
  let rafId = 0;
  let items = [];
  let current;

  function tick(frameTime) {
    // requestAnimationFrame の時刻はそのコマの始まりを表す。半コマ（約8ミリ秒）手前から光らせ、
    // 実際に画面へ出る時刻が予約の時刻に近づくようにする。
    const now = performance.now();
    const t = Math.max(frameTime, now) + 8;
    let color = base;
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
    if (color !== current) {
      apply(color);
      current = color;
    }
    rafId = requestAnimationFrame(tick);
  }

  // 読みの点滅を始める。list の各要素は { startPerf, endPerf, color, onShown }。
  function run(list) {
    stop();
    items = list.map((x) => ({ ...x, shown: false }));
    onStart();
    apply(base);
    current = base;
    rafId = requestAnimationFrame(tick);
  }

  // 点滅を終える。
  function stop() {
    const wasRunning = rafId !== 0;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    items = [];
    current = undefined;
    if (wasRunning) {
      apply(null);
      onStop();
    }
  }

  return { run, stop, get running() { return rafId !== 0; } };
}
