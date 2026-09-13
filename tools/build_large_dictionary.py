"""Build the read-only, on-demand Danbooru SQLite dictionary used by BPI.

Supported sources:

* A four-column TSV: name, category, post_count, Chinese name.
* ffdkj's tag.sqlite: tags(name, category, cn_name, post_count).

The source dataset is never copied into the browser bundle. The source SQLite is
opened read-only, validated, and converted to BPI's indexed schema.
"""

import argparse
import csv
import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
from contextlib import closing
from datetime import datetime
from pathlib import Path


CATEGORY_LABELS = {
    0: "通用",
    1: "画师",
    3: "作品",
    4: "角色",
    5: "元标签",
}

FFDKJ_SOURCE_NAME = "ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table"
FFDKJ_SOURCE_URL = "https://github.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table"
FFDKJ_LICENSE_NOTE = (
    "来源仓库在本扩展构建时未附带明确开源许可证；仅供用户自行下载后本地离线查询，"
    "本扩展公开包不重新分发原始或转换后的数据库。"
)
REQUIRED_SOURCE_COLUMNS = {"name", "category", "cn_name", "post_count"}


def normalize_key(value):
    return " ".join(str(value).strip().lower().replace("_", " ").split())


def read_source_metadata(path):
    metadata_path = path.with_name("meta.json")
    if not metadata_path.exists():
        return {}
    try:
        value = json.loads(metadata_path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def is_sqlite_source(path):
    with path.open("rb") as handle:
        return handle.read(16) == b"SQLite format 3\x00"


def source_updated_date(path, source_meta):
    declared = str(source_meta.get("updated", "")).strip()
    if declared:
        return declared
    return datetime.fromtimestamp(path.stat().st_mtime).date().isoformat()


def sqlite_source_details(source_path):
    uri = f"file:{source_path.as_posix()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True, timeout=5.0)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only = ON")
        integrity = connection.execute("PRAGMA quick_check").fetchone()[0]
        if integrity != "ok":
            raise ValueError(f"来源 SQLite 完整性检查失败：{integrity}")
        table = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tags'"
        ).fetchone()
        if table is None:
            raise ValueError("来源 SQLite 缺少 tags 表")
        columns = {str(row["name"]) for row in connection.execute("PRAGMA table_info(tags)")}
        missing = sorted(REQUIRED_SOURCE_COLUMNS - columns)
        if missing:
            raise ValueError(f"来源 SQLite 的 tags 表缺少字段：{', '.join(missing)}")
        rows = int(connection.execute("SELECT COUNT(*) FROM tags").fetchone()[0])
        if rows <= 0:
            raise ValueError("来源 SQLite 的 tags 表为空")
        return rows
    finally:
        connection.close()


def iter_sqlite_rows(source_path):
    uri = f"file:{source_path.as_posix()}?mode=ro"
    with closing(sqlite3.connect(uri, uri=True, timeout=5.0)) as connection:
        connection.execute("PRAGMA query_only = ON")
        cursor = connection.execute("SELECT name, category, post_count, cn_name FROM tags")
        while True:
            rows = cursor.fetchmany(5000)
            if not rows:
                break
            yield from rows


def iter_tsv_rows(source_path):
    with source_path.open("r", encoding="utf-8-sig", newline="") as handle:
        yield from csv.reader(handle, delimiter="\t")


def normalized_row(row):
    if len(row) < 4:
        return None
    name = str(row[0] or "").strip()
    chinese = str(row[3] or "").strip()
    key = normalize_key(name)
    if not key or not chinese:
        return None
    try:
        category_id = int(row[1])
        post_count = max(0, int(row[2]))
    except (TypeError, ValueError):
        return None
    return (
        name,
        key,
        category_id,
        CATEGORY_LABELS.get(category_id, f"Danbooru分类 {category_id}"),
        post_count,
        chinese,
    )


def source_identity(source_path, source_format, source_meta):
    if source_format == "ffdkj-sqlite":
        return {
            "source": FFDKJ_SOURCE_NAME,
            "source_url": FFDKJ_SOURCE_URL,
            "license_note": FFDKJ_LICENSE_NOTE,
        }
    sources = source_meta.get("sources") if isinstance(source_meta.get("sources"), list) else []
    source_names = " + ".join(
        str(item.get("name", "")).strip()
        for item in sources
        if isinstance(item, dict) and item.get("name")
    )
    source_urls = " | ".join(
        str(item.get("url", "")).strip()
        for item in sources
        if isinstance(item, dict) and item.get("url")
    )
    return {
        "source": source_names or "Danbooru 社区中英对照",
        "source_url": source_urls,
        "license_note": str(
            source_meta.get("license_note", "仅供本地离线查询；授权以各来源仓库说明为准。")
        ),
    }


def backup_destination(destination_path):
    return destination_path.with_name(f"{destination_path.name}.previous")


def build_database(source_path, destination_path, *, backup=True):
    source_path = Path(source_path).resolve()
    destination_path = Path(destination_path).resolve()
    if not source_path.is_file():
        raise FileNotFoundError(f"找不到源词库：{source_path}")
    if source_path == destination_path:
        raise ValueError("来源数据库和输出数据库不能是同一个文件")

    source_meta = read_source_metadata(source_path)
    source_format = "ffdkj-sqlite" if is_sqlite_source(source_path) else "four-column-tsv"
    if source_format == "ffdkj-sqlite":
        source_rows = sqlite_source_details(source_path)
        rows = iter_sqlite_rows(source_path)
    else:
        source_rows = None
        rows = iter_tsv_rows(source_path)

    destination_path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix="danbooru_tags_", suffix=".sqlite3", dir=destination_path.parent
    )
    os.close(fd)
    accepted = 0
    skipped = 0
    actual_rows = 0
    try:
        connection = sqlite3.connect(temp_name)
        try:
            connection.executescript(
                """
                PRAGMA journal_mode = OFF;
                PRAGMA synchronous = OFF;
                PRAGMA temp_store = MEMORY;
                CREATE TABLE tags (
                    name TEXT NOT NULL,
                    name_key TEXT PRIMARY KEY,
                    category_id INTEGER NOT NULL,
                    category TEXT NOT NULL,
                    post_count INTEGER NOT NULL,
                    chinese TEXT NOT NULL
                ) WITHOUT ROWID;
                CREATE TABLE metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                ) WITHOUT ROWID;
                """
            )
            batch = []
            for row in rows:
                clean = normalized_row(row)
                if clean is None:
                    skipped += 1
                    continue
                batch.append(clean)
                if len(batch) >= 5000:
                    connection.executemany(
                        "INSERT OR REPLACE INTO tags(name,name_key,category_id,category,post_count,chinese) "
                        "VALUES(?,?,?,?,?,?)",
                        batch,
                    )
                    accepted += len(batch)
                    batch.clear()
            if batch:
                connection.executemany(
                    "INSERT OR REPLACE INTO tags(name,name_key,category_id,category,post_count,chinese) "
                    "VALUES(?,?,?,?,?,?)",
                    batch,
                )
                accepted += len(batch)

            connection.executescript(
                """
                CREATE INDEX idx_tags_chinese ON tags(chinese);
                CREATE INDEX idx_tags_post_count ON tags(post_count DESC);
                CREATE INDEX idx_tags_category ON tags(category_id, post_count DESC);
                """
            )
            actual_rows = int(connection.execute("SELECT COUNT(*) FROM tags").fetchone()[0])
            identity = source_identity(source_path, source_format, source_meta)
            metadata = {
                "schema_version": "1",
                "rows": str(actual_rows),
                "source_rows": str(source_rows if source_rows is not None else accepted + skipped),
                "skipped_rows": str(skipped),
                "updated": source_updated_date(source_path, source_meta),
                **identity,
                "source_file": source_path.name,
                "source_format": source_format,
                "source_sha256": file_sha256(source_path),
                "built_at": datetime.now().isoformat(timespec="seconds"),
            }
            connection.executemany("INSERT INTO metadata(key,value) VALUES(?,?)", metadata.items())
            connection.commit()
            if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise ValueError("生成的数据库未通过完整性检查")
            connection.execute("PRAGMA optimize")
        finally:
            connection.close()

        previous_path = None
        if backup and destination_path.exists():
            previous_path = backup_destination(destination_path)
            shutil.copy2(destination_path, previous_path)
        os.replace(temp_name, destination_path)
        return {
            "rows": actual_rows,
            "source_rows": source_rows if source_rows is not None else accepted + skipped,
            "skipped": skipped,
            "source_format": source_format,
            "path": str(destination_path),
            "backup": str(previous_path) if previous_path else "",
        }
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def main():
    parser = argparse.ArgumentParser(
        description="从四列 TSV 或 ffdkj tag.sqlite 构建双语提示词检查器的大型按需查询词库"
    )
    parser.add_argument("source", help="四列 TSV 或 ffdkj tag.sqlite 的完整路径")
    parser.add_argument(
        "--output",
        default=str(Path(__file__).resolve().parents[1] / "data" / "danbooru_tags.sqlite3"),
    )
    parser.add_argument("--no-backup", action="store_true", help="替换已有数据库时不保留 .previous 备份")
    args = parser.parse_args()
    print(
        json.dumps(
            build_database(args.source, args.output, backup=not args.no_backup),
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
