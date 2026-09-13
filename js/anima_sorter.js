import { normalizeKey } from "./parser.js";


export const ANIMA_SLOTS = [
  { id: "quality", label: "质量／元数据／年份／安全" },
  { id: "people", label: "人数" },
  { id: "character", label: "角色" },
  { id: "copyright", label: "作品／系列" },
  { id: "artist", label: "画师" },
  { id: "appearance", label: "外观" },
  { id: "other", label: "其他标签" },
  { id: "environment", label: "环境" },
  { id: "natural", label: "自然语言描述" },
];

const SLOT_INDEX = new Map(ANIMA_SLOTS.map((slot, index) => [slot.id, index]));

const CATEGORY_SLOTS = new Map([
  ["质量", "quality"], ["元标签", "quality"],
  ["人物数量", "people"],
  ["角色", "character"], ["原神角色", "character"],
  ["作品", "copyright"],
  ["画师", "artist"],
  ["发色", "appearance"], ["发型", "appearance"], ["眼睛", "appearance"],
  ["人物特征", "appearance"], ["服装", "appearance"], ["上装", "appearance"],
  ["下装", "appearance"], ["鞋子", "appearance"], ["饰品", "appearance"],
  ["服配件", "appearance"], ["服饰配件", "appearance"], ["成人服饰", "appearance"],
  ["腿部服饰", "appearance"], ["腿部服饰与鞋", "appearance"],
  ["连衣裙与制服", "appearance"], ["袖型与领口", "appearance"],
  ["泳装与贴身衣物", "appearance"], ["装饰与材质", "appearance"],
  ["背景", "environment"], ["背景与环境", "environment"], ["光照", "environment"],
  ["景深", "environment"], ["对焦与动态效果", "environment"],
  ["镜头", "other"], ["构图", "other"], ["风格", "other"], ["画面风格", "other"],
  ["Anima风格", "other"], ["Anima构图", "other"], ["Anima控制词", "other"],
]);

const QUALITY_PATTERN = /^(?:masterpiece|best quality|high quality|great quality|normal quality|low quality|worst quality|highres|absurdres|very aesthetic|newest|recent|mid|early|old|safe|sensitive|questionable|explicit|rating(?::| )|year[ _-]?\d{4}|\d{4}s?)$/i;
const PEOPLE_PATTERN = /^(?:solo|no humans?|multiple (?:girls|boys|people)|group|\d+(?:girl|girls|boy|boys|other|people)|everyone)$/i;
const APPEARANCE_PATTERN = /(?:hair|eyes?|bangs|twintails?|ponytail|braid|skin|breasts?|body|gloves?|dress|shirt|skirt|pants|shorts|stockings?|socks?|shoes?|boots?|sleeves?|uniform|jacket|coat|hat|ribbon|necklace|earrings?|accessory|ornament|makeup|lipstick)$/i;
const ENVIRONMENT_PATTERN = /(?:background|indoors?|outdoors?|room|street|city|forest|beach|ocean|sky|clouds?|mountains?|garden|stage|school|bedroom|night|sunset|sunrise|daylight|lighting|light|shadow|spotlight|rain|snow|fog)$/i;
const ARTIST_PATTERN = /^@\S+|^artist(?::| )/i;

function looksNaturalLanguage(token) {
  const raw = String(token?.raw ?? token?.term ?? "").trim();
  const words = raw.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g) ?? [];
  return /^\./.test(raw) || /[.!?]$/.test(raw) || words.length >= 9 && /\b(?:is|are|was|were|with|while|holding|wearing|standing|sitting|looking)\b/i.test(raw);
}

export function classifyAnimaToken(token) {
  const term = String(token?.term ?? token?.raw ?? "").trim();
  const key = normalizeKey(term);
  const category = String(token?.entry?.category ?? "").trim();
  if (looksNaturalLanguage(token)) return { slot: "natural", certain: true, reason: "自然语言句子" };
  if (QUALITY_PATTERN.test(key)) return { slot: "quality", certain: true, reason: "质量或元数据标签" };
  if (PEOPLE_PATTERN.test(key)) return { slot: "people", certain: true, reason: "人数标签" };
  if (ARTIST_PATTERN.test(term) || category === "画师") return { slot: "artist", certain: true, reason: "画师标签" };
  if (CATEGORY_SLOTS.has(category)) return { slot: CATEGORY_SLOTS.get(category), certain: true, reason: `词库分类：${category}` };
  if (token?.entry?.pack_id === "danbooru_large") {
    if (category === "角色") return { slot: "character", certain: true, reason: "Danbooru角色分类" };
    if (category === "作品") return { slot: "copyright", certain: true, reason: "Danbooru作品分类" };
  }
  if (APPEARANCE_PATTERN.test(key)) return { slot: "appearance", certain: true, reason: "外观关键词" };
  if (ENVIRONMENT_PATTERN.test(key)) return { slot: "environment", certain: true, reason: "环境关键词" };
  const certainOther = Boolean(category) && !["通用", "自定义", "待整理"].includes(category);
  return { slot: "other", certain: certainOther, reason: certainOther ? `词库分类：${category}` : "暂归其他标签" };
}

function sortSection(tokens) {
  return tokens
    .map((token, originalIndex) => ({ token, originalIndex, classification: classifyAnimaToken(token) }))
    .sort((left, right) => SLOT_INDEX.get(left.classification.slot) - SLOT_INDEX.get(right.classification.slot) || left.originalIndex - right.originalIndex);
}

export function sortAnimaPrompt(tokens) {
  const sections = [];
  let current = [];
  for (const token of tokens ?? []) {
    if (token.syntax === "operator") {
      sections.push({ tokens: current, operator: token });
      current = [];
    } else {
      current.push(token);
    }
  }
  sections.push({ tokens: current, operator: null });

  const classified = [];
  const outputParts = [];
  let moved = 0;
  for (const section of sections) {
    const sorted = sortSection(section.tokens);
    sorted.forEach((item, index) => {
      if (item.originalIndex !== index) moved += 1;
      classified.push(item);
    });
    if (sorted.length) outputParts.push(sorted.map((item) => String(item.token.raw).trim()).join(", "));
    if (section.operator) outputParts.push(String(section.operator.raw).trim().toUpperCase());
  }
  const groups = ANIMA_SLOTS.map((slot) => ({
    ...slot,
    tokens: classified.filter((item) => item.classification.slot === slot.id).map((item) => item.token),
  })).filter((group) => group.tokens.length);
  return {
    text: outputParts.join("\n"),
    groups,
    moved,
    uncertain: classified.filter((item) => !item.classification.certain).map((item) => item.token),
  };
}
