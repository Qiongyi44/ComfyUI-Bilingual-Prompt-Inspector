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
  return { favorites, recent, detailsExpanded, englishInputHeight, chineseMirrorHeight };
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

export function rankDictionaryTags(tags, query, preferences = {}, limit = 40) {
  const prefs = normalizePreferences(preferences);
  const favoriteSet = new Set(prefs.favorites);
  const recentIndex = new Map(prefs.recent.map((key, index) => [key, index]));
  const ranked = [];
  for (const tag of tags ?? []) {
    const score = matchScore(tag, query);
    if (score === null) continue;
    const key = normalizeKey(tag.english);
    ranked.push({
      tag,
      score,
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
  return ranked.slice(0, limit).map((item) => item.tag);
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
