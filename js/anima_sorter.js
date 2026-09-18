import { normalizeKey } from "./parser.js";

export const ANIMA_SLOTS = [
  { id: "quality", label: "质量／元数据／年份／安全" },
  { id: "people", label: "人数" },
  { id: "character", label: "角色" },
  { id: "copyright", label: "作品／系列" },
  { id: "artist", label: "画师" },
  { id: "appearance", label: "外观／服装" },
  { id: "action", label: "表情／动作／姿势" },
  { id: "camera", label: "镜头／构图" },
  { id: "style", label: "画风" },
  { id: "environment", label: "场景／背景／光照" },
  { id: "natural", label: "自然语言描述" },
  { id: "uncertain", label: "待确认分类" },
];

const SLOT_INDEX = new Map(ANIMA_SLOTS.map((slot, index) => [slot.id, index]));
const CATEGORY_SLOTS = new Map([
  ["质量", "quality"], ["元标签", "quality"], ["负面词", "quality"], ["成年限定", "quality"], ["成人限定", "quality"],
  ["人物数量", "people"],
  ["角色", "character"], ["原神角色", "character"], ["成年角色", "character"],
  ["作品", "copyright"], ["画师", "artist"],
  ["发色", "appearance"], ["发型", "appearance"], ["眼睛", "appearance"], ["人物特征", "appearance"],
  ["服装", "appearance"], ["上装", "appearance"], ["下装", "appearance"], ["鞋子", "appearance"],
  ["饰品", "appearance"], ["服配件", "appearance"], ["服饰配件", "appearance"], ["成人服饰", "appearance"],
  ["腿部服饰", "appearance"], ["腿部服饰与鞋", "appearance"], ["连衣裙与制服", "appearance"],
  ["袖型与领口", "appearance"], ["泳装与贴身衣物", "appearance"], ["装饰与材质", "appearance"],
  ["成人身体", "appearance"], ["裸露程度", "appearance"],
  ["表情", "action"], ["动作", "action"], ["姿势", "action"], ["基础姿势", "action"],
  ["手臂与手势", "action"], ["手部动作", "action"], ["腿部姿势", "action"],
  ["人物朝向", "action"], ["视线", "action"], ["视线与朝向", "action"],
  ["双人互动", "action"], ["成人互动", "action"], ["成人姿势", "action"],
  ["成人束缚", "action"], ["成人内容", "action"], ["身体与头部协调", "action"],
  ["镜头", "camera"], ["构图", "camera"], ["景别", "camera"], ["景深", "camera"],
  ["镜头与焦距", "camera"], ["相机方位", "camera"], ["相机高度", "camera"],
  ["相机角度", "camera"], ["运镜", "camera"], ["Anima构图", "camera"], ["对焦与动态效果", "camera"],
  ["风格", "style"], ["画面风格", "style"], ["Anima风格", "style"], ["Anima控制词", "style"],
  ["背景", "environment"], ["背景与环境", "environment"], ["光照", "environment"],
]);

const QUALITY_PATTERN = /^(?:masterpiece|best quality|high quality|great quality|normal quality|low quality|worst quality|highres|absurdres|very aesthetic|newest|recent|mid|early|old|safe|sensitive|questionable|explicit|rating(?::| )|year[ _-]?\d{4}|\d{4}s?)$/i;
const PEOPLE_PATTERN = /^(?:solo|no humans?|multiple (?:girls|boys|people)|group|\d+(?:girl|girls|boy|boys|other|people)|everyone)$/i;
const APPEARANCE_PATTERN = /(?:hair|eyes?|bangs|twintails?|ponytail|braid|skin|breasts?|body|gloves?|dress|shirt|skirt|pants|shorts|pantyhose|stockings?|thighhighs?|socks?|shoes?|boots?|sleeves?|uniform|jacket|coat|hat|ribbon|necklace|earrings?|accessory|ornament|makeup|lipstick)$/i;
const ACTION_PATTERN = /(?:smile|expression|looking|standing|sitting|lying|kneeling|walking|running|holding|pose|gesture|hugging|kissing|dancing|fighting)$/i;
const CAMERA_PATTERN = /(?:view|angle|shot|close-up|full body|upper body|portrait|perspective|focus|depth of field|bokeh|dutch angle|fisheye)$/i;
const STYLE_PATTERN = /(?:style|realistic|photorealistic|anime|manga|watercolor|oil painting|sketch|lineart|pixel art|3d|render)$/i;
const ENVIRONMENT_PATTERN = /(?:background|indoors?|outdoors?|room|street|city|forest|beach|ocean|sky|clouds?|mountains?|garden|stage|school|bedroom|night|sunset|sunrise|daylight|lighting|light|shadow|spotlight|rain|snow|fog)$/i;
const ARTIST_PATTERN = /^@\S+|^artist(?::| )/i;

function looksNaturalLanguage(token) {
  if (token?.segmentKind === "natural" || token?.inputMode === "natural") return true;
  const raw = String(token?.raw ?? token?.term ?? "").trim();
  const words = raw.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g) ?? [];
  return /^\./.test(raw) || /[.!?]$/.test(raw) || words.length >= 9 && /\b(?:is|are|was|were|with|while|holding|wearing|standing|sitting|looking)\b/i.test(raw);
}

export function classifyAnimaToken(token) {
  const term = String(token?.term ?? token?.raw ?? "").trim();
  const key = normalizeKey(term);
  const category = String(token?.entry?.category ?? "").trim();
  if (looksNaturalLanguage(token)) return { slot: "natural", certain: true, reason: "自然语言片段" };
  if (QUALITY_PATTERN.test(key)) return { slot: "quality", certain: true, reason: "质量或元数据标签" };
  if (PEOPLE_PATTERN.test(key)) return { slot: "people", certain: true, reason: "人数标签" };
  if (ARTIST_PATTERN.test(term) || category === "画师") return { slot: "artist", certain: true, reason: "画师标签" };
  if (CATEGORY_SLOTS.has(category)) return { slot: CATEGORY_SLOTS.get(category), certain: true, reason: "词库分类：" + category };
  if (token?.entry?.pack_id === "danbooru_large") {
    if (category === "角色") return { slot: "character", certain: true, reason: "Danbooru角色分类" };
    if (category === "作品") return { slot: "copyright", certain: true, reason: "Danbooru作品分类" };
    if (category === "画师") return { slot: "artist", certain: true, reason: "Danbooru画师分类" };
  }
  if (APPEARANCE_PATTERN.test(key)) return { slot: "appearance", certain: true, reason: "外观或服装关键词" };
  if (ACTION_PATTERN.test(key)) return { slot: "action", certain: true, reason: "表情、动作或姿势关键词" };
  if (CAMERA_PATTERN.test(key)) return { slot: "camera", certain: true, reason: "镜头或构图关键词" };
  if (STYLE_PATTERN.test(key)) return { slot: "style", certain: true, reason: "画风关键词" };
  if (ENVIRONMENT_PATTERN.test(key)) return { slot: "environment", certain: true, reason: "场景、背景或光照关键词" };
  return { slot: "uncertain", certain: false, reason: category ? "词库分类待映射：" + category : "未找到可靠分类" };
}

export function groupAnimaTokensForDisplay(tokens) {
  const labels = new Map(ANIMA_SLOTS.map((slot) => [slot.id, slot.label]));
  const groups = [];
  for (const token of tokens ?? []) {
    if (token.syntax === "operator") {
      groups.push({ id: "operator", label: "分段／组合", tokens: [token] });
      continue;
    }
    const slot = classifyAnimaToken(token).slot;
    const previous = groups.at(-1);
    if (previous?.id === slot) previous.tokens.push(token);
    else groups.push({ id: slot, label: labels.get(slot) ?? "待确认分类", tokens: [token] });
  }
  return groups;
}

function sortSection(tokens) {
  return tokens
    .map((token, originalIndex) => ({ token, originalIndex, classification: classifyAnimaToken(token) }))
    .sort((left, right) => SLOT_INDEX.get(left.classification.slot) - SLOT_INDEX.get(right.classification.slot) || left.originalIndex - right.originalIndex);
}

function sectionText(sorted, groupLines) {
  if (!groupLines) return sorted.map((item) => String(item.token.raw).trim()).join(", ");
  const lines = [];
  for (const slot of ANIMA_SLOTS) {
    const values = sorted.filter((item) => item.classification.slot === slot.id).map((item) => String(item.token.raw).trim());
    if (values.length) lines.push(values.join(", "));
  }
  return lines.join("\n");
}

export function sortAnimaPrompt(tokens, options = {}) {
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
    const text = sectionText(sorted, options.groupLines === true);
    if (text) outputParts.push(text);
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
