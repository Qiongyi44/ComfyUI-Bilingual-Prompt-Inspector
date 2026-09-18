import json
import hashlib
import os
import re
import secrets
import tempfile
from ipaddress import ip_address
from pathlib import Path
from urllib.parse import urlparse


LEGACY_DEFAULT_TRANSLATION_RULE = """你是 Anima 模型的双语提示词翻译器。把用户输入忠实转换为英文，不得解释、评价或使用 Markdown。
如果输入是逗号分隔的中文标签，优先输出准确的 Danbooru/Anima 英文标签并保持逗号结构；如果输入是自然语言，则输出忠实流畅的英文自然语言。
保留人物数量、角色名、作品名、画师 @ 前缀、权重、否定关系和用户明确要求。不得擅自增加人物、服装、动作、背景或成人内容。
只返回可直接写入 ComfyUI 文本框的英文提示词。"""

V17_DEFAULT_TRANSLATION_RULE = """你是双语提示词忠实翻译器，只执行翻译，不扩写、不优化、不评价，也不输出 Markdown、标题、引号、解释、警告或免责声明。
根据本次任务给出的方向转换中文、英文或中英混合输入：中文或混合输入转英文时，保留已经正确的英文标签；纯英文转中文时，逐项准确解释标签，并把完整自然语言忠实译成中文。
严格保留人物数量、成年人身份、角色名、作品名、画师 @ 前缀、标签顺序、括号权重、LoRA 语法、否定关系、左右位置、动作、服装、身体特征、场景和安全等级。不得擅自增加、删除、弱化或改写内容。
对于明确为成年人的合法成人内容，按原文忠实处理相关身体、服装、姿势、关系和成人标签，不回避、不含糊替换，也不主动增加原文没有的成人内容；不得将未成年人或年龄不明确的人物成人化。
标签优先采用准确的 Danbooru/Anima 常用写法；自然语言保持自然、明确。只返回翻译结果。"""

DEFAULT_TRANSLATION_RULE = V17_DEFAULT_TRANSLATION_RULE + """
输入是单个标签时只返回一个对应词；输入是自然语言句子或段落时必须保持自然语言形式，不要改写成逗号分隔的标签列表。自然语言译文可以按语法正常使用逗号，不受原文逗号数量限制。
对于明确成年内容中的身体解剖词汇，应使用准确、直接的医学或通用对应词，不使用含糊代称，也不要额外列出多个同义标签。"""

DEFAULT_TRANSLATE_OPTIMIZE_RULE = """你是 Anima 模型提示词翻译与优化器。理解中文、英文或中英混合输入，将其转换为一份可直接用于 Anima 的英文提示词；只返回最终结果，不输出 Markdown、标题、引号、解释、警告或免责声明。
先忠实翻译，再在不改变原意的前提下消除重复和明显冲突，选用准确的 Danbooru/Anima 标签，并按以下顺序组织：质量/元数据/年份/安全，人数，角色，作品/系列，画师，外观，其他标签（表情、动作、姿势、镜头），环境，末尾自然语言描述。
严格保留人物数量、成年人身份、角色名、作品名、画师 @ 前缀、括号权重、LoRA 语法、否定关系、左右位置、动作、服装、身体特征、互动关系、背景和用户明确限制，不得擅自换人、增加人物或改变主题。
对于明确为成年人的合法成人内容，准确保留并规范相关成人标签，不弱化、不含糊替换，也不主动增加原文没有的成人内容；不得将未成年人或年龄不明确的人物成人化。
标签使用英文逗号分隔；需要自然语言补充时，只在标签之后使用英文句点分隔。仅使用 Anima 支持的英文标点和语法：逗号、句点、圆括号与冒号权重、@ 画师前缀、下划线、连字符、撇号、百分号，以及尖括号 LoRA 语法。"""

LEGACY_DEFAULT_EXPLANATION_RULE = """你是 Anima/Danbooru 英文标签解释器。把用户提供的单个英文标签忠实翻译成简短中文，不得扩写成多个标签，不得增加权重、括号、示例或解释前缀。
角色名、作品名、摄影术语和成人标签应准确直译；无法可靠翻译时保持专有名词并给出最短中文说明。
只返回对应的中文词语。"""

LEGACY_DEFAULT_OPTIMIZATION_RULE = """你是 Anima 模型提示词优化器。理解用户的中文意图，输出可直接用于 Anima 的英文提示词，不得解释或使用 Markdown。
优先使用准确、简洁、无冲突的 Danbooru/Anima 标签；需要补充氛围和细节时，可以在标签末尾增加一段以英文句点开头的自然语言描述。
严格保持用户指定的人物、身份、数量、左右位置、动作、服装、安全等级和否定要求，不得擅自改变主题。
建议按以下顺序组织：质量/元数据/年份/安全，人数，角色，作品/系列，画师，外观，表情/动作/姿势等其他标签，环境，自然语言描述。
只返回最终英文提示词。"""

DEFAULT_OPTIMIZATION_RULE = """你是 Anima 模型英文提示词优化器。输入应当已经是英文；只进行 Anima 格式整理、去重、冲突检查、标签规范化和必要的表达优化，不承担中译英。只返回最终结果，不输出 Markdown、标题、引号、解释、警告或免责声明。
按以下顺序组织：质量/元数据/年份/安全，人数，角色，作品/系列，画师，外观，其他标签（表情、动作、姿势、镜头），环境，末尾自然语言描述。
严格保留人物数量、成年人身份、角色名、作品名、画师 @ 前缀、括号权重、LoRA 语法、否定关系、左右位置、动作、服装、身体特征、互动关系、背景和用户明确限制，不得擅自换人、增加人物或改变主题。
对于明确为成年人的合法成人内容，准确保留并规范相关成人标签，不弱化、不含糊替换，也不主动增加原文没有的成人内容；不得将未成年人或年龄不明确的人物成人化。
标签使用英文逗号分隔；自然语言只放在末尾并使用英文句点分隔。仅使用 Anima 支持的英文标点和语法：逗号、句点、圆括号与冒号权重、@ 画师前缀、下划线、连字符、撇号、百分号，以及尖括号 LoRA 语法。"""

DEFAULT_CONFIG = {
    "schema_version": 2,
    "provider": "dictionary",
    "base_url": "",
    "model": "",
    "api_key": "",
    "temperature": 0.2,
    "timeout_seconds": 90,
    "translation_rule": DEFAULT_TRANSLATION_RULE,
    "translate_optimize_rule": DEFAULT_TRANSLATE_OPTIMIZE_RULE,
    "optimization_rule": DEFAULT_OPTIMIZATION_RULE,
}


def translation_direction(text):
    return "to_english" if re.search(r"[\u3400-\u9fff]", str(text or "")) else "to_chinese"


def openai_chat_endpoint(base_url):
    """Return a chat-completions endpoint for an OpenAI-compatible base URL."""
    base = str(base_url or "").strip().rstrip("/")
    if not base:
        return ""
    if base.endswith("/chat/completions"):
        return base
    parsed = urlparse(base)
    path = parsed.path.rstrip("/")
    if not path and parsed.hostname in {"127.0.0.1", "localhost"} and parsed.port == 1234:
        return f"{base}/v1/chat/completions"
    return f"{base}/chat/completions"


def sanitize_anima_prompt(value):
    text = str(value or "").strip()
    fenced = re.fullmatch(r"```(?:text|plaintext)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    text = fenced.group(1).strip() if fenced else text
    replacements = {
        "，": ",", "、": ",", "；": ",", ";": ",", "。": ".",
        "！": ".", "!": ".", "？": ".", "?": ".", "：": ":",
        "（": "(", "）": ")", "＜": "<", "＞": ">", "—": "-", "–": "-", "…": ".",
        "“": "", "”": "", "‘": "'", "’": "'", '"': "", "`": "",
    }
    for source, target in replacements.items():
        text = text.replace(source, target)
    text = re.sub(r"(?m)^\s*(?:[-*•]+|\d+[.)])\s*", "", text)
    text = re.sub(r"[\r\n]+", ", ", text)
    text = re.sub(r"\s*,\s*", ", ", text)
    text = re.sub(r",(?:\s*,)+", ",", text)
    text = re.sub(r"(?<!\d)\s*\.\s*(?!\d)", ". ", text)
    text = re.sub(r",\s*\.\s*", ". ", text)
    text = re.sub(r"\s+", " ", text).strip(" ,")
    if re.search(r"[\u3400-\u9fff]", text):
        raise ValueError("助手返回的 Anima 提示词仍包含中文，请调整规则后重试")
    allowed_punctuation = set(",.():@_-'<>%+/&")
    invalid = sorted({char for char in text if not (char.isalnum() or char.isspace() or char in allowed_punctuation)})
    if invalid:
        raise ValueError(f"助手返回了不符合 Anima 规则的标点：{' '.join(invalid)}")
    if not text:
        raise ValueError("助手返回的 Anima 提示词为空")
    return text


def _default_config_dir():
    try:
        import folder_paths
        return Path(folder_paths.get_user_directory()) / "bilingual-prompt-inspector"
    except (ImportError, AttributeError, TypeError):
        return Path(__file__).resolve().parent / "data" / "user_config"


class AssistantStore:
    def __init__(self, config_dir=None, install_id_path=None):
        custom_config_dir = config_dir is not None
        self.config_dir = Path(config_dir or _default_config_dir())
        self.config_path = self.config_dir / "assistant_settings.json"
        default_install_id_path = (
            self.config_dir / ".installation_id"
            if custom_config_dir
            else Path(__file__).resolve().parent / "data" / "runtime" / "installation_id"
        )
        self.install_id_path = Path(install_id_path or default_install_id_path)
        self.installation_id = self._load_or_create_installation_id()

    @staticmethod
    def _write_json_atomic(path, payload):
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(prefix="assistant_settings_", suffix=".json", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            os.replace(temp_name, path)
            try:
                os.chmod(path, 0o600)
            except OSError:
                pass
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)

    def _load_or_create_installation_id(self):
        try:
            if self.install_id_path.exists():
                value = self.install_id_path.read_text(encoding="utf-8").strip()
                if re.fullmatch(r"[A-Za-z0-9_-]{32,128}", value):
                    return value
        except OSError:
            pass
        value = secrets.token_urlsafe(32)
        self.install_id_path.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(prefix="installation_", suffix=".tmp", dir=self.install_id_path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(value)
            os.replace(temp_name, self.install_id_path)
            try:
                os.chmod(self.install_id_path, 0o600)
            except OSError:
                pass
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)
        return value

    @staticmethod
    def _normalize_base_url(value):
        return str(value or "").strip().rstrip("/")

    @staticmethod
    def _is_local_hostname(hostname):
        host = str(hostname or "").strip().lower().rstrip(".")
        if host in {"localhost", "host.docker.internal"} or host.endswith(".local") or "." not in host:
            return True
        try:
            address = ip_address(host)
            return address.is_private or address.is_loopback or address.is_link_local
        except ValueError:
            return False

    @classmethod
    def _credential_binding(cls, provider, base_url):
        identity = f"{str(provider or '').strip().lower()}\0{cls._normalize_base_url(base_url)}"
        return hashlib.sha256(identity.encode("utf-8")).hexdigest()

    def _default_persisted_config(self):
        return {
            **DEFAULT_CONFIG,
            "installation_id": self.installation_id,
            "credential_binding": "",
        }

    def config(self):
        value = {}
        should_rewrite = False
        if self.config_path.exists():
            try:
                loaded = json.loads(self.config_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    value = loaded
            except (OSError, ValueError):
                value = {}
        if value and value.get("installation_id") != self.installation_id:
            value = self._default_persisted_config()
            should_rewrite = True
        if value.get("translation_rule") in {LEGACY_DEFAULT_TRANSLATION_RULE, V17_DEFAULT_TRANSLATION_RULE}:
            value["translation_rule"] = DEFAULT_TRANSLATION_RULE
            should_rewrite = True
        if value.get("optimization_rule") == LEGACY_DEFAULT_OPTIMIZATION_RULE:
            value["optimization_rule"] = DEFAULT_OPTIMIZATION_RULE
            should_rewrite = True
        if "translate_optimize_rule" not in value:
            value["translate_optimize_rule"] = DEFAULT_TRANSLATE_OPTIMIZE_RULE
            should_rewrite = True
        result = {**self._default_persisted_config(), **value, "installation_id": self.installation_id}
        expected_binding = self._credential_binding(result["provider"], result["base_url"])
        if result.get("api_key") and result.get("credential_binding") != expected_binding:
            result["api_key"] = ""
            result["credential_binding"] = ""
            should_rewrite = True
        if should_rewrite:
            self._write_json_atomic(self.config_path, result)
        return result

    def public_config(self):
        config = self.config()
        return {
            key: config[key] for key in DEFAULT_CONFIG if key != "api_key"
        } | {
            "api_key_configured": bool(config.get("api_key")),
            "default_translation_rule": DEFAULT_TRANSLATION_RULE,
            "default_translate_optimize_rule": DEFAULT_TRANSLATE_OPTIMIZE_RULE,
            "default_optimization_rule": DEFAULT_OPTIMIZATION_RULE,
        }

    @staticmethod
    def _clean_rule(value, fallback):
        text = str(value if value is not None else fallback).strip()
        if not text:
            return fallback
        if len(text) > 20000:
            raise ValueError("自定义规则不能超过 20000 个字符")
        return text

    def update(self, payload):
        if not isinstance(payload, dict):
            raise ValueError("设置必须是对象")
        current = self.config()
        provider = str(payload.get("provider", current["provider"])).strip().lower()
        if provider not in {"dictionary", "openai_compatible", "ollama"}:
            raise ValueError("服务类型仅支持词库、OpenAI兼容接口或 Ollama")
        base_url = self._normalize_base_url(payload.get("base_url", current["base_url"]))
        if base_url:
            parsed = urlparse(base_url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError("API 地址必须是完整的 http:// 或 https:// 地址")
            if parsed.username or parsed.password:
                raise ValueError("API 地址中不能包含用户名或密码")
            if parsed.query or parsed.fragment:
                raise ValueError("API 地址中不能包含查询参数或片段")
            if parsed.scheme == "http" and not self._is_local_hostname(parsed.hostname):
                raise ValueError("非本机 API 地址必须使用 HTTPS，避免 API Key 明文传输")
        model = str(payload.get("model", current["model"])).strip()
        if len(model) > 300:
            raise ValueError("模型名称过长")
        try:
            temperature = float(payload.get("temperature", current["temperature"]))
            timeout_seconds = int(payload.get("timeout_seconds", current["timeout_seconds"]))
        except (TypeError, ValueError) as error:
            raise ValueError("温度和超时时间必须是数字") from error
        if not 0 <= temperature <= 2:
            raise ValueError("温度必须在 0 到 2 之间")
        if not 5 <= timeout_seconds <= 600:
            raise ValueError("超时时间必须在 5 到 600 秒之间")
        endpoint_changed = provider != current["provider"] or base_url != self._normalize_base_url(current["base_url"])
        api_key = "" if endpoint_changed else current.get("api_key", "")
        if "api_key" in payload:
            incoming_key = str(payload.get("api_key") or "").strip()
            if incoming_key and incoming_key != "••••••••":
                if len(incoming_key) > 4096:
                    raise ValueError("API Key 过长")
                api_key = incoming_key
            elif payload.get("clear_api_key"):
                api_key = ""
        if provider == "dictionary":
            api_key = ""
        credential_binding = self._credential_binding(provider, base_url) if api_key else ""
        result = {
            "schema_version": 2,
            "provider": provider,
            "base_url": base_url,
            "model": model,
            "api_key": api_key,
            "credential_binding": credential_binding,
            "installation_id": self.installation_id,
            "temperature": temperature,
            "timeout_seconds": timeout_seconds,
            "translation_rule": self._clean_rule(payload.get("translation_rule"), current["translation_rule"]),
            "translate_optimize_rule": self._clean_rule(payload.get("translate_optimize_rule"), current["translate_optimize_rule"]),
            "optimization_rule": self._clean_rule(payload.get("optimization_rule"), current["optimization_rule"]),
        }
        self._write_json_atomic(self.config_path, result)
        return self.public_config()

    def reset_rules(self):
        config = self.config()
        config["translation_rule"] = DEFAULT_TRANSLATION_RULE
        config["translate_optimize_rule"] = DEFAULT_TRANSLATE_OPTIMIZE_RULE
        config["optimization_rule"] = DEFAULT_OPTIMIZATION_RULE
        self._write_json_atomic(self.config_path, config)
        return self.public_config()


def dictionary_translate(text, dictionary_store):
    parts = [part.strip() for part in re.split(r"[,，、\r\n]+", str(text or "")) if part.strip()]
    if not parts:
        raise ValueError("待翻译文本为空")
    snapshot = dictionary_store.snapshot()
    local = snapshot["tags"]
    output = []
    missing = []
    for part in parts:
        weighted = re.fullmatch(r"\((.+):\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\)", part)
        lookup_part = weighted.group(1).strip() if weighted else part
        if not re.search(r"[\u3400-\u9fff]", lookup_part):
            output.append(part)
            continue
        exact = [tag for tag in local if lookup_part == tag.get("chinese") or lookup_part in (tag.get("aliases") or [])]
        if not exact:
            large = dictionary_store.search_large_tags(lookup_part, limit=30)
            exact = [tag for tag in large if lookup_part == tag.get("chinese")]
        if exact:
            exact.sort(key=lambda tag: (tag.get("pack_id") == "personal", int(tag.get("post_count", 0))), reverse=True)
            english = exact[0]["english"]
            output.append(f"({english}:{weighted.group(2)})" if weighted else english)
        else:
            missing.append(lookup_part)
    if missing:
        preview = "、".join(missing[:8])
        raise ValueError(
            f"纯词库模式暂未收录：{preview}。可在“词库搜索”查找候选、手动加入个人词库，"
            "或按需配置免费的本地 Ollama / LM Studio；外部 API 不是必需项。"
        )
    return ", ".join(output)
