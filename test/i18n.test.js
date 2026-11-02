// i18n.js（画面の文言の辞書と、言語の決め方）の検査（v0.4.0）。実行は /opt/homebrew/bin/node --test test/*.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DICT, LANGS, DEFAULT_LANG, translate, resolveLang, normalizeLang, langFromNavigator,
} from "../js/i18n.js";
import { RULE_KEYS, KIND_DEFS, T_LEVELS } from "../js/config.js";
import { ruleName, ruleSummary, cardLabel, buildHistoryView, roundT } from "../js/core.js";
import { RULES } from "../js/config.js";

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("日本語と英語の辞書で、鍵の集合が一致する（訳し漏れが無い）", () => {
  assert.deepEqual(LANGS, ["ja", "en"]);
  const ja = Object.keys(DICT.ja).sort();
  const en = Object.keys(DICT.en).sort();
  assert.deepEqual(en.filter((k) => !ja.includes(k)), [], "英語にだけある鍵");
  assert.deepEqual(ja.filter((k) => !en.includes(k)), [], "英語に無い鍵（訳し漏れ）");
});

test("どの文言も空でなく、差し込む値の名前が日本語と英語でそろっている", () => {
  for (const key of Object.keys(DICT.ja)) {
    for (const lang of LANGS) {
      assert.equal(typeof DICT[lang][key], "string", `${lang}:${key}`);
      assert.ok(DICT[lang][key].trim().length > 0, `${lang}:${key} が空`);
    }
    assert.deepEqual(placeholders(DICT.en[key]), placeholders(DICT.ja[key]), `${key} の {…} が食い違う`);
  }
});

test("英語の辞書に、日本語の文字が残っていない", () => {
  for (const [key, text] of Object.entries(DICT.en)) {
    assert.doesNotMatch(text, /[぀-ヿ㐀-鿿]/u, `en:${key}`);
  }
});

test("index.html の印が指す鍵は、すべて辞書にある", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const keys = new Set();
  for (const m of html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) keys.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    m[1].split(";").forEach((pair) => keys.add(pair.split(":")[1].trim()));
  }
  assert.ok(keys.size > 30);
  for (const k of keys) assert.ok(Object.hasOwn(DICT.ja, k), `辞書に無い鍵: ${k}`);
});

test("ルール、速さ、札の種類の文言が、両方の言語にある", () => {
  for (const lang of LANGS) {
    for (const k of RULE_KEYS) {
      assert.notEqual(ruleName(k, lang), `rule.${k}.name`);
      assert.notEqual(ruleSummary(k, lang), `rule.${k}.summary`);
    }
    for (const t of T_LEVELS) assert.ok(Object.hasOwn(DICT[lang], `speed.${roundT(t)}`));
    for (const d of KIND_DEFS) assert.ok(Object.hasOwn(DICT[lang], `kind.${d.key}`));
  }
  assert.equal(ruleName("standard", "en"), "Standard");
  assert.equal(ruleName("blank", "ja"), "空札あり");
  assert.equal(ruleName("unknown", "en"), "Standard");
});

test("translate は値を差し込み、無い鍵は日本語、さらに無ければ鍵そのものを返す", () => {
  assert.equal(translate("en", "read.sub", { n: 3 }), "Card 3");
  assert.equal(translate("ja", "read.sub", { n: 3 }), "3枚目");
  assert.equal(translate("en", "confirm.text", { n: 4, total: 12 }), "4 of 12 cards have been read.");
  assert.equal(translate("fr", "read.label"), translate(DEFAULT_LANG, "read.label"));
  assert.equal(translate("en", "no.such.key"), "no.such.key");
});

test("札の呼び名と履歴の label は、言語に合わせる", () => {
  assert.equal(cardLabel(7, 0, 1, "en"), "7");
  assert.equal(cardLabel(4, 0, 2, "en"), "Red 4");
  assert.equal(cardLabel(4, 1, 2, "ja"), "黒4");
  const v = buildHistoryView({ rule: RULES.redblack, reads: [{ value: 4, kind: 0 }, { value: 2, kind: 1 }], lastShown: true, lang: "en" });
  assert.deepEqual(v.sequence.map((s) => s.label), ["Red 4", "Black 2"]);
  assert.deepEqual(v.rows.map((r) => r.label), ["Red", "Black"]);
});

test("normalizeLang と langFromNavigator", () => {
  assert.equal(normalizeLang("en"), "en");
  assert.equal(normalizeLang("EN-us"), "en");
  assert.equal(normalizeLang("ja_JP"), "ja");
  assert.equal(normalizeLang("fr"), null);
  assert.equal(normalizeLang(""), null);
  assert.equal(normalizeLang(null), null);
  assert.equal(langFromNavigator("ja-JP"), "ja");
  assert.equal(langFromNavigator("ja"), "ja");
  assert.equal(langFromNavigator("en-US"), "en");
  assert.equal(langFromNavigator("fr-FR"), "en");
  assert.equal(langFromNavigator("jav"), "en");
  assert.equal(langFromNavigator(undefined), "en");
});

test("resolveLang は ?lang=、保存した選択、端末の言語の順に決める", () => {
  // ?lang= が最優先（配った英語版の URL を開いた人には英語を出す）
  assert.equal(resolveLang({ query: "?lang=en", stored: "ja", navLang: "ja-JP" }), "en");
  assert.equal(resolveLang({ query: "?x=1&lang=ja", stored: "en", navLang: "en-US" }), "ja");
  // ?lang= が無いか読めなければ、保存した選択
  assert.equal(resolveLang({ query: "", stored: "en", navLang: "ja-JP" }), "en");
  assert.equal(resolveLang({ query: "?lang=xx", stored: "ja", navLang: "en-US" }), "ja");
  // どちらも無ければ端末の言語（ja で始まれば日本語、それ以外は英語）
  assert.equal(resolveLang({ query: "", stored: null, navLang: "ja-JP" }), "ja");
  assert.equal(resolveLang({ query: "", stored: "garbage", navLang: "de-DE" }), "en");
  assert.equal(resolveLang({}), "en");
});
