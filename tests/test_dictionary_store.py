import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from dictionary_store import (
    DictionaryStore,
    MAX_COMMUNITY_PACK_TAGS,
    MAX_PERSONAL_IMPORT_TAGS,
    normalize_key,
    validate_tag,
)


class DictionaryStoreTests(unittest.TestCase):
    def make_store(self):
        temp = tempfile.TemporaryDirectory()
        data_dir = Path(temp.name)
        (data_dir / "base_tags.json").write_text(
            json.dumps({"tags": [{"english": "from front", "chinese": "正面视角"}]}),
            encoding="utf-8",
        )
        (data_dir / "user_tags.json").write_text('{"tags": []}', encoding="utf-8")
        return temp, DictionaryStore(data_dir)

    def test_normalize_matches_spaces_and_underscores(self):
        self.assertEqual(normalize_key(" Looking_At_Viewer "), "looking at viewer")

    def test_user_tag_overrides_builtin(self):
        temp, store = self.make_store()
        self.addCleanup(temp.cleanup)
        store.upsert({"english": "from_front", "chinese": "自定义正面", "aliases": "正面"})
        snapshot = store.snapshot()
        self.assertEqual(len(snapshot["tags"]), 1)
        self.assertEqual(snapshot["tags"][0]["chinese"], "自定义正面")

    def test_import_skip_preserves_existing(self):
        temp, store = self.make_store()
        self.addCleanup(temp.cleanup)
        store.upsert({"english": "smile", "chinese": "微笑"})
        result = store.import_tags([{"english": "smile", "chinese": "笑"}], mode="skip")
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(store.user_tags()[0]["chinese"], "微笑")
        self.assertTrue(result["backup"])
        self.assertTrue((store.backup_dir / result["backup"]).exists())

    def test_import_limits_reject_oversized_collections(self):
        temp, store = self.make_store()
        self.addCleanup(temp.cleanup)
        with self.assertRaisesRegex(ValueError, "最多"):
            store.import_tags([{}] * (MAX_PERSONAL_IMPORT_TAGS + 1))
        with self.assertRaisesRegex(ValueError, "最多"):
            store.import_pack({
                "pack": {"name": "过大词库"},
                "tags": [{}] * (MAX_COMMUNITY_PACK_TAGS + 1),
            })

    def test_bulk_update_only_changes_personal_tags(self):
        temp, store = self.make_store()
        self.addCleanup(temp.cleanup)
        store.upsert({"english": "smile", "chinese": "微笑", "category": "表情"})
        result = store.update_many(["smile", "from front"], {"category": "常用", "models": ["anima"]})
        self.assertEqual(result["updated"], 1)
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(store.user_tags()[0]["category"], "常用")
        self.assertEqual(store.user_tags()[0]["models"], ["anima"])
        self.assertTrue((store.backup_dir / result["backup"]).exists())

    def test_validation_rejects_empty_english(self):
        with self.assertRaises(ValueError):
            validate_tag({"english": "", "chinese": "中文"})

    def make_pack_store(self):
        temp = tempfile.TemporaryDirectory()
        data_dir = Path(temp.name)
        packs_dir = data_dir / "packs"
        packs_dir.mkdir()
        (data_dir / "base_tags.json").write_text('{"tags": []}', encoding="utf-8")
        (data_dir / "user_tags.json").write_text('{"tags": []}', encoding="utf-8")
        (packs_dir / "base.json").write_text(
            json.dumps({"tags": [{"english": "smile", "chinese": "微笑"}]}), encoding="utf-8"
        )
        (packs_dir / "camera.json").write_text(
            json.dumps({"tags": [{"english": "close-up", "chinese": "特写"}]}), encoding="utf-8"
        )
        (packs_dir / "manifest.json").write_text(json.dumps({
            "schema_version": 1,
            "packs": [
                {"id": "base", "name": "基础", "filename": "base.json", "version": "1.0", "source": "内置", "priority": 10, "enabled": True},
                {"id": "camera", "name": "镜头", "filename": "camera.json", "version": "1.0", "source": "内置", "priority": 20, "enabled": True},
            ],
        }), encoding="utf-8")
        (data_dir / "pack_settings.json").write_text(json.dumps({"enabled": {"base": True, "camera": False}}), encoding="utf-8")
        return temp, DictionaryStore(data_dir)

    def test_pack_enable_disable_and_personal_priority(self):
        temp, store = self.make_pack_store()
        self.addCleanup(temp.cleanup)
        snapshot = store.snapshot()
        self.assertEqual([tag["english"] for tag in snapshot["builtin"]], ["smile"])
        self.assertFalse(next(pack for pack in snapshot["packs"] if pack["id"] == "camera")["enabled"])
        store.set_pack_enabled("camera", True)
        self.assertIn("close-up", [tag["english"] for tag in store.snapshot()["builtin"]])
        store.upsert({"english": "smile", "chinese": "个人微笑"})
        effective = {tag["english"]: tag for tag in store.snapshot()["tags"]}
        self.assertEqual(effective["smile"]["chinese"], "个人微笑")
        self.assertEqual(effective["smile"]["pack_id"], "personal")

    def test_community_pack_lifecycle(self):
        temp, store = self.make_pack_store()
        self.addCleanup(temp.cleanup)
        payload = {
            "pack": {"id": "artist-tools", "name": "社区绘画工具", "version": "2.1", "source": "测试社区"},
            "tags": [{"english": "palette knife", "chinese": "调色刀"}],
        }
        imported = store.import_pack(payload)
        self.assertEqual(imported["id"], "community_artist-tools")
        self.assertEqual(imported["count"], 1)
        self.assertIn("palette knife", [tag["english"] for tag in store.snapshot()["builtin"]])
        exported = store.export_pack(imported["id"])
        self.assertEqual(exported["pack"]["name"], "社区绘画工具")
        with self.assertRaises(ValueError):
            store.import_pack(payload)
        replaced = store.import_pack({**payload, "tags": [{"english": "palette knife", "chinese": "油画调色刀"}]}, overwrite=True)
        self.assertTrue(replaced["replaced"])
        deleted = store.delete_pack(imported["id"])
        self.assertTrue(deleted["deleted"])
        self.assertTrue((store.backup_dir / deleted["backup"]).exists())
        self.assertNotIn(imported["id"], [pack["id"] for pack in store.pack_snapshot()])

    def test_builtin_pack_cannot_be_deleted(self):
        temp, store = self.make_pack_store()
        self.addCleanup(temp.cleanup)
        with self.assertRaises(ValueError):
            store.delete_pack("base")

    @staticmethod
    def install_large_dictionary(store):
        with closing(sqlite3.connect(store.large_db_path)) as connection:
            connection.executescript("""
                CREATE TABLE tags (
                    name TEXT NOT NULL,
                    name_key TEXT PRIMARY KEY,
                    category_id INTEGER NOT NULL,
                    category TEXT NOT NULL,
                    post_count INTEGER NOT NULL,
                    chinese TEXT NOT NULL
                ) WITHOUT ROWID;
                CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
            """)
            connection.executemany(
                "INSERT INTO tags(name,name_key,category_id,category,post_count,chinese) VALUES(?,?,?,?,?,?)",
                [
                    ("long_hair", "long hair", 0, "通用", 1000, "长发"),
                    ("keqing_(genshin_impact)", "keqing (genshin impact)", 4, "角色", 500, "刻晴（原神）"),
                ],
            )
            connection.executemany("INSERT INTO metadata(key,value) VALUES(?,?)", [
                ("rows", "2"), ("updated", "2026-09-03"), ("source", "测试来源"),
            ])
            connection.commit()

    def test_large_dictionary_exact_lookup_and_search(self):
        temp, store = self.make_store()
        self.addCleanup(temp.cleanup)
        self.install_large_dictionary(store)
        status = store.large_dictionary_snapshot()
        self.assertTrue(status["available"])
        self.assertEqual(status["count"], 2)
        matches = store.lookup_large_tags(["LONG HAIR", "missing", "long_hair"])
        self.assertEqual([item["english"] for item in matches], ["long_hair"])
        self.assertEqual(matches[0]["pack_id"], "danbooru_large")
        self.assertEqual(store.search_large_tags("刻晴", 10)[0]["english"], "keqing_(genshin_impact)")

    def test_large_dictionary_can_be_disabled_without_affecting_small_tags(self):
        temp, store = self.make_store()
        self.addCleanup(temp.cleanup)
        self.install_large_dictionary(store)
        store.set_large_dictionary_enabled(False)
        self.assertEqual(store.lookup_large_tags(["long hair"]), [])
        self.assertEqual(store.search_large_tags("长发"), [])
        self.assertEqual(store.snapshot()["tags"][0]["english"], "from front")


if __name__ == "__main__":
    unittest.main()
