// ==========================
// sw.js
// ==========================
// 回線が無い会場でも、ページを再読み込みしたり開き直したりできるようにするサービスワーカー。
// 取り方は「回線を先に試し、だめなら手元の写しを使う」。回線があるときは常に最新の版を取りに行くので、
// 更新した版が古い写しに隠れることはない。取れたファイルは写しを更新する。
// 外部の書体（Google Fonts）は写さない。読めなくても、端末の書体で崩れずに表示する。
// ==========================

const CACHE = "majikaruta-reader-v0.2.0";
const FILES = [
  "./",
  "index.html",
  "lab.html",
  "css/style.css",
  "css/lab.css",
  "js/config.js",
  "js/core.js",
  "js/audio.js",
  "js/flash.js",
  "js/ui.js",
  "js/storage.js",
  "js/app.js",
  "js/lab-core.js",
  "js/lab-storage.js",
  "js/lab-app.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("majikaruta-reader-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html"))),
  );
});
