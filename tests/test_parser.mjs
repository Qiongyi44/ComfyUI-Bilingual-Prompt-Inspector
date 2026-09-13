import assert from "node:assert/strict";

import {
  analyzePromptSyntax,
  analyzeSegment,
  buildDictionaryIndex,
  detectInputMode,
  extractInstructionBody,
  parsePrompt,
  removePromptToken,
  replacePromptTokenWeight,
  splitMixedText,
  splitNaturalText,
  splitPrompt,
  tokenForSelection,
  validateTranslationResult,
} from "../js/parser.js";


const source = "masterpiece, (looking at viewer:1.2), <lora:test:0.8>\nBREAK, hand_on_hip";
const dictionary = buildDictionaryIndex([
  { english: "masterpiece", chinese: "杰作", verified: true },
  { english: "looking at viewer", chinese: "看向镜头", verified: true },
  { english: "hand on hip", chinese: "叉腰", verified: true },
]);
const parsed = parsePrompt(source, dictionary);

assert.equal(parsed.length, 5);
assert.equal(parsed[1].weight, 1.2);
assert.equal(parsed[1].chinese, "看向镜头");
assert.equal(parsed[2].status, "special");
assert.equal(parsed[3].chinese, "提示词分段");
assert.equal(parsed[4].chinese, "叉腰");
assert.equal(analyzeSegment("((smile))").term, "smile");
assert.deepEqual(splitPrompt("(red hair, blue eyes:1.1), solo").map((item) => item.raw.trim()), [
  "(red hair, blue eyes:1.1)",
  "solo",
]);
assert.equal(validateTranslationResult("8K", "8K").ok, true);
assert.equal(validateTranslationResult("realistic", "写实").ok, true);
assert.equal(validateTranslationResult("8K", "8K, ultra detailed, HDR").ok, false);
assert.equal(validateTranslationResult("smile", "(smile:1.4)").ok, false);
assert.equal(validateTranslationResult("smile", "译文：微笑").ok, false);
assert.equal(validateTranslationResult("smile", "微笑\n更多内容").ok, false);
assert.equal(
  validateTranslationResult(
    "An adult woman sits on a bed.",
    "一名成年女性坐在床上，双手放在身体两侧。",
    { naturalLanguage: true },
  ).ok,
  true,
);
assert.equal(validateTranslationResult("vagina", "阴道，女性生殖器").ok, false);
assert.equal(validateTranslationResult("The vagina is visible.", "阴道清晰可见，画面为成人内容。", { naturalLanguage: true }).ok, true);

assert.equal(detectInputMode("masterpiece, best quality, 1girl").mode, "tags");
assert.equal(detectInputMode("A woman is standing in the rain.").mode, "natural");
const mixedSource = "masterpiece, best quality, 1girl, nahida (genshin impact), white hair, looking up, Nahida sits on the edge of the bed in a bedroom, asking for a hug.";
const mixedMode = detectInputMode(mixedSource);
assert.equal(mixedMode.mode, "mixed");
const mixedSegments = splitMixedText(mixedSource, mixedMode.naturalStart);
assert.equal(mixedSegments.length, 7);
assert.equal(mixedSegments.at(-1).segmentKind, "natural");
assert.equal(mixedSegments.at(-1).raw.trim(), "Nahida sits on the edge of the bed in a bedroom, asking for a hug.");
const mixedTokens = parsePrompt(mixedSource, dictionary);
assert.equal(mixedTokens.length, 7);
assert.equal(mixedTokens[0].term, "masterpiece");
assert.equal(mixedTokens.at(-1).chinese, "自然语言片段（待翻译或确认）");

const naturalThenTags = "she stands alone on the stone-paved street after the rain, looking back at the camera, lights from distant shops reflected on the wet ground, best quality, dynamic pose, purple long hair, cinematic, 1girl, Genshin Impact, twintails, safe, masterpiece, rainy day, full body, dramatic lighting, newest";
const naturalThenTagsMode = detectInputMode(naturalThenTags);
assert.equal(naturalThenTagsMode.mode, "mixed");
assert.equal(naturalThenTagsMode.naturalStart, 0);
assert.equal(naturalThenTagsMode.naturalEnd, 3);
const naturalThenTagsTokens = parsePrompt(naturalThenTags, dictionary);
assert.equal(naturalThenTagsTokens[0].segmentKind, "natural");
assert.equal(naturalThenTagsTokens[0].term, "she stands alone on the stone-paved street after the rain, looking back at the camera, lights from distant shops reflected on the wet ground");
assert.equal(naturalThenTagsTokens[1].term, "best quality");
assert.equal(naturalThenTagsTokens.at(-1).term, "newest");

const tagsAroundNatural = "night, purple eyes, Liyue Harbor, holding long sword, Keqing (Genshin Impact), lantern, black pantyhose, she stands alone on the stone-paved street after the rain, looking back at the camera, lights from distant shops reflected on the wet ground, best quality, dynamic pose, purple long hair, cinematic, 1girl, Genshin Impact, twintails, safe, masterpiece, rainy day, full body, dramatic lighting, newest";
const tagsAroundMode = detectInputMode(tagsAroundNatural);
assert.equal(tagsAroundMode.mode, "mixed");
assert.equal(tagsAroundMode.naturalStart, 7);
assert.equal(tagsAroundMode.naturalEnd, 10);
const tagsAroundTokens = parsePrompt(tagsAroundNatural, dictionary);
assert.equal(tagsAroundTokens.length, 21);
assert.equal(tagsAroundTokens[6].term, "black pantyhose");
assert.equal(tagsAroundTokens[7].segmentKind, "natural");
assert.equal(tagsAroundTokens[8].term, "best quality");
assert.equal(tagsAroundTokens.at(-1).term, "newest");

const commaRichNatural = "A woman walks home after the rain, feeling tired and cold, carrying a small umbrella, while the city grows quiet.";
assert.equal(detectInputMode(commaRichNatural).mode, "natural");
const shortClauseNatural = "She came home, tired, cold, wet, alone, at night.";
assert.equal(detectInputMode(shortClauseNatural).mode, "natural");
const tagOnlySuffixLike = "masterpiece, best quality, 1girl, purple hair, purple eyes, solo, night, newest";
assert.equal(detectInputMode(tagOnlySuffixLike).mode, "tags");
const trailingCommaMixed = "masterpiece, best quality, 1girl, night, bedroom, An adult woman sits beside the window with her hands folded, looking toward the garden, while warm light fills the room,";
const trailingCommaMode = detectInputMode(trailingCommaMixed);
assert.equal(trailingCommaMode.mode, "mixed");
const trailingCommaTokens = parsePrompt(trailingCommaMixed, dictionary);
assert.equal(trailingCommaTokens.length, 6);
assert.equal(trailingCommaTokens.at(-1).segmentKind, "natural");
assert.equal(
  trailingCommaTokens.at(-1).raw.trim(),
  "An adult woman sits beside the window with her hands folded, looking toward the garden, while warm light fills the room,",
);
assert.equal(analyzePromptSyntax(trailingCommaMixed, trailingCommaTokens, trailingCommaMode).some((item) => item.code === "empty-tag"), false);
assert.equal(analyzePromptSyntax("masterpiece, best quality,", parsePrompt("masterpiece, best quality,", dictionary)).some((item) => item.code === "empty-tag"), true);
assert.equal(
  detectInputMode("masterpiece, best quality, 1girl, standing cheerfully in a festive outfit, holding a gift box with both hands").mode,
  "tags",
);
assert.equal(detectInputMode("A woman sits on a bed, asking for a hug.").mode, "natural");
assert.equal(detectInputMode("whatever", "natural").reason, "手动指定");
const instructed = "翻译要求：转换为 Anima 标签\n正文：一位成年女性站在雨中";
assert.equal(detectInputMode(instructed).mode, "instruction");
assert.equal(extractInstructionBody(instructed).body, "一位成年女性站在雨中");
assert.equal(extractInstructionBody("帮我翻译成英文：一位女性站立").format, "prefix");
assert.equal(splitNaturalText("First sentence. Second sentence!").length, 2);

const removable = parsePrompt("masterpiece, best quality, solo", dictionary);
assert.deepEqual(removePromptToken("masterpiece, best quality, solo", removable[1]), {
  text: "masterpiece, solo",
  cursor: 12,
  changed: true,
});
assert.equal(removePromptToken("masterpiece, best quality, solo", removable[0]).text, "best quality, solo");
assert.equal(removePromptToken("masterpiece, best quality, solo", removable[2]).text, "masterpiece, best quality");
const multiline = parsePrompt("masterpiece,\nbest quality,\nsolo", dictionary);
assert.equal(removePromptToken("masterpiece,\nbest quality,\nsolo", multiline[1]).text, "masterpiece,\nsolo");
assert.equal(tokenForSelection(removable, removable[1].start + 1)?.term, "best quality");
assert.equal(tokenForSelection(removable, removable[2].start, removable[2].end)?.term, "solo");
const duplicateSource = "solo, solo, 1girl";
const duplicateTokens = parsePrompt(duplicateSource, dictionary);
assert.equal(removePromptToken(duplicateSource, duplicateTokens[1]).text, "solo, 1girl");
assert.equal(tokenForSelection(duplicateTokens, duplicateTokens[1].start + 1)?.id, duplicateTokens[1].id);
const crlfSource = "masterpiece,\r\nbest quality,\r\nsolo";
const crlfTokens = parsePrompt(crlfSource, dictionary);
assert.equal(removePromptToken(crlfSource, crlfTokens[1]).text, "masterpiece,\r\nsolo");
assert.deepEqual(removePromptToken("solo", null), { text: "solo", cursor: 4, changed: false });

const weightSource = "masterpiece, best quality, solo";
const weightTokens = parsePrompt(weightSource, dictionary);
assert.deepEqual(replacePromptTokenWeight(weightSource, weightTokens[1], 1.2), {
  text: "masterpiece, (best quality:1.2), solo",
  cursor: 31,
  changed: true,
});
const weightedSource = "masterpiece, (best quality:1.2), solo";
const weightedTokens = parsePrompt(weightedSource, dictionary);
assert.equal(replacePromptTokenWeight(weightedSource, weightedTokens[1], null).text, weightSource);
assert.equal(replacePromptTokenWeight(weightSource, weightTokens[1], 4).changed, false);
const naturalWeightToken = parsePrompt("A woman is standing in the rain.", dictionary)[0];
assert.equal(replacePromptTokenWeight("A woman is standing in the rain.", naturalWeightToken, 1.2).changed, false);

const diagnosticSource = "1girl, solo, 2girls, standing, sitting, red hair, red_hair, (smile:abc), [open";
const diagnosticTokens = parsePrompt(diagnosticSource, dictionary);
const diagnostics = analyzePromptSyntax(diagnosticSource, diagnosticTokens);
assert.ok(diagnostics.some((item) => item.code === "bracket-unclosed"));
assert.ok(diagnostics.some((item) => item.code === "invalid-weight"));
assert.ok(diagnostics.some((item) => item.code === "duplicate"));
assert.ok(diagnostics.some((item) => item.code === "conflict"));

const knownToken = parsePrompt("masterpiece", dictionary)[0];
assert.equal(knownToken.confidence, "high");
const machineToken = parsePrompt("cinematic", dictionary, new Map([["cinematic", { text: "电影感", source: "prompt-assistant" }]]))[0];
assert.equal(machineToken.confidence, "low");

console.log("parser tests: OK");
