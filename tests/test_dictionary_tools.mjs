import assert from "node:assert/strict";

import {
  normalizePreferences,
  mergeImportAsAliases,
  previewImport,
  rankDictionaryTags,
  recordRecent,
  suggestedTags,
  toggleFavorite,
} from "../js/dictionary_tools.js";


const tags = [
  { english: "looking at viewer", chinese: "看向镜头", aliases: ["直视镜头"], category: "视线" },
  { english: "viewer", chinese: "观众", aliases: [], category: "其他" },
  { english: "from front", chinese: "正面视角", aliases: ["正面"], category: "镜头" },
];

assert.equal(rankDictionaryTags(tags, "viewer")[0].english, "viewer");
assert.equal(rankDictionaryTags(tags, "看向镜头")[0].english, "looking at viewer");
assert.equal(rankDictionaryTags(tags, "直视")[0].english, "looking at viewer");
assert.equal(rankDictionaryTags(tags, "镜头").length, 2);

let preferences = normalizePreferences({ favorites: [], recent: [] });
assert.equal(preferences.detailsExpanded, true);
assert.equal(normalizePreferences({ detailsExpanded: false }).detailsExpanded, false);
assert.equal(normalizePreferences({ englishInputHeight: 500 }).englishInputHeight, 420);
assert.equal(normalizePreferences({ chineseMirrorHeight: 40 }).chineseMirrorHeight, 92);
preferences = toggleFavorite(preferences, "from_front");
preferences = recordRecent(preferences, "looking at viewer");
assert.deepEqual(preferences.favorites, ["from front"]);
assert.equal(suggestedTags(tags, preferences)[0].english, "looking at viewer");
preferences = toggleFavorite(preferences, "from front");
assert.deepEqual(preferences.favorites, []);

const preview = previewImport([
  { english: "smile", chinese: "微笑" },
  { english: "from front", chinese: "正面" },
  { english: "from_front", chinese: "正面视角" },
  { english: "", chinese: "错误" },
], [{ english: "from front", chinese: "正面视角" }]);
assert.equal(preview.added, 1);
assert.equal(preview.conflicts.length, 1);
assert.equal(preview.duplicates, 1);
assert.equal(preview.invalid, 1);

const aliasImport = mergeImportAsAliases(
  [{ english: "from_front", chinese: "正面", aliases: ["前方"] }],
  [{ english: "from front", chinese: "正面视角", aliases: ["正视"] }],
);
assert.equal(aliasImport[0].chinese, "正面视角");
assert.deepEqual(aliasImport[0].aliases, ["正视", "前方", "正面"]);
assert.equal(aliasImport[0].source, "user");

console.log("dictionary tools tests: OK");
