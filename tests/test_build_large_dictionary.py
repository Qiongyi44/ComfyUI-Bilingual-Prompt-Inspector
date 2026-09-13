import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "build_large_dictionary", ROOT / "tools" / "build_large_dictionary.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class LargeDictionaryBuilderTests(unittest.TestCase):
    def create_ffdkj_source(self, path):
        connection = sqlite3.connect(path)
        try:
            connection.execute(
                "CREATE TABLE tags (name TEXT PRIMARY KEY, category INTEGER, cn_name TEXT, post_count INTEGER)"
            )
            connection.executemany(
                "INSERT INTO tags(name,category,cn_name,post_count) VALUES(?,?,?,?)",
                [
                    ("1girl", 0, "一名女性角色", 100),
                    ("keqing_(genshin_impact)", 4, "刻晴（原神）", 50),
                    ("", 0, "无效", 1),
                ],
            )
            connection.commit()
        finally:
            connection.close()

    def test_converts_ffdkj_sqlite_without_modifying_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "tag.sqlite"
            output = root / "danbooru_tags.sqlite3"
            self.create_ffdkj_source(source)
            before = MODULE.file_sha256(source)

            result = MODULE.build_database(source, output)

            self.assertEqual(result["source_format"], "ffdkj-sqlite")
            self.assertEqual(result["source_rows"], 3)
            self.assertEqual(result["rows"], 2)
            self.assertEqual(result["skipped"], 1)
            self.assertEqual(before, MODULE.file_sha256(source))
            connection = sqlite3.connect(output)
            try:
                row = connection.execute(
                    "SELECT name, name_key, category, chinese FROM tags WHERE name_key = ?",
                    ("keqing (genshin impact)",),
                ).fetchone()
                self.assertEqual(
                    row,
                    ("keqing_(genshin_impact)", "keqing (genshin impact)", "角色", "刻晴（原神）"),
                )
                metadata = dict(connection.execute("SELECT key, value FROM metadata"))
                self.assertEqual(metadata["source"], MODULE.FFDKJ_SOURCE_NAME)
                self.assertEqual(metadata["source_format"], "ffdkj-sqlite")
                self.assertEqual(metadata["rows"], "2")
            finally:
                connection.close()

    def test_keeps_legacy_tsv_support_and_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "danbooru_zh.tsv"
            source.write_text("1girl\t0\t100\t一名女性角色\n", encoding="utf-8")
            (root / "meta.json").write_text(
                json.dumps(
                    {
                        "updated": "2026-09-03",
                        "sources": [{"name": "测试来源", "url": "https://example.invalid"}],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            output = root / "danbooru_tags.sqlite3"

            result = MODULE.build_database(source, output)

            self.assertEqual(result["source_format"], "four-column-tsv")
            self.assertEqual(result["rows"], 1)
            connection = sqlite3.connect(output)
            try:
                metadata = dict(connection.execute("SELECT key, value FROM metadata"))
                self.assertEqual(metadata["source"], "测试来源")
                self.assertEqual(metadata["updated"], "2026-09-03")
            finally:
                connection.close()

    def test_backs_up_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "tag.sqlite"
            output = root / "danbooru_tags.sqlite3"
            self.create_ffdkj_source(source)
            output.write_bytes(b"old database")

            result = MODULE.build_database(source, output)

            backup = Path(result["backup"])
            self.assertTrue(backup.is_file())
            self.assertEqual(backup.read_bytes(), b"old database")

    def test_rejects_incompatible_sqlite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "wrong.sqlite"
            connection = sqlite3.connect(source)
            connection.execute("CREATE TABLE other(value TEXT)")
            connection.commit()
            connection.close()

            with self.assertRaisesRegex(ValueError, "缺少 tags 表"):
                MODULE.build_database(source, root / "output.sqlite3")


if __name__ == "__main__":
    unittest.main()
