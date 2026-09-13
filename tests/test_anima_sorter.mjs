import assert from "node:assert/strict";

import { buildDictionaryIndex, parsePrompt } from "../js/parser.js";
import { classifyAnimaToken, sortAnimaPrompt } from "../js/anima_sorter.js";

const index = buildDictionaryIndex([
  { english: "keqing (genshin impact)", chinese: "刻晴（原神）", category: "角色", verified: true },
  { english: "genshin impact", chinese: "原神", category: "作品", verified: true },
  { english: "long hair", chinese: "长发", category: "发型", verified: true },
  { english: "white background", chinese: "白色背景", category: "背景", verified: true },
  { english: "smile", chinese: "微笑", category: "表情", verified: true },
]);

const source = "white background, smile, long hair, @artist, genshin impact, keqing (genshin impact), 1girl, masterpiece, . She is holding a gift box.";
const result = sortAnimaPrompt(parsePrompt(source, index, new Map(), { mode: "tags" }));
assert.equal(result.text, "masterpiece, 1girl, keqing (genshin impact), genshin impact, @artist, long hair, smile, white background, . She is holding a gift box.");
assert.equal(result.uncertain.length, 0);
assert.equal(classifyAnimaToken(parsePrompt("2girls", index)[0]).slot, "people");

const segmented = sortAnimaPrompt(parsePrompt("white background, 1girl, BREAK, night, masterpiece", index, new Map(), { mode: "tags" }));
assert.equal(segmented.text, "1girl, white background\nBREAK\nmasterpiece, night");

console.log("anima sorter tests: OK");
