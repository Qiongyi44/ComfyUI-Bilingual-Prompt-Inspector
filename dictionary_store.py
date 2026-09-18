import json
import hashlib
import os
import re
import shutil
import sqlite3
import tempfile
from contextlib import closing
from datetime import datetime
from pathlib import Path


SCHEMA_VERSION = 1
PACK_SCHEMA_VERSION = 1
MAX_TEXT_LENGTH = 500
MAX_ALIASES = 30
MAX_LARGE_LOOKUP_TERMS = 200
MAX_LARGE_SEARCH_RESULTS = 100
MAX_LARGE_SEARCH_OFFSET = 10000
MAX_PERSONAL_IMPORT_TAGS = 10000
MAX_COMMUNITY_PACK_TAGS = 20000
MAX_BACKUP_FILES = 50


LARGE_CATEGORY_LABELS = {
    0: "通用",
    1: "画师",
    3: "作品",
    4: "角色",
    5: "元标签",
}


def normalize_key(value):
    return " ".join(str(value).strip().lower().replace("_", " ").split())


def _clean_text(value, field, required=False):
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ValueError(f"{field} 必须是文本")
    value = value.strip()
    if required and not value:
        raise ValueError(f"{field} 不能为空")
    if len(value) > MAX_TEXT_LENGTH:
        raise ValueError(f"{field} 过长")
    return value


def validate_tag(value, *, default_source="user"):
    if not isinstance(value, dict):
        raise ValueError("标签必须是对象")

    english = _clean_text(value.get("english"), "英文标签", required=True)
    chinese = _clean_text(value.get("chinese"), "中文标签", required=True)
    category = _clean_text(value.get("category", "自定义"), "分类") or "自定义"
    notes = _clean_text(value.get("notes", ""), "说明")
    source = _clean_text(value.get("source", default_source), "来源") or default_source

    aliases = value.get("aliases", [])
    if isinstance(aliases, str):
        aliases = [part.strip() for part in aliases.replace("，", ",").split(",")]
    if not isinstance(aliases, list):
        raise ValueError("中文别名必须是数组或逗号分隔文本")
    cleaned_aliases = []
    for alias in aliases[:MAX_ALIASES]:
        alias = _clean_text(alias, "中文别名")
        if alias and alias != chinese and alias not in cleaned_aliases:
            cleaned_aliases.append(alias)

    models = value.get("models", ["general"])
    if isinstance(models, str):
        models = [part.strip() for part in models.replace("，", ",").split(",")]
    if not isinstance(models, list):
        raise ValueError("适用模型必须是数组或逗号分隔文本")
    cleaned_models = []
    for model in models[:20]:
        model = _clean_text(model, "适用模型")
        if model and model not in cleaned_models:
            cleaned_models.append(model)

    weight = value.get("recommended_weight")
    if weight in (None, ""):
        weight = None
    else:
        try:
            weight = float(weight)
        except (TypeError, ValueError) as exc:
            raise ValueError("推荐权重必须是数字") from exc
        if not 0 <= weight <= 100:
            raise ValueError("推荐权重必须在 0 到 100 之间")

    return {
        "english": english,
        "chinese": chinese,
        "aliases": cleaned_aliases,
        "category": category,
        "models": cleaned_models or ["general"],
        "recommended_weight": weight,
        "notes": notes,
        "source": source,
        "verified": bool(value.get("verified", default_source == "user")),
    }


class DictionaryStore:
    def __init__(self, data_dir=None):
        self.data_dir = Path(data_dir or Path(__file__).resolve().parent / "data")
        self.builtin_path = self.data_dir / "base_tags.json"
        self.user_path = self.data_dir / "user_tags.json"
        self.backup_dir = self.data_dir / "backups"
        self.packs_dir = self.data_dir / "packs"
        self.manifest_path = self.packs_dir / "manifest.json"
        self.pack_settings_path = self.data_dir / "pack_settings.json"
        self.large_db_path = self.data_dir / "danbooru_tags.sqlite3"
        self.large_settings_path = self.data_dir / "large_dictionary.json"
        self.search_concepts_path = self.data_dir / "search_concepts.json"

    @staticmethod
    def _read_json(path, default=None):
        if not path.exists():
            return default
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    @staticmethod
    def _write_json_atomic(path, payload):
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(prefix=f"{path.stem}_", suffix=".json", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            os.replace(temp_name, path)
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)

    @staticmethod
    def _read_tags(path):
        if not path.exists():
            return []
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        tags = payload.get("tags", payload) if isinstance(payload, dict) else payload
        if not isinstance(tags, list):
            raise ValueError(f"词库格式不正确：{path.name}")
        return tags

    def _manifest(self):
        payload = self._read_json(self.manifest_path)
        if payload is None:
            return {
                "schema_version": PACK_SCHEMA_VERSION,
                "packs": [{
                    "id": "legacy_base",
                    "name": "基础常用词库（兼容模式）",
                    "filename": "../base_tags.json",
                    "version": "1.0.0",
                    "source": "扩展内置",
                    "priority": 10,
                    "enabled": True,
                    "readonly": True,
                    "legacy": True,
                }],
            }
        if not isinstance(payload, dict) or not isinstance(payload.get("packs"), list):
            raise ValueError("词库包清单 manifest.json 格式不正确")
        return payload

    def _pack_settings(self):
        payload = self._read_json(self.pack_settings_path, {"schema_version": PACK_SCHEMA_VERSION, "enabled": {}})
        if not isinstance(payload, dict) or not isinstance(payload.get("enabled", {}), dict):
            raise ValueError("词库包启停配置格式不正确")
        return payload

    def _pack_path(self, definition):
        filename = _clean_text(definition.get("filename"), "词库包文件名", required=True)
        if definition.get("legacy") and filename == "../base_tags.json":
            return self.builtin_path
        if Path(filename).name != filename or not filename.lower().endswith(".json"):
            raise ValueError(f"词库包文件名不安全：{filename}")
        return self.packs_dir / filename

    def _pack_definitions(self):
        settings = self._pack_settings().get("enabled", {})
        definitions = []
        seen = set()
        for position, raw in enumerate(self._manifest()["packs"]):
            if not isinstance(raw, dict):
                raise ValueError("词库包清单包含无效项目")
            pack_id = _clean_text(raw.get("id"), "词库包ID", required=True)
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", pack_id):
                raise ValueError(f"词库包ID格式不正确：{pack_id}")
            if pack_id in seen:
                raise ValueError(f"词库包ID重复：{pack_id}")
            seen.add(pack_id)
            definition = {
                **raw,
                "id": pack_id,
                "name": _clean_text(raw.get("name", pack_id), "词库包名称", required=True),
                "version": _clean_text(raw.get("version", "1.0.0"), "词库包版本") or "1.0.0",
                "source": _clean_text(raw.get("source", "未知来源"), "词库包来源") or "未知来源",
                "priority": int(raw.get("priority", position * 10 + 10)),
                "enabled": bool(settings.get(pack_id, raw.get("enabled", True))),
                "readonly": bool(raw.get("readonly", not pack_id.startswith("community_"))),
            }
            definitions.append(definition)
        return sorted(definitions, key=lambda item: (item["priority"], item["id"]))

    def _tags_for_pack(self, definition):
        values = self._read_tags(self._pack_path(definition))
        tags = []
        for value in values:
            clean = validate_tag(value, default_source="builtin" if definition["readonly"] else f"community:{definition['id']}")
            clean.update({
                "pack_id": definition["id"],
                "pack_name": definition["name"],
                "pack_source": definition["source"],
            })
            tags.append(clean)
        return tags

    def pack_snapshot(self):
        packs = []
        for definition in self._pack_definitions():
            count = len(self._tags_for_pack(definition))
            packs.append({key: value for key, value in definition.items() if key not in {"filename", "legacy"}} | {"count": count})
        return packs

    def builtin_tags(self):
        effective = {}
        for definition in self._pack_definitions():
            if not definition["enabled"]:
                continue
            for tag in self._tags_for_pack(definition):
                effective[normalize_key(tag["english"])] = tag
        return list(effective.values())

    def user_tags(self):
        return [validate_tag(tag, default_source="user") for tag in self._read_tags(self.user_path)]

    def snapshot(self):
        builtin = self.builtin_tags()
        user = self.user_tags()
        effective = {normalize_key(tag["english"]): tag for tag in builtin}
        for tag in user:
            clean = {**tag, "pack_id": "personal", "pack_name": "个人词库", "pack_source": "本机用户"}
            effective[normalize_key(tag["english"])] = clean
        return {
            "schema_version": SCHEMA_VERSION,
            "builtin": builtin,
            "user": user,
            "tags": list(effective.values()),
            "packs": self.pack_snapshot(),
            "large_dictionary": self.large_dictionary_snapshot(),
            "search_concepts": self.search_concepts(),
        }

    def search_concepts(self):
        payload = self._read_json(
            self.search_concepts_path,
            {"schema_version": 1, "modifiers": {}, "concepts": []},
        )
        if not isinstance(payload, dict):
            return {"schema_version": 1, "modifiers": {}, "concepts": []}
        modifiers = payload.get("modifiers", {})
        concepts = payload.get("concepts", [])
        return {
            "schema_version": 1,
            "modifiers": modifiers if isinstance(modifiers, dict) else {},
            "concepts": concepts if isinstance(concepts, list) else [],
        }

    def _large_settings(self):
        payload = self._read_json(self.large_settings_path, {"schema_version": 1, "enabled": True})
        if not isinstance(payload, dict):
            raise ValueError("大型词库配置格式不正确")
        return payload

    def _open_large_db(self):
        if not self.large_db_path.exists():
            raise FileNotFoundError("尚未安装 Danbooru 大型词库")
        uri = f"file:{self.large_db_path.resolve().as_posix()}?mode=ro"
        connection = sqlite3.connect(uri, uri=True, timeout=2.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only = ON")
        return connection

    @staticmethod
    def _large_metadata(connection):
        try:
            rows = connection.execute("SELECT key, value FROM metadata").fetchall()
        except sqlite3.Error:
            return {}
        return {str(row["key"]): str(row["value"]) for row in rows}

    def large_dictionary_snapshot(self):
        enabled = bool(self._large_settings().get("enabled", True))
        base = {
            "id": "danbooru_large",
            "name": "Danbooru 中英大型词库",
            "enabled": enabled,
            "available": False,
            "readonly": True,
            "query_mode": "on_demand",
            "count": 0,
            "version": "未安装",
            "source": "本地 SQLite",
        }
        if not self.large_db_path.exists():
            return base
        try:
            with closing(self._open_large_db()) as connection:
                metadata = self._large_metadata(connection)
                count = int(metadata.get("rows") or connection.execute("SELECT COUNT(*) FROM tags").fetchone()[0])
                return {
                    **base,
                    "available": True,
                    "count": count,
                    "version": metadata.get("updated", metadata.get("version", "本地版")),
                    "source": metadata.get("source", "Danbooru 社区中英对照"),
                    "source_url": metadata.get("source_url", ""),
                    "license_note": metadata.get("license_note", ""),
                }
        except (OSError, ValueError, sqlite3.Error) as error:
            return {**base, "error": f"大型词库不可用：{error}"}

    def set_large_dictionary_enabled(self, enabled):
        settings = self._large_settings()
        settings["schema_version"] = 1
        settings["enabled"] = bool(enabled)
        self._write_json_atomic(self.large_settings_path, settings)
        return self.large_dictionary_snapshot()

    @staticmethod
    def _large_tag(row):
        category_id = int(row["category_id"])
        return {
            "english": row["name"],
            "chinese": row["chinese"],
            "aliases": [],
            "category": row["category"] or LARGE_CATEGORY_LABELS.get(category_id, f"Danbooru分类 {category_id}"),
            "models": ["general", "anima"],
            "recommended_weight": None,
            "notes": f"Danbooru 使用量 {int(row['post_count'])}",
            "source": "danbooru-large",
            "verified": True,
            "pack_id": "danbooru_large",
            "pack_name": "Danbooru 中英大型词库",
            "pack_source": "本地只读 SQLite",
            "post_count": int(row["post_count"]),
            "readonly": True,
        }

    def lookup_large_tags(self, values):
        status = self.large_dictionary_snapshot()
        if not status["available"] or not status["enabled"]:
            return []
        if not isinstance(values, list):
            raise ValueError("批量查询必须提供 terms 数组")
        keys = []
        seen = set()
        for value in values[:MAX_LARGE_LOOKUP_TERMS]:
            key = normalize_key(value)
            if key and key not in seen:
                seen.add(key)
                keys.append(key)
        if not keys:
            return []
        placeholders = ",".join("?" for _ in keys)
        with closing(self._open_large_db()) as connection:
            rows = connection.execute(
                f"SELECT name, name_key, category_id, category, post_count, chinese FROM tags WHERE name_key IN ({placeholders})",
                keys,
            ).fetchall()
        by_key = {row["name_key"]: self._large_tag(row) for row in rows}
        return [by_key[key] for key in keys if key in by_key]

    @staticmethod
    def _escape_like(value):
        return str(value).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    def _search_variants(self, query):
        raw_query = str(query or "").strip()
        if not raw_query:
            return []
        variants = []
        seen = set()

        def add(value, relation="direct", label=""):
            text = str(value or "").strip()
            key = normalize_key(text)
            if not key or key in seen:
                return
            seen.add(key)
            variants.append({"text": text, "key": key, "relation": relation, "label": label})

        add(raw_query)
        payload = self.search_concepts()
        normalized_query = normalize_key(raw_query)
        for concept in payload.get("concepts", []):
            if not isinstance(concept, dict):
                continue
            queries = [str(item or "").strip() for item in concept.get("queries", [])]
            matched_query = next((item for item in queries if item and (
                normalize_key(item) == normalized_query or item.lower() in raw_query.lower()
            )), None)
            if not matched_query:
                continue
            label = str(concept.get("label") or concept.get("id") or "相关概念")
            residual = raw_query.lower().replace(matched_query.lower(), "").strip()
            modifier_terms = []
            for modifier, values in payload.get("modifiers", {}).items():
                if str(modifier).strip() and str(modifier).strip().lower() in residual:
                    modifier_terms.extend(values if isinstance(values, list) else [values])
            terms = concept.get("terms", []) if isinstance(concept.get("terms", []), list) else []
            if modifier_terms:
                for modifier in modifier_terms[:3]:
                    for term in terms[:12]:
                        if re.search(r"[A-Za-z]", str(term)):
                            add(f"{modifier} {term}", "concept-modified", label)
            for term in terms:
                add(term, "concept", label)
                if len(variants) >= 20:
                    break
            if len(variants) >= 20:
                break
        return variants[:20]

    def search_large_tags_page(self, query, limit=40, offset=0):
        status = self.large_dictionary_snapshot()
        raw_query = str(query or "").strip()
        limit = max(1, min(MAX_LARGE_SEARCH_RESULTS, int(limit)))
        offset = max(0, min(MAX_LARGE_SEARCH_OFFSET, int(offset)))
        if not status["available"] or not status["enabled"]:
            return {
                "items": [], "has_more": False, "offset": offset,
                "next_offset": offset, "query": raw_query, "expanded_terms": [],
            }
        variants = self._search_variants(raw_query)
        if not variants:
            return {
                "items": [], "has_more": False, "offset": offset,
                "next_offset": offset, "query": raw_query, "expanded_terms": [],
            }

        rank_cases = []
        rank_parameters = []
        where_groups = []
        where_parameters = []
        for index, variant in enumerate(variants):
            key = variant["key"]
            raw_lower = variant["text"].lower()
            key_like = self._escape_like(key)
            chinese_like = self._escape_like(raw_lower)
            base_rank = index * 10
            rank_cases.extend([
                f"WHEN name_key = ? THEN {base_rank}",
                f"WHEN lower(chinese) = ? THEN {base_rank + 1}",
                f"WHEN name_key LIKE ? ESCAPE '\\' THEN {base_rank + 2}",
                f"WHEN lower(chinese) LIKE ? ESCAPE '\\' THEN {base_rank + 3}",
                f"WHEN name_key LIKE ? ESCAPE '\\' THEN {base_rank + 4}",
                f"WHEN lower(chinese) LIKE ? ESCAPE '\\' THEN {base_rank + 5}",
            ])
            parameters = [
                key, raw_lower, f"{key_like}%", f"{chinese_like}%",
                f"%{key_like}%", f"%{chinese_like}%",
            ]
            rank_parameters.extend(parameters)
            where_groups.append("(" + " OR ".join([
                "name_key = ?", "lower(chinese) = ?",
                "name_key LIKE ? ESCAPE '\\'", "lower(chinese) LIKE ? ESCAPE '\\'",
                "name_key LIKE ? ESCAPE '\\'", "lower(chinese) LIKE ? ESCAPE '\\'",
            ]) + ")")
            where_parameters.extend(parameters)

        with closing(self._open_large_db()) as connection:
            rows = connection.execute(
                f"""
                SELECT name, name_key, category_id, category, post_count, chinese,
                       CASE {' '.join(rank_cases)} ELSE 9999 END AS match_rank
                  FROM tags
                 WHERE {' OR '.join(where_groups)}
                 ORDER BY match_rank, post_count DESC, name_key
                 LIMIT ?
                OFFSET ?
                """,
                (*rank_parameters, *where_parameters, limit + 1, offset),
            ).fetchall()
        has_more = len(rows) > limit
        items = [self._large_tag(row) for row in rows[:limit]]
        return {
            "items": items,
            "has_more": has_more,
            "offset": offset,
            "next_offset": offset + len(items),
            "query": raw_query,
            "expanded_terms": [
                {"text": item["text"], "relation": item["relation"], "label": item["label"]}
                for item in variants[1:]
            ],
        }

    def search_large_tags(self, query, limit=40):
        return self.search_large_tags_page(query, limit=limit, offset=0)["items"]

    def _write_user_tags(self, tags):
        self.data_dir.mkdir(parents=True, exist_ok=True)
        payload = {"schema_version": SCHEMA_VERSION, "tags": tags}
        fd, temp_name = tempfile.mkstemp(prefix="user_tags_", suffix=".json", dir=self.data_dir)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            os.replace(temp_name, self.user_path)
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)

    def backup_user_tags(self, reason="manual"):
        if not self.user_path.exists():
            return None
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        safe_reason = "".join(char for char in str(reason) if char.isalnum() or char in "-_") or "backup"
        destination = self.backup_dir / f"user_tags.{safe_reason}.{timestamp}.json"
        shutil.copy2(self.user_path, destination)
        self._prune_backups()
        return destination.name

    def _prune_backups(self):
        if not self.backup_dir.exists():
            return
        files = sorted(
            (path for path in self.backup_dir.iterdir() if path.is_file()),
            key=lambda path: path.stat().st_mtime_ns,
            reverse=True,
        )
        for stale in files[MAX_BACKUP_FILES:]:
            stale.unlink(missing_ok=True)

    def _backup_file(self, path, reason):
        if not path.exists():
            return None
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        safe_reason = "".join(char for char in str(reason) if char.isalnum() or char in "-_") or "backup"
        destination = self.backup_dir / f"{path.stem}.{safe_reason}.{timestamp}{path.suffix}"
        shutil.copy2(path, destination)
        self._prune_backups()
        return destination.name

    def set_pack_enabled(self, pack_id, enabled):
        definition = next((item for item in self._pack_definitions() if item["id"] == pack_id), None)
        if definition is None:
            raise ValueError(f"词库包不存在：{pack_id}")
        settings = self._pack_settings()
        settings.setdefault("enabled", {})[pack_id] = bool(enabled)
        self._write_json_atomic(self.pack_settings_path, settings)
        return {"id": pack_id, "enabled": bool(enabled)}

    @staticmethod
    def _community_pack_id(raw_id, name):
        slug = re.sub(r"[^a-z0-9_-]+", "-", str(raw_id or name).strip().lower()).strip("-_")
        if not slug:
            slug = hashlib.sha1(name.encode("utf-8")).hexdigest()[:12]
        if not slug.startswith("community_"):
            slug = f"community_{slug}"
        if len(slug) > 64:
            slug = slug[:51].rstrip("-_") + "_" + hashlib.sha1(slug.encode("utf-8")).hexdigest()[:10]
        return slug

    def import_pack(self, payload, overwrite=False):
        if not isinstance(payload, dict) or not isinstance(payload.get("tags"), list):
            raise ValueError("社区词库包必须包含 tags 数组")
        if len(payload["tags"]) > MAX_COMMUNITY_PACK_TAGS:
            raise ValueError(f"社区词库包最多允许 {MAX_COMMUNITY_PACK_TAGS} 个词条")
        metadata = payload.get("pack", {})
        if not isinstance(metadata, dict):
            raise ValueError("社区词库包的 pack 信息必须是对象")
        name = _clean_text(metadata.get("name"), "词库包名称", required=True)
        pack_id = self._community_pack_id(metadata.get("id"), name)
        version = _clean_text(metadata.get("version", "1.0.0"), "词库包版本") or "1.0.0"
        source = _clean_text(metadata.get("source", "社区导入"), "词库包来源") or "社区导入"
        license_name = _clean_text(metadata.get("license", ""), "词库包许可")
        homepage = _clean_text(metadata.get("homepage", ""), "词库包主页")

        tags = []
        seen = set()
        for value in payload["tags"]:
            if not isinstance(value, dict):
                raise ValueError("社区词库包包含无效词条")
            clean = validate_tag({**value, "source": f"community:{pack_id}", "verified": value.get("verified", True)}, default_source=f"community:{pack_id}")
            key = normalize_key(clean["english"])
            if key in seen:
                raise ValueError(f"社区词库包内英文标签重复：{clean['english']}")
            seen.add(key)
            tags.append(clean)
        if not tags:
            raise ValueError("社区词库包不能为空")

        manifest = self._manifest()
        existing = next((item for item in manifest["packs"] if item.get("id") == pack_id), None)
        if existing and not str(pack_id).startswith("community_"):
            raise ValueError("不能覆盖内置词库包")
        if existing and not overwrite:
            raise ValueError(f"社区词库包已存在：{pack_id}")

        filename = existing.get("filename") if existing else f"{pack_id}.json"
        priority = int(existing.get("priority", 0)) if existing else max([int(item.get("priority", 0)) for item in manifest["packs"]] + [90]) + 10
        definition = {
            "id": pack_id,
            "name": name,
            "filename": filename,
            "version": version,
            "source": source,
            "priority": priority,
            "enabled": True,
            "readonly": False,
            "community": True,
            "license": license_name,
            "homepage": homepage,
            "imported_at": datetime.now().isoformat(timespec="seconds"),
        }
        pack_path = self.packs_dir / filename
        backups = [
            self._backup_file(self.manifest_path, "before_pack_import"),
            self._backup_file(self.pack_settings_path, "before_pack_import"),
            self._backup_file(pack_path, "before_pack_overwrite"),
        ]
        self._write_json_atomic(pack_path, {
            "schema_version": PACK_SCHEMA_VERSION,
            "pack": {key: value for key, value in definition.items() if key not in {"filename", "enabled"}},
            "tags": tags,
        })
        if existing:
            manifest["packs"] = [definition if item.get("id") == pack_id else item for item in manifest["packs"]]
        else:
            manifest["packs"].append(definition)
        self._write_json_atomic(self.manifest_path, manifest)
        settings = self._pack_settings()
        settings.setdefault("enabled", {})[pack_id] = True
        self._write_json_atomic(self.pack_settings_path, settings)
        return {
            "id": pack_id,
            "name": name,
            "version": version,
            "source": source,
            "count": len(tags),
            "enabled": True,
            "readonly": False,
            "replaced": bool(existing),
            "backups": [item for item in backups if item],
        }

    def export_pack(self, pack_id):
        definition = next((item for item in self._pack_definitions() if item["id"] == pack_id), None)
        if definition is None:
            raise ValueError(f"词库包不存在：{pack_id}")
        return self._read_json(self._pack_path(definition))

    def delete_pack(self, pack_id):
        manifest = self._manifest()
        definition = next((item for item in manifest["packs"] if item.get("id") == pack_id), None)
        if definition is None:
            return False
        if not str(pack_id).startswith("community_") or definition.get("readonly", False):
            raise ValueError("只能删除社区词库包")
        pack_path = self._pack_path({**definition, "readonly": False})
        self._backup_file(self.manifest_path, "before_pack_delete")
        self._backup_file(self.pack_settings_path, "before_pack_delete")
        backup_name = self._backup_file(pack_path, "deleted_pack")
        manifest["packs"] = [item for item in manifest["packs"] if item.get("id") != pack_id]
        self._write_json_atomic(self.manifest_path, manifest)
        settings = self._pack_settings()
        settings.setdefault("enabled", {}).pop(pack_id, None)
        self._write_json_atomic(self.pack_settings_path, settings)
        pack_path.unlink(missing_ok=True)
        return {"deleted": True, "backup": backup_name}

    def upsert(self, value):
        tag = validate_tag(value)
        key = normalize_key(tag["english"])
        tags = self.user_tags()
        replaced = False
        for index, current in enumerate(tags):
            if normalize_key(current["english"]) == key:
                tags[index] = tag
                replaced = True
                break
        if not replaced:
            tags.append(tag)
        tags.sort(key=lambda item: normalize_key(item["english"]))
        self._write_user_tags(tags)
        return tag, replaced

    def delete(self, english):
        key = normalize_key(english)
        tags = self.user_tags()
        kept = [tag for tag in tags if normalize_key(tag["english"]) != key]
        if len(kept) == len(tags):
            return False
        self._write_user_tags(kept)
        return True

    def import_tags(self, values, mode="overwrite"):
        if not isinstance(values, list):
            raise ValueError("导入内容必须包含 tags 数组")
        if len(values) > MAX_PERSONAL_IMPORT_TAGS:
            raise ValueError(f"个人词库单次最多导入 {MAX_PERSONAL_IMPORT_TAGS} 个词条")
        if mode not in {"overwrite", "skip"}:
            raise ValueError("导入模式仅支持 overwrite 或 skip")

        current = {normalize_key(tag["english"]): tag for tag in self.user_tags()}
        added = 0
        replaced = 0
        skipped = 0
        for value in values:
            tag = validate_tag(value)
            key = normalize_key(tag["english"])
            if key in current:
                if mode == "skip":
                    skipped += 1
                    continue
                replaced += 1
            else:
                added += 1
            current[key] = tag

        tags = sorted(current.values(), key=lambda item: normalize_key(item["english"]))
        backup = self.backup_user_tags("before_import")
        self._write_user_tags(tags)
        return {
            "added": added,
            "replaced": replaced,
            "skipped": skipped,
            "total": len(tags),
            "backup": backup,
        }

    def update_many(self, english_values, updates):
        if not isinstance(english_values, list) or not english_values:
            raise ValueError("批量操作必须选择至少一个个人标签")
        if len(english_values) > MAX_PERSONAL_IMPORT_TAGS:
            raise ValueError(f"批量操作最多选择 {MAX_PERSONAL_IMPORT_TAGS} 个词条")
        if not isinstance(updates, dict):
            raise ValueError("批量修改内容必须是对象")
        allowed = {key: updates[key] for key in ("category", "models", "verified") if key in updates}
        if not allowed:
            raise ValueError("没有可批量修改的字段")

        selected = {normalize_key(value) for value in english_values if normalize_key(value)}
        tags = self.user_tags()
        changed = []
        for index, tag in enumerate(tags):
            if normalize_key(tag["english"]) not in selected:
                continue
            candidate = {**tag, **allowed, "source": "user"}
            tags[index] = validate_tag(candidate)
            changed.append(tag["english"])

        if not changed:
            return {"updated": 0, "skipped": len(selected), "backup": None}
        backup = self.backup_user_tags("before_bulk_update")
        tags.sort(key=lambda item: normalize_key(item["english"]))
        self._write_user_tags(tags)
        return {
            "updated": len(changed),
            "skipped": max(0, len(selected) - len(changed)),
            "backup": backup,
        }
