export function normalizeKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\s+/g, " ");
}

function isPair(open, close) {
  return (open === "(" && close === ")") ||
    (open === "[" && close === "]") ||
    (open === "{" && close === "}");
}

function stripEmphasis(value) {
  let current = value.trim();
  while (current.length >= 2 && isPair(current[0], current.at(-1))) {
    current = current.slice(1, -1).trim();
  }
  return current;
}

export function analyzeSegment(raw) {
  const display = raw.trim();
  if (!display) return null;

  if (/^<[^>]+>$/.test(display)) {
    return { raw: display, term: display, weight: null, syntax: "special" };
  }

  let term = display;
  let weight = null;
  const weighted = display.match(/^\(([\s\S]+):\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\)$/);
  if (weighted) {
    term = weighted[1].trim();
    weight = Number(weighted[2]);
  }
  term = stripEmphasis(term);

  return {
    raw: display,
    term,
    weight,
    syntax: /^(BREAK|AND)$/i.test(term) ? "operator" : "tag",
  };
}

export function splitPrompt(text) {
  const segments = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let curly = 0;
  let angle = 0;
  let escaped = false;

  const push = (end) => {
    const raw = text.slice(start, end);
    if (raw.trim()) segments.push({ raw, start, end });
    start = end + 1;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "<") angle += 1;
    else if (char === ">" && angle > 0) angle -= 1;
    else if (angle === 0) {
      if (char === "(") round += 1;
      else if (char === ")" && round > 0) round -= 1;
      else if (char === "[") square += 1;
      else if (char === "]" && square > 0) square -= 1;
      else if (char === "{") curly += 1;
      else if (char === "}" && curly > 0) curly -= 1;
    }

    const topLevel = round === 0 && square === 0 && curly === 0 && angle === 0;
    if (topLevel && (char === "," || char === "\n" || char === "\r")) push(index);
  }
  const tail = text.slice(start);
  if (tail.trim()) segments.push({ raw: tail, start, end: text.length });
  return segments;
}

function isLineBreak(value) {
  return value === "\n" || value === "\r";
}

/**
 * Remove one parsed prompt token while keeping the surrounding comma/newline
 * structure readable.  The parser's token offsets deliberately point into the
 * original text, so duplicate tags are removed by occurrence rather than key.
 */
export function removePromptToken(text, token) {
  const value = String(text ?? "");
  if (!token || !Number.isInteger(token.start) || !Number.isInteger(token.end)) {
    return { text: value, cursor: value.length, changed: false };
  }

  let start = Math.max(0, Math.min(value.length, token.start));
  let end = Math.max(start, Math.min(value.length, token.end));
  if (start === end && !value.slice(start, end).trim()) {
    return { text: value, cursor: start, changed: false };
  }

  if (end < value.length && (value[end] === "," || isLineBreak(value[end]))) {
    const separator = value[end];
    end += 1;
    if (separator === "\r" && value[end] === "\n") end += 1;
    while (end < value.length && /[ \t]/.test(value[end])) end += 1;
    if (separator === "," && isLineBreak(value[end])) {
      const firstBreak = value[end];
      end += 1;
      if (firstBreak === "\r" && value[end] === "\n") end += 1;
      while (end < value.length && /[ \t]/.test(value[end])) end += 1;
    }
  } else {
    let probe = start - 1;
    while (probe >= 0 && /[ \t]/.test(value[probe])) probe -= 1;
    if (probe >= 0 && (value[probe] === "," || isLineBreak(value[probe]))) {
      start = probe;
      if (isLineBreak(value[probe])) {
        if (value[probe] === "\n" && probe > 0 && value[probe - 1] === "\r") start = probe - 1;
        let before = start - 1;
        while (before >= 0 && /[ \t]/.test(value[before])) before -= 1;
        if (before >= 0 && value[before] === ",") start = before;
      }
    }
  }

  let left = value.slice(0, start);
  let right = value.slice(end);
  if (!left.trim()) {
    right = right.replace(/^[\s,]+/, "");
    left = "";
  } else if (!right.trim()) {
    left = left.replace(/[\s,]+$/, "");
    right = "";
  } else if (left.endsWith(",") && !/^\s/.test(right)) {
    right = ` ${right}`;
  }
  const nextText = left + right;
  return { text: nextText, cursor: Math.min(left.length, nextText.length), changed: nextText !== value };
}

/** Replace one tag occurrence with Anima's explicit `(tag:weight)` syntax. */
export function replacePromptTokenWeight(text, token, weight) {
  const value = String(text ?? "");
  if (!token || token.syntax !== "tag" || token.segmentKind === "natural" ||
      !Number.isInteger(token.start) || !Number.isInteger(token.end)) {
    return { text: value, cursor: value.length, changed: false };
  }
  const start = Math.max(0, Math.min(value.length, token.start));
  const end = Math.max(start, Math.min(value.length, token.end));
  const term = String(token.term ?? "").trim();
  if (!term) return { text: value, cursor: start, changed: false };

  const originalSlice = value.slice(start, end);
  const leading = originalSlice.match(/^\s*/)?.[0] ?? "";
  const trailing = originalSlice.match(/\s*$/)?.[0] ?? "";
  let replacementCore = term;
  if (weight !== null && weight !== undefined && String(weight).trim() !== "") {
    const numeric = Number(weight);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 3) {
      return { text: value, cursor: start, changed: false };
    }
    replacementCore = `(${term}:${Number(numeric.toFixed(3))})`;
  }
  const replacement = `${leading}${replacementCore}${trailing}`;
  if (originalSlice === replacement) {
    return { text: value, cursor: end, changed: false };
  }
  return {
    text: value.slice(0, start) + replacement + value.slice(end),
    cursor: start + replacement.length,
    changed: true,
  };
}

/** Return the concrete token occurrence intersecting a textarea selection. */
export function tokenForSelection(tokens, selectionStart, selectionEnd = selectionStart) {
  const start = Math.max(0, Number(selectionStart) || 0);
  const end = Math.max(start, Number(selectionEnd) || start);
  if (end > start) {
    return (tokens ?? []).find((token) => start < token.end && end > token.start) ?? null;
  }
  return (tokens ?? []).find((token) => start >= token.start && start <= token.end) ?? null;
}

export function extractInstructionBody(text) {
  const value = String(text ?? "");
  const structured = value.match(/^\s*翻译要求\s*[:：][\s\S]*?\n\s*正文\s*[:：]\s*([\s\S]*)$/i);
  if (structured) {
    const body = structured[1];
    return { matched: true, body, start: value.lastIndexOf(body), format: "structured" };
  }
  const colon = value.search(/[:：]/);
  if (colon >= 0) {
    const directive = value.slice(0, colon);
    const body = value.slice(colon + 1).trimStart();
    if (body && /(?:翻译|译成|translate)/i.test(directive)) {
      return { matched: true, body, start: value.indexOf(body, colon + 1), format: "prefix" };
    }
  }
  return { matched: false, body: value, start: 0, format: null };
}

function looksLikeNaturalClause(raw) {
  const value = String(raw ?? "").trim();
  const words = value.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g) ?? [];
  if (words.length < 6) return false;
  const lower = words.map((word) => word.toLowerCase());
  const verbs = new Set([
    "is", "are", "was", "were", "has", "have",
    "sit", "sits", "sitting", "stand", "stands", "standing",
    "walk", "walks", "walking", "look", "looks", "looking",
    "ask", "asks", "asking", "hold", "holds", "holding",
    "wear", "wears", "wearing", "smile", "smiles", "smiling",
    "lean", "leans", "leaning", "reach", "reaches", "reaching",
    "face", "faces", "facing", "turn", "turns", "turning",
  ]);
  const verbIndex = lower.findIndex((word, index) => index > 0 && verbs.has(word));
  if (verbIndex < 0) return false;
  const startsWithPronoun = ["she", "he", "they", "it", "this", "that"].includes(lower[0]) && verbIndex <= 3;
  const startsWithDeterminer = ["a", "an", "the"].includes(lower[0]) && verbIndex >= 2 && verbIndex <= 7;
  const startsWithName = /^[A-Z][A-Za-z'-]*\b/.test(value) && verbIndex <= 5;
  if (!startsWithPronoun && !startsWithDeterminer && !startsWithName) return false;
  return words.length >= 9
    || /\b(?:her|his|their|with|while|behind|towards?|into|in the|on the|at the|under the|over the)\b/i.test(value);
}

const TAG_SUFFIX_SIGNAL = /^(?:masterpiece|best quality|high quality|great quality|normal quality|low quality|worst quality|highres|absurdres|newest|recent|safe|sensitive|questionable|explicit|solo|\d+(?:girl|boy|girls|boys|other|people)|(?:long|short|medium|purple|blue|green|red|black|white|blonde|brown|pink|silver) (?:hair|eyes)|(?:full|upper) body|close-up|portrait|dynamic pose|cinematic|photorealistic|watercolor|dramatic lighting|soft lighting|natural lighting|indoors|outdoors|night|day|rainy day|twintails?|smile|looking at viewer)$/i;

function looksLikeTagSuffix(raw) {
  const value = String(raw ?? "").trim();
  if (!value || /[.!?。！？]/.test(value)) return false;
  if (/^<[^>]+>$/.test(value) || /^(?:BREAK|AND)$/i.test(value)) return true;
  const analyzed = analyzeSegment(value);
  const words = analyzed?.term?.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g) ?? [];
  if (!words.length || words.length > 5) return false;
  if (looksLikeNaturalClause(value)) return false;
  if (/^(?:looking|holding|standing|sitting|walking|turning|reaching|leaning)\b/i.test(value) &&
      /\b(?:a|an|the|her|his|their|towards?|into|from|with)\b/i.test(value)) return false;
  return true;
}

function trailingTagStart(segments, afterIndex) {
  let start = segments.length;
  while (start > afterIndex && looksLikeTagSuffix(segments[start - 1].raw)) start -= 1;
  const suffix = segments.slice(start);
  if (suffix.length < 4) return segments.length;
  const signals = suffix.filter((segment) => TAG_SUFFIX_SIGNAL.test(String(segment.raw ?? "").trim())).length;
  return signals >= 2 ? start : segments.length;
}

export function detectInputMode(text, requestedMode = "auto") {
  const value = String(text ?? "").trim();
  if (["tags", "natural"].includes(requestedMode)) {
    return { mode: requestedMode, reason: "手动指定", confidence: "high" };
  }
  if (!value) return { mode: "tags", reason: "空输入", confidence: "high" };
  const instruction = extractInstructionBody(value);
  if (instruction.matched) {
    return { mode: "instruction", reason: instruction.format === "structured" ? "检测到翻译要求/正文" : "检测到翻译指令前缀", confidence: "high" };
  }

  const words = value.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g) ?? [];
  const commaSegments = splitPrompt(value);
  const hasSentenceEnd = /[。！？.!?](?:\s|$)/.test(value);
  const hasNaturalGrammar = /\b(?:she|he|they|who|which|is|are|was|were|wearing|holding|standing|sitting|with|while|under|inside|outside|in the|on the)\b/i.test(value);
  const longCommaSegment = commaSegments.some((item) => (item.raw.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g) ?? []).length >= 10);
  const strongNaturalStart = commaSegments.findIndex((item) => looksLikeNaturalClause(item.raw));
  const punctuationNaturalStart = commaSegments.findIndex((item) => {
    const raw = item.raw.trim();
    const segmentWords = raw.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g) ?? [];
    const finiteClause = /^(?:(?:she|he|they|it|this|that|the\s+[a-z][\w'-]*|an?\s+[a-z][\w'-]*)|(?:[A-Z][A-Za-z'-]*))\s+(?:is|are|was|were|sits?|stands?|walks?|looks?|asks?|holds?|wears?|smiles?|leans?|reaches?)\b/.test(raw);
    return /^\./.test(raw)
      || finiteClause
      || segmentWords.length >= 6 && /[.!?]$/.test(raw);
  });
  const naturalStart = strongNaturalStart >= 0 ? strongNaturalStart : punctuationNaturalStart;
  const naturalEnd = naturalStart >= 0 ? trailingTagStart(commaSegments, naturalStart + 1) : commaSegments.length;
  if (commaSegments.length >= 3 && naturalStart === 0 && naturalEnd < commaSegments.length) {
    return { mode: "mixed", reason: "检测到自然语言后跟标签列表", confidence: "high", naturalStart, naturalEnd };
  }
  if (commaSegments.length >= 3 && naturalStart > 0) {
    const shortBefore = commaSegments.slice(0, naturalStart).filter((item) =>
      (item.raw.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g) ?? []).length <= 6
    ).length;
    if (shortBefore >= Math.max(2, Math.ceil(naturalStart * 0.6))) {
      return {
        mode: "mixed",
        reason: naturalEnd < commaSegments.length ? "检测到标签之间的自然语言描述" : "检测到短标签后跟自然语言描述",
        confidence: "high",
        naturalStart,
        naturalEnd,
      };
    }
  }
  if (!hasSentenceEnd && commaSegments.length >= 3 && !longCommaSegment) {
    return { mode: "tags", reason: "检测到多个短标签", confidence: "high" };
  }
  if (hasSentenceEnd || words.length >= 12 && (commaSegments.length <= 2 || hasNaturalGrammar || longCommaSegment)) {
    return { mode: "natural", reason: hasSentenceEnd ? "检测到完整句子" : "检测到自然语言语法", confidence: "medium" };
  }
  return { mode: "tags", reason: "检测到标签式输入", confidence: commaSegments.length > 1 ? "high" : "medium" };
}

export function splitMixedText(text, naturalStart, naturalEnd) {
  const value = String(text ?? "");
  const segments = splitPrompt(value);
  const startIndex = Number.isInteger(naturalStart) ? naturalStart : -1;
  const endIndex = Number.isInteger(naturalEnd) ? naturalEnd : segments.length;
  if (startIndex < 0 || startIndex >= segments.length || endIndex <= startIndex || endIndex > segments.length) {
    return splitPrompt(value);
  }
  const before = segments.slice(0, startIndex).map((segment) => ({ ...segment, segmentKind: "tag" }));
  const after = segments.slice(endIndex).map((segment) => ({ ...segment, segmentKind: "tag" }));
  const start = segments[startIndex].start;
  const end = endIndex === segments.length ? value.length : segments[endIndex - 1].end;
  const raw = value.slice(start, end);
  return [
    ...before,
    { raw, start, end, segmentKind: "natural" },
    ...after,
  ];
}

export function splitNaturalText(text, offset = 0) {
  const segments = [];
  const expression = /[^\n。！？.!?]+(?:[。！？.!?]+|$)/g;
  for (const match of String(text ?? "").matchAll(expression)) {
    const raw = match[0];
    if (!raw.trim()) continue;
    segments.push({ raw, start: offset + match.index, end: offset + match.index + raw.length });
  }
  return segments;
}

export function buildDictionaryIndex(tags) {
  const index = new Map();
  for (const tag of tags ?? []) {
    const key = normalizeKey(tag.english);
    if (key) index.set(key, tag);
  }
  return index;
}

function countMatches(value, expression) {
  return (value.match(expression) ?? []).length;
}

export function validateTranslationResult(source, translated, options = {}) {
  const original = String(source ?? "").trim();
  const result = String(translated ?? "").trim();
  if (!result) return { ok: false, reason: "译文为空" };

  const naturalLanguage = Boolean(options.naturalLanguage);

  const maximumLength = naturalLanguage
    ? Math.max(240, original.length * 8 + 100)
    : Math.max(80, original.length * 6 + 20);
  if (result.length > maximumLength) {
    return { ok: false, reason: `译文异常过长（${result.length} 字符）` };
  }
  if (!naturalLanguage && !/[\r\n]/.test(original) && /[\r\n]/.test(result)) {
    return { ok: false, reason: "单个标签被扩展成了多行内容" };
  }

  const sourceCommas = countMatches(original, /[,，]/g);
  const resultCommas = countMatches(result, /[,，]/g);
  if (!naturalLanguage && resultCommas > sourceCommas) {
    return { ok: false, reason: `单个标签被扩展成了 ${resultCommas + 1} 个标签` };
  }

  const sourceWeights = countMatches(original, /:\s*-?(?:\d+(?:\.\d*)?|\.\d+)/g);
  const resultWeights = countMatches(result, /:\s*-?(?:\d+(?:\.\d*)?|\.\d+)/g);
  if (!naturalLanguage && resultWeights > sourceWeights) {
    return { ok: false, reason: "译文增加了原文没有的权重" };
  }

  const pairs = [["(", ")"], ["[", "]"], ["{", "}"]];
  for (const [open, close] of pairs) {
    const sourceCount = original.split(open).length + original.split(close).length;
    const resultCount = result.split(open).length + result.split(close).length;
    if (!naturalLanguage && resultCount > sourceCount) {
      return { ok: false, reason: "译文增加了原文没有的括号结构" };
    }
  }

  if (/^(翻译结果|译文|以下是|translation)\s*[:：]/i.test(result)) {
    return { ok: false, reason: "译文包含解释性前缀" };
  }
  return { ok: true, text: result };
}

function confidenceFor(status, entry) {
  if (status === "machine") return { confidence: "low", confidenceLabel: "低可信·待确认" };
  if (status === "unverified") return { confidence: "medium", confidenceLabel: "中可信·待确认" };
  if (status === "unknown") return { confidence: "none", confidenceLabel: "未判断" };
  if (status === "special") return { confidence: "high", confidenceLabel: "高可信" };
  if (entry?.source === "user" || entry?.verified !== false) return { confidence: "high", confidenceLabel: "高可信" };
  return { confidence: "medium", confidenceLabel: "中可信" };
}

export function parsePrompt(text, dictionaryIndex, machineTranslations = new Map(), options = {}) {
  const value = String(text ?? "");
  const detected = detectInputMode(value, options.mode ?? "auto");
  let sourceText = value;
  let offset = 0;
  if (detected.mode === "instruction") {
    const extracted = extractInstructionBody(value);
    sourceText = extracted.body;
    offset = extracted.start;
  }
  const sourceSegments = detected.mode === "natural"
    ? splitNaturalText(sourceText, offset).map((segment) => ({ ...segment, segmentKind: "natural" }))
    : detected.mode === "mixed"
      ? splitMixedText(sourceText, detected.naturalStart, detected.naturalEnd).map((segment) => ({ ...segment, start: segment.start + offset, end: segment.end + offset }))
      : splitPrompt(sourceText).map((segment) => ({ ...segment, start: segment.start + offset, end: segment.end + offset, segmentKind: "tag" }));

  return sourceSegments.map((segment, id) => {
    const analyzed = analyzeSegment(segment.raw);
    const key = normalizeKey(analyzed.term);
    const dictionaryEntry = dictionaryIndex.get(key);
    const machine = machineTranslations.get(key);
    let status = "unknown";
    let chinese = "未收录";
    if (dictionaryEntry) {
      status = dictionaryEntry.verified === false ? "unverified" : "verified";
      chinese = dictionaryEntry.chinese;
    } else if (machine) {
      status = "machine";
      chinese = typeof machine === "string" ? machine : machine.text;
    } else if (analyzed.syntax === "special") {
      status = "special";
      chinese = "特殊语法（保持原样）";
    } else if (analyzed.syntax === "operator") {
      status = "special";
      chinese = analyzed.term.toUpperCase() === "BREAK" ? "提示词分段" : "条件组合";
    } else if (detected.mode === "natural" || detected.mode === "instruction" || segment.segmentKind === "natural") {
      status = "unknown";
      chinese = "自然语言片段（待翻译或确认）";
    }
    const confidence = confidenceFor(status, dictionaryEntry);
    return {
      ...segment,
      ...analyzed,
      id,
      key,
      chinese,
      status,
      ...confidence,
      inputMode: detected.mode,
      entry: dictionaryEntry ?? null,
      source: dictionaryEntry?.source ?? (machine ? (machine.source ?? "bpi-assistant") : analyzed.syntax === "tag" ? "unknown" : "syntax"),
    };
  });
}

function issue(severity, code, message, tokenKeys = []) {
  return { severity, code, message, tokenKeys };
}

function bracketIssues(text) {
  const issues = [];
  const pairs = { "(": ")", "[": "]", "{": "}", "<": ">" };
  const closing = new Set(Object.values(pairs));
  const stack = [];
  let escaped = false;
  for (const char of String(text ?? "")) {
    if (escaped) { escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (pairs[char]) stack.push(char);
    else if (closing.has(char)) {
      const open = stack.pop();
      if (!open || pairs[open] !== char) {
        issues.push(issue("error", "bracket-mismatch", `括号不匹配：发现多余或错位的 ${char}`));
        break;
      }
    }
  }
  if (stack.length) issues.push(issue("error", "bracket-unclosed", `括号未闭合：缺少 ${pairs[stack.at(-1)]}`));
  return issues;
}

const CONFLICT_GROUPS = [
  { left: ["1girl", "solo"], right: ["2girls", "multiple girls", "multiple people", "group"], label: "单人与多人物标签" },
  { left: ["from front", "front view"], right: ["from behind", "back view"], label: "正面与背面视角" },
  { left: ["facing left"], right: ["facing right"], label: "朝向左与朝向右" },
  { left: ["standing"], right: ["sitting", "lying", "kneeling"], label: "站立与其他主体姿势" },
  { left: ["eyes closed", "closed eyes"], right: ["looking at viewer"], label: "闭眼与看向镜头" },
  { left: ["full body"], right: ["extreme close-up", "close-up"], label: "全身与特写景别" },
];

export function analyzePromptSyntax(text, tokens, modeInfo = detectInputMode(text)) {
  const value = String(text ?? "");
  const issues = bracketIssues(value);
  if (/[，、]/.test(value)) issues.push(issue("warning", "fullwidth-separator", "检测到中文分隔符；Anima 标签流通常使用英文半角逗号"));
  const hasConsecutiveEmptyTag = /(?:^|,)[ \t]*,/m.test(value);
  const hasTrailingEmptyTag = /,[ \t]*$/m.test(value) && !["mixed", "natural", "instruction"].includes(modeInfo.mode);
  if (hasConsecutiveEmptyTag || hasTrailingEmptyTag) issues.push(issue("warning", "empty-tag", "检测到连续逗号或空标签"));

  const keys = new Map();
  for (const token of tokens ?? []) {
    if (!token.key || token.syntax !== "tag") continue;
    if (!keys.has(token.key)) keys.set(token.key, []);
    keys.get(token.key).push(token);
    if (/^\([\s\S]+:[^)]*\)$/.test(token.raw.trim()) && token.weight === null) {
      issues.push(issue("error", "invalid-weight", `权重格式可能无效：${token.raw.trim()}`, [token.key]));
    } else if (token.weight !== null && (token.weight < 0 || token.weight > 3)) {
      issues.push(issue("warning", "unusual-weight", `权重 ${token.weight} 超出常用检查范围 0–3`, [token.key]));
    }
  }
  for (const [key, matches] of keys) {
    if (matches.length > 1) issues.push(issue("warning", "duplicate", `重复标签：${matches[0].term}`, [key]));
  }

  const present = new Set(keys.keys());
  for (const group of CONFLICT_GROUPS) {
    const left = group.left.filter((key) => present.has(normalizeKey(key)));
    const right = group.right.filter((key) => present.has(normalizeKey(key)));
    if (left.length && right.length) {
      issues.push(issue("warning", "conflict", `可能冲突：${group.label}（${left[0]} ↔ ${right[0]}）`, [...left, ...right].map(normalizeKey)));
    }
  }

  if (modeInfo.mode === "natural") {
    issues.push(issue("info", "natural-mode", "当前按自然语言分句检查，不会按每个逗号拆成独立标签"));
  } else if (modeInfo.mode === "mixed") {
    issues.push(issue("info", "mixed-mode", "已识别标签与自然语言混合格式：短标签逐项检查，末尾描述保持为完整片段"));
  } else if (modeInfo.mode === "instruction") {
    issues.push(issue("info", "instruction-mode", "已识别附带翻译指令，检查器只分析正文部分"));
  }
  return issues;
}
