import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../js/bilingual_prompt.js", import.meta.url), "utf8");

assert.match(source, /const PREFERENCES_KEY = "bpi\.dictionary\.preferences\.v1";/);
assert.doesNotMatch(source, /hideNativeEnglishWidget/);
assert.doesNotMatch(source, /options\.hidden\s*=\s*true/);
assert.match(source, /clearButtonLabel\(state\.englishClearState\)/);
assert.match(source, /再次点击“确认清空”才会清空英文实际输出/);
assert.match(source, /已撤销英文清空/);
assert.doesNotMatch(source, /clearChineseButton|clearChineseDraft|chineseClearState/);

console.log("clear controls tests passed");
