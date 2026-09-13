from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
LEGACY_PATH = DATA_DIR / "base_tags.json"
PACKS_DIR = DATA_DIR / "packs"
MANIFEST_PATH = PACKS_DIR / "manifest.json"
SETTINGS_PATH = DATA_DIR / "pack_settings.json"

PACK_DEFINITIONS = [
    {"id": "base", "name": "基础常用词库", "filename": "base.json", "version": "1.0.0", "source": "扩展内置", "priority": 10, "enabled": True},
    {"id": "anima", "name": "Anima词库", "filename": "anima.json", "version": "1.0.0", "source": "扩展内置·Anima", "priority": 20, "enabled": True},
    {"id": "characters", "name": "角色与作品词库", "filename": "characters.json", "version": "1.0.0", "source": "扩展内置", "priority": 30, "enabled": True},
    {"id": "poses", "name": "姿势词库", "filename": "poses.json", "version": "1.0.0", "source": "扩展内置", "priority": 40, "enabled": True},
    {"id": "camera", "name": "镜头构图词库", "filename": "camera.json", "version": "1.0.0", "source": "扩展内置", "priority": 50, "enabled": True},
    {"id": "clothing", "name": "服装词库", "filename": "clothing.json", "version": "1.0.0", "source": "扩展内置", "priority": 60, "enabled": True},
    {"id": "adult", "name": "成人内容词库", "filename": "adult.json", "version": "1.0.0", "source": "扩展内置·仅限成年角色", "priority": 70, "enabled": True},
]

ANIMA_TERMS = {"absurdres", "clean line art", "cel shading", "anime illustration"}
CHARACTER_CATEGORIES = {"人物数量", "发型", "发色", "眼睛", "表情", "视线"}
POSE_CATEGORIES = {"姿势", "动作", "手部动作", "人物朝向"}
CAMERA_CATEGORIES = {"相机方位", "相机高度", "相机角度", "景别", "构图", "镜头", "景深", "运镜"}


def tag(english, chinese, category, aliases=(), models=("general", "anima")):
    return {
        "english": english,
        "chinese": chinese,
        "aliases": list(aliases),
        "category": category,
        "models": list(models),
        "source": "builtin",
        "verified": True,
    }


EXTRA_TAGS = {
    "anima": [
        tag("anime coloring", "动漫上色", "Anima风格", ("二次元上色",), ("anima",)),
        tag("game character illustration", "游戏角色插画", "Anima风格", ("游戏人物立绘",), ("anima",)),
        tag("character sheet", "角色设定图", "Anima构图", ("人物设定图",), ("anima",)),
        tag("official art", "官方美术风格", "Anima风格", ("官方立绘风格",), ("anima",)),
    ],
    "characters": [
        tag("Hu Tao (Genshin Impact)", "胡桃（原神）", "原神角色", ("胡桃",), ("anima",)),
        tag("Keqing (Genshin Impact)", "刻晴（原神）", "原神角色", ("刻晴",), ("anima",)),
        tag("Nahida (Genshin Impact)", "纳西妲（原神）", "原神角色", ("纳西妲",), ("anima",)),
        tag("Raiden Shogun (Genshin Impact)", "雷电将军（原神）", "原神角色", ("雷电将军", "雷神"), ("anima",)),
        tag("Ganyu (Genshin Impact)", "甘雨（原神）", "原神角色", ("甘雨",), ("anima",)),
        tag("Yae Miko (Genshin Impact)", "八重神子（原神）", "原神角色", ("八重神子",), ("anima",)),
        tag("Lumine (Genshin Impact)", "荧（原神）", "原神角色", ("荧", "女旅行者"), ("anima",)),
        tag("Aether (Genshin Impact)", "空（原神）", "原神角色", ("空", "男旅行者"), ("anima",)),
    ],
    "clothing": [
        tag("dress", "连衣裙", "服装"),
        tag("long dress", "长裙", "服装"),
        tag("short dress", "短裙", "服装"),
        tag("skirt", "裙子", "服装"),
        tag("pleated skirt", "百褶裙", "服装"),
        tag("shirt", "衬衫", "服装"),
        tag("white shirt", "白衬衫", "服装"),
        tag("t-shirt", "T恤", "服装"),
        tag("jacket", "夹克", "服装"),
        tag("coat", "外套", "服装"),
        tag("hoodie", "连帽衫", "服装"),
        tag("sweater", "毛衣", "服装"),
        tag("shorts", "短裤", "服装"),
        tag("pants", "长裤", "服装"),
        tag("black tights", "黑色连裤袜", "腿部服饰", ("黑丝",)),
        tag("white tights", "白色连裤袜", "腿部服饰", ("白丝",)),
        tag("thighhighs", "过膝袜", "腿部服饰", ("长筒袜",)),
        tag("gloves", "手套", "服饰配件"),
        tag("boots", "靴子", "鞋子"),
        tag("high heels", "高跟鞋", "鞋子"),
        tag("sneakers", "运动鞋", "鞋子"),
        tag("hat", "帽子", "服配件"),
        tag("school uniform", "校服", "服装"),
        tag("maid outfit", "女仆装", "服装"),
        tag("traditional chinese clothes", "中式传统服装", "服装", ("中国风服装",)),
    ],
    "adult": [
        tag("adult woman", "成年女性", "成年角色", ("成年女人",)),
        tag("adult man", "成年男性", "成年角色", ("成年男人",)),
        tag("mature female", "成熟女性", "成年角色"),
        tag("mature male", "成熟男性", "成年角色"),
        tag("nude", "裸体", "成人内容"),
        tag("topless", "上身裸露", "成人内容"),
        tag("bottomless", "下身裸露", "成人内容"),
        tag("underwear", "内衣", "成人服饰"),
        tag("lingerie", "情趣内衣", "成人服饰"),
        tag("bra", "胸罩", "成人服饰"),
        tag("panties", "内裤", "成人服饰"),
        tag("cleavage", "乳沟", "成人身体"),
        tag("nipples", "乳头", "成人身体"),
        tag("bare breasts", "裸露乳房", "成人身体"),
        tag("ass", "臀部", "成人身体", ("屁股",)),
        tag("spread legs", "张开双腿", "成人姿势"),
        tag("suggestive pose", "挑逗姿势", "成人姿势"),
        tag("consensual", "自愿", "成人限定", ("双方自愿",)),
        tag("explicit", "露骨内容", "成人限定"),
        tag("NSFW", "不适合工作场合的成人内容", "成人限定", ("成人内容",)),
    ],
}


def destination_for(item):
    if item["english"] in ANIMA_TERMS:
        return "anima"
    category = item.get("category", "")
    if category in CHARACTER_CATEGORIES:
        return "characters"
    if category in POSE_CATEGORIES:
        return "poses"
    if category in CAMERA_CATEGORIES:
        return "camera"
    return "base"


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    legacy = json.loads(LEGACY_PATH.read_text(encoding="utf-8"))
    original = legacy.get("tags", [])
    grouped = {item["id"]: [] for item in PACK_DEFINITIONS}
    for item in original:
        grouped[destination_for(item)].append(item)
    for pack_id, values in EXTRA_TAGS.items():
        grouped[pack_id].extend(values)

    seen = set()
    for pack_id, values in grouped.items():
        for item in values:
            key = " ".join(item["english"].strip().lower().replace("_", " ").split())
            if key in seen:
                raise RuntimeError(f"词条在多个包中重复：{item['english']}")
            seen.add(key)

    PACKS_DIR.mkdir(parents=True, exist_ok=True)
    for definition in PACK_DEFINITIONS:
        payload = {
            "schema_version": 1,
            "pack": {key: value for key, value in definition.items() if key not in {"filename", "enabled"}},
            "tags": grouped[definition["id"]],
        }
        write_json(PACKS_DIR / definition["filename"], payload)
    write_json(MANIFEST_PATH, {"schema_version": 1, "packs": PACK_DEFINITIONS})
    if not SETTINGS_PATH.exists():
        write_json(SETTINGS_PATH, {"schema_version": 1, "enabled": {item["id"]: item["enabled"] for item in PACK_DEFINITIONS}})

    print(f"保留旧基础词库：{LEGACY_PATH}")
    print(f"建立 {len(PACK_DEFINITIONS)} 个词库包，共 {sum(map(len, grouped.values()))} 项")
    for definition in PACK_DEFINITIONS:
        print(f"- {definition['id']}: {len(grouped[definition['id']])}")


if __name__ == "__main__":
    main()
