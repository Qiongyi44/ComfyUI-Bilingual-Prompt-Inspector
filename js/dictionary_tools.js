import { normalizeKey } from "./parser.js";


function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizePreferences(value) {
  const source = value && typeof value === "object" ? value : {};
  const favorites = Array.isArray(source.favorites)
    ? [...new Set(source.favorites.map(normalizeKey).filter(Boolean))].slice(0, 1000)
    : [];
  const recent = Array.isArray(source.recent)
    ? [...new Set(source.recent.map(normalizeKey).filter(Boolean))].slice(0, 100)
    : [];
  const detailsExpanded = source.detailsExpanded !== false;
  const boundedHeight = (candidate, min, max) => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : null;
  };
  const englishInputHeight = boundedHeight(source.englishInputHeight, 84, 420);
  const chineseMirrorHeight = boundedHeight(source.chineseMirrorHeight, 92, 360);
  const chineseEditorHeight = boundedHeight(source.chineseEditorHeight, 110, 600);
  return { favorites, recent, detailsExpanded, englishInputHeight, chineseMirrorHeight, chineseEditorHeight };
}

export function preservedSearchScroll(previousQuery, nextQuery, scrollTop) {
  return String(previousQuery ?? "") === String(nextQuery ?? "")
    ? Math.max(0, Number(scrollTop) || 0)
    : 0;
}

export function inspectorNodeTargetHeight({
  widgetY,
  widgetMargin = 10,
  nodeHeight,
  currentWidgetHeight,
  targetWidgetHeight,
  fallbackBaseHeight = 70,
  maximumBaseHeight = 320,
  minimumHeight = 360,
} = {}) {
  const top = Number(widgetY);
  const margin = Math.max(0, Number(widgetMargin) || 0);
  const currentNode = Number(nodeHeight);
  const currentWidget = Number(currentWidgetHeight);
  const targetWidget = Math.max(0, Number(targetWidgetHeight) || 0);
  let baseHeight;
  if (Number.isFinite(top) && top >= 0) baseHeight = top + margin;
  else if (Number.isFinite(currentNode) && Number.isFinite(currentWidget) && currentWidget > 0
    && currentNode - currentWidget <= maximumBaseHeight) {
    baseHeight = Math.max(0, currentNode - currentWidget);
  } else baseHeight = Math.max(0, Number(fallbackBaseHeight) || 0);
  return Math.max(Number(minimumHeight) || 0, Math.ceil(baseHeight + targetWidget));
}

export function createClearTextHistoryEntry(currentText, label, categoryView = false) {
  const before = String(currentText ?? "");
  if (!before) return null;
  return {
    before,
    after: "",
    beforeStart: 0,
    beforeEnd: before.length,
    afterCursor: 0,
    label: String(label || "清空文本"),
    beforeCategoryView: Boolean(categoryView),
    afterCategoryView: false,
  };
}

export function clearButtonAction(state, hasContent) {
  if (state === "cleared") return "undo";
  if (!hasContent) return "empty";
  if (state === "confirm") return "clear";
  return "confirm";
}

export function clearButtonLabel(state) {
  if (state === "confirm") return "确认清空";
  if (state === "cleared") return "撤销";
  return "清空";
}

export function recordRecent(preferences, english) {
  const key = normalizeKey(english);
  if (!key) return normalizePreferences(preferences);
  const current = normalizePreferences(preferences);
  return { ...current, recent: [key, ...current.recent.filter((item) => item !== key)].slice(0, 100) };
}

export function toggleFavorite(preferences, english) {
  const key = normalizeKey(english);
  const current = normalizePreferences(preferences);
  if (!key) return current;
  const exists = current.favorites.includes(key);
  return {
    ...current,
    favorites: exists
      ? current.favorites.filter((item) => item !== key)
      : [key, ...current.favorites].slice(0, 1000),
  };
}

function matchScore(tag, rawQuery) {
  const query = normalized(rawQuery);
  const normalizedQuery = normalizeKey(rawQuery);
  const english = normalized(tag.english);
  const englishKey = normalizeKey(tag.english);
  const chinese = normalized(tag.chinese);
  const aliases = (tag.aliases ?? []).map(normalized);
  const category = normalized(tag.category);
  if (!query) return null;
  if (english === query || englishKey === normalizedQuery) return 0;
  if (chinese === query) return 1;
  if (english.startsWith(query) || englishKey.startsWith(normalizedQuery)) return 2;
  if (chinese.startsWith(query)) return 3;
  if (aliases.includes(query)) return 4;
  if (aliases.some((alias) => alias.startsWith(query))) return 5;
  if (english.includes(query) || englishKey.includes(normalizedQuery)) return 6;
  if (chinese.includes(query) || aliases.some((alias) => alias.includes(query))) return 7;
  if (category.includes(query)) return 8;
  return null;
}

export function searchQueryVariants(query, searchConcepts = {}) {
  const rawQuery = String(query ?? "").trim();
  if (!rawQuery) return [];
  const variants = [];
  const seen = new Set();
  const add = (text, relation = "direct", label = "") => {
    const value = String(text ?? "").trim();
    const key = normalizeKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    variants.push({ text: value, relation, label });
  };
  add(rawQuery);
  const normalizedQuery = normalizeKey(rawQuery);
  for (const concept of searchConcepts?.concepts ?? []) {
    const queries = Array.isArray(concept?.queries) ? concept.queries.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
    const matchedQuery = queries.find((item) => normalizeKey(item) === normalizedQuery || rawQuery.toLowerCase().includes(item.toLowerCase()));
    if (!matchedQuery) continue;
    const label = String(concept.label ?? concept.id ?? "相关概念");
    const residual = rawQuery.toLowerCase().replace(matchedQuery.toLowerCase(), "").trim();
    const modifiers = [];
    for (const [modifier, values] of Object.entries(searchConcepts?.modifiers ?? {})) {
      if (modifier.trim() && residual.includes(modifier.trim().toLowerCase())) {
        modifiers.push(...(Array.isArray(values) ? values : [values]));
      }
    }
    const terms = Array.isArray(concept?.terms) ? concept.terms : [];
    for (const modifier of modifiers.slice(0, 3)) {
      for (const term of terms.slice(0, 12)) {
        if (/[A-Za-z]/.test(String(term))) add(`${modifier} ${term}`, "concept-modified", label);
      }
    }
    for (const term of terms) {
      add(term, "concept", label);
      if (variants.length >= 20) break;
    }
    if (variants.length >= 20) break;
  }
  return variants.slice(0, 20);
}

function matchReason(score, variant) {
  if (variant.relation === "concept-modified") return `限定概念：${variant.label}`;
  if (variant.relation === "concept") return `概念关联：${variant.label}`;
  if (score <= 1) return "完全匹配";
  if (score <= 5) return "前缀或别名匹配";
  return "包含匹配";
}

export function rankDictionaryMatches(tags, query, preferences = {}, limit = 40, searchConcepts = {}) {
  const prefs = normalizePreferences(preferences);
  const favoriteSet = new Set(prefs.favorites);
  const recentIndex = new Map(prefs.recent.map((key, index) => [key, index]));
  const variants = searchQueryVariants(query, searchConcepts);
  const ranked = [];
  for (const tag of tags ?? []) {
    let best = null;
    for (const [variantIndex, variant] of variants.entries()) {
      const localScore = matchScore(tag, variant.text);
      if (localScore === null) continue;
      const score = localScore + variantIndex * 10;
      if (!best || score < best.score) best = { score, reason: matchReason(localScore, variant) };
    }
    if (!best) continue;
    const key = normalizeKey(tag.english);
    ranked.push({
      tag,
      score: best.score,
      reason: best.reason,
      favorite: favoriteSet.has(key),
      recent: recentIndex.get(key) ?? Number.MAX_SAFE_INTEGER,
    });
  }
  ranked.sort((left, right) =>
    left.score - right.score ||
    Number(right.favorite) - Number(left.favorite) ||
    left.recent - right.recent ||
    String(left.tag.english).localeCompare(String(right.tag.english), "en")
  );
  return ranked.slice(0, limit);
}

export function rankDictionaryTags(tags, query, preferences = {}, limit = 40, searchConcepts = {}) {
  return rankDictionaryMatches(tags, query, preferences, limit, searchConcepts).map((item) => item.tag);
}

export function suggestedTags(tags, preferences = {}, limit = 30) {
  const prefs = normalizePreferences(preferences);
  const byKey = new Map((tags ?? []).map((tag) => [normalizeKey(tag.english), tag]));
  const keys = [...prefs.recent, ...prefs.favorites.filter((key) => !prefs.recent.includes(key))];
  return keys.map((key) => byKey.get(key)).filter(Boolean).slice(0, limit);
}

export function previewImport(values, currentUserTags) {
  const current = new Map((currentUserTags ?? []).map((tag) => [normalizeKey(tag.english), tag]));
  const seen = new Set();
  const conflicts = [];
  let added = 0;
  let duplicates = 0;
  let invalid = 0;
  for (const value of values ?? []) {
    if (!value || typeof value !== "object" || !String(value.english ?? "").trim() || !String(value.chinese ?? "").trim()) {
      invalid += 1;
      continue;
    }
    const key = normalizeKey(value.english);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    const existing = current.get(key);
    if (!existing) {
      added += 1;
    } else if (String(existing.chinese).trim() === String(value.chinese).trim()) {
      duplicates += 1;
    } else {
      conflicts.push({ english: value.english, current: existing.chinese, incoming: value.chinese });
    }
  }
  return { total: values?.length ?? 0, added, duplicates, invalid, conflicts };
}

export function mergeImportAsAliases(values, effectiveTags) {
  const effective = new Map((effectiveTags ?? []).map((tag) => [normalizeKey(tag.english), tag]));
  return (values ?? []).map((incoming) => {
    const current = effective.get(normalizeKey(incoming?.english));
    if (!current) return incoming;
    const aliases = [...new Set([
      ...(current.aliases ?? []),
      ...(incoming.aliases ?? []),
      incoming.chinese,
    ].map((item) => String(item ?? "").trim()).filter((item) => item && item !== current.chinese))];
    return { ...current, aliases, source: "user", verified: true };
  });
}
