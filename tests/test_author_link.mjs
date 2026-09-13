import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../js/bilingual_prompt.js", import.meta.url), "utf8");

assert.match(source, /const AUTHOR_URL = "https:\/\/space\.bilibili\.com\/697555747";/);
assert.doesNotMatch(source, /spm_id_from/);
assert.match(source, /"关于作者"/);
assert.match(source, /"访问作者社区主页 ↗"/);
assert.match(source, /authorLink\.target = "_blank";/);
assert.match(source, /authorLink\.rel = "noopener noreferrer";/);
assert.match(source, /authorLink\.referrerPolicy = "no-referrer";/);
assert.match(source, /"bpi-about-footer"/);

console.log("author link tests passed");
