import assert from "node:assert/strict";

import { buildDictionaryIndex, detectInputMode, parsePrompt } from "../js/parser.js";


const dictionary = buildDictionaryIndex([
  { english: "masterpiece", chinese: "杰作", verified: true },
  { english: "best quality", chinese: "最佳质量", verified: true },
  { english: "1girl", chinese: "一名女性角色", verified: true },
  { english: "solo", chinese: "单人", verified: true },
  { english: "purple hair", chinese: "紫发", verified: true },
  { english: "purple eyes", chinese: "紫色眼睛", verified: true },
  { english: "night", chinese: "夜晚", verified: true },
  { english: "newest", chinese: "最新年代风格", verified: true },
]);

const cases = [
  {
    name: "纯标签",
    text: "masterpiece, best quality, 1girl, solo, purple hair, purple eyes, night, newest",
    mode: "tags",
  },
  {
    name: "纯自然语言",
    text: "She stands alone on the street after the rain and looks back at the camera.",
    mode: "natural",
  },
  {
    name: "多逗号自然语言",
    text: "A woman walks home after the rain, feeling tired and cold, carrying a small umbrella, while the city grows quiet.",
    mode: "natural",
  },
  {
    name: "短从句自然语言",
    text: "She came home, tired, cold, wet, alone, at night.",
    mode: "natural",
  },
  {
    name: "标签后白话",
    text: "masterpiece, best quality, 1girl, She stands beside the window with her hands folded, looking toward the garden.",
    mode: "mixed",
    naturalStart: 3,
    naturalAt: 3,
    afterTerm: null,
  },
  {
    name: "标签后白话且末尾逗号",
    text: "masterpiece, best quality, 1girl, She stands beside the window with her hands folded, looking toward the garden,",
    mode: "mixed",
    naturalStart: 3,
    naturalAt: 3,
    naturalEndsWithComma: true,
    afterTerm: null,
  },
  {
    name: "白话后标准标签",
    text: "She stands beside the window with her hands folded and looks toward the garden, masterpiece, best quality, 1girl, solo, night, newest",
    mode: "mixed",
    naturalStart: 0,
    naturalEnd: 1,
    naturalAt: 0,
    afterTerm: "masterpiece",
  },
  {
    name: "白话含逗号后接标签",
    text: "She stands alone after the rain, looking back at the camera, distant lights reflect on the wet ground, masterpiece, best quality, 1girl, solo, purple hair, newest",
    mode: "mixed",
    naturalStart: 0,
    naturalEnd: 3,
    naturalAt: 0,
    afterTerm: "masterpiece",
  },
  {
    name: "标签夹白话",
    text: "night, purple eyes, She stands alone after the rain, looking back at the camera, distant lights reflect on the wet ground, masterpiece, best quality, 1girl, solo, purple hair, newest",
    mode: "mixed",
    naturalStart: 2,
    naturalEnd: 5,
    naturalAt: 2,
    afterTerm: "masterpiece",
  },
  {
    name: "截图结构扩展",
    text: "night, purple eyes, Liyue Harbor, holding long sword, Keqing (Genshin Impact), lantern, black pantyhose, she stands alone on the stone-paved street after the rain, looking back at the camera, lights from distant shops reflected on the wet ground, best quality, dynamic pose, purple long hair, cinematic, 1girl, Genshin Impact, twintails, safe, masterpiece, rainy day, full body, dramatic lighting, newest",
    mode: "mixed",
    naturalStart: 7,
    naturalEnd: 10,
    naturalAt: 7,
    afterTerm: "best quality",
  },
  {
    name: "自然语言后不足四个标签不武断切分",
    text: "She waits beside the river while the last boat leaves, masterpiece, night, solo",
    mode: "natural",
  },
  {
    name: "自然语言后的短形容词列不误判",
    text: "She came home after walking through the storm, tired, cold, wet, alone, at night.",
    mode: "natural",
  },
];

for (const test of cases) {
  const mode = detectInputMode(test.text);
  assert.equal(mode.mode, test.mode, `${test.name}：模式`);
  if (test.naturalStart !== undefined) assert.equal(mode.naturalStart, test.naturalStart, `${test.name}：白话起点`);
  if (test.naturalEnd !== undefined) assert.equal(mode.naturalEnd, test.naturalEnd, `${test.name}：白话终点`);
  if (test.naturalAt !== undefined) {
    const tokens = parsePrompt(test.text, dictionary);
    assert.equal(tokens[test.naturalAt].segmentKind, "natural", `${test.name}：白话块`);
    if (test.naturalEndsWithComma) assert.equal(tokens[test.naturalAt].raw.trim().endsWith(","), true, `${test.name}：保留末尾逗号`);
    if (test.afterTerm) assert.equal(tokens[test.naturalAt + 1].term, test.afterTerm, `${test.name}：恢复后续标签`);
  }
}

const prefixes = [
  [],
  ["night", "purple eyes"],
  ["masterpiece", "1girl", "solo", "purple hair"],
];
const naturalBodies = [
  ["She stands alone on the street after the rain and looks back at the camera"],
  ["She stands alone after the rain", "looking back at the camera"],
  ["She stands alone after the rain", "looking back at the camera", "distant shop lights reflect on the wet ground"],
];
const suffixes = [
  ["masterpiece", "best quality", "1girl", "solo"],
  ["purple hair", "purple eyes", "night", "newest"],
  ["dynamic pose", "cinematic", "1girl", "safe", "dramatic lighting"],
];

let permutationCount = 0;
for (const prefix of prefixes) {
  for (const natural of naturalBodies) {
    for (const suffix of suffixes) {
      const text = [...prefix, ...natural, ...suffix].join(", ");
      const mode = detectInputMode(text);
      assert.equal(mode.mode, "mixed", `排列测试 ${permutationCount}：模式`);
      assert.equal(mode.naturalStart, prefix.length, `排列测试 ${permutationCount}：白话起点`);
      assert.equal(mode.naturalEnd, prefix.length + natural.length, `排列测试 ${permutationCount}：白话终点`);
      const tokens = parsePrompt(text, dictionary);
      assert.equal(tokens[prefix.length].segmentKind, "natural", `排列测试 ${permutationCount}：白话块`);
      assert.equal(tokens[prefix.length + 1].term, suffix[0], `排列测试 ${permutationCount}：后续首标签`);
      permutationCount += 1;
    }
  }
}

console.log(`mixed boundary tests: ${cases.length + permutationCount} cases OK`);
