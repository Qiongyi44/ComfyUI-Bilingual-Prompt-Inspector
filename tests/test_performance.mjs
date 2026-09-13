import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import {
  analyzePromptSyntax,
  buildDictionaryIndex,
  detectInputMode,
  parsePrompt,
} from "../js/parser.js";


const prompt = Array.from({ length: 2000 }, (_, index) => `test_tag_${index}`).join(", ");
const dictionary = buildDictionaryIndex([]);
const started = performance.now();
const mode = detectInputMode(prompt);
const tokens = parsePrompt(prompt, dictionary);
const issues = analyzePromptSyntax(prompt, tokens, mode);
const elapsed = performance.now() - started;

assert.equal(mode.mode, "tags");
assert.equal(tokens.length, 2000);
assert.equal(issues.length, 0);
assert.ok(elapsed < 1000, `2000 项解析耗时过高：${elapsed.toFixed(1)} ms`);

console.log(`performance test: 2000 tags parsed in ${elapsed.toFixed(1)} ms`);
