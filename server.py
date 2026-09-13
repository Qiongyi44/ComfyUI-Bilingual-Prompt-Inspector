import asyncio
import json
import sqlite3
import re
import secrets
import time
from collections import deque
from functools import wraps
from urllib.parse import urlparse

from aiohttp import ClientSession, ClientTimeout, web
from server import PromptServer

from .assistant_store import AssistantStore, dictionary_translate, sanitize_anima_prompt, translation_direction
from .dictionary_store import DictionaryStore, normalize_key


store = DictionaryStore()
assistant_store = AssistantStore()
assistant_store.config()  # 进程启动时立即清除与当前安装身份不匹配的旧配置和凭据

_SESSION_TOKEN = secrets.token_urlsafe(32)
_MAX_JSON_BYTES = 8 * 1024 * 1024
_MAX_ASSISTANT_JSON_BYTES = 256 * 1024
_ASSISTANT_RATE_WINDOW = 60.0
_ASSISTANT_RATE_LIMIT = 30
_assistant_requests = deque()
_assistant_slots = asyncio.Semaphore(2)


class AssistantLimitError(ValueError):
    pass


def error_response(error, status=400):
    return web.json_response({"success": False, "error": str(error)}, status=status)


def _same_origin(request):
    if request.headers.get("Sec-Fetch-Site", "").lower() == "cross-site":
        return False
    origin = request.headers.get("Origin", "").strip()
    if not origin:
        return True
    parsed = urlparse(origin)
    return parsed.scheme in {"http", "https"} and parsed.netloc.lower() == request.host.lower()


def _request_allowed(request):
    supplied = request.headers.get("X-BPI-Token", "")
    return _same_origin(request) and secrets.compare_digest(supplied, _SESSION_TOKEN)


def protected_route(method, path):
    def decorator(handler):
        @wraps(handler)
        async def guarded(request):
            if not _request_allowed(request):
                return error_response("请求未通过双语检查器的本机会话验证", 403)
            try:
                return await handler(request)
            except web.HTTPRequestEntityTooLarge as error:
                return error_response(error.reason or "请求内容过大", 413)

        getattr(PromptServer.instance.routes, method.lower())(path)(guarded)
        return guarded
    return decorator


async def _read_json(request, max_bytes=_MAX_JSON_BYTES):
    length = request.content_length
    if length is not None and length > max_bytes:
        raise ValueError(f"请求内容过大，最大允许 {max_bytes // 1024} KB")
    raw = await request.read()
    if len(raw) > max_bytes:
        raise ValueError(f"请求内容过大，最大允许 {max_bytes // 1024} KB")
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise web.HTTPBadRequest(reason="请求不是有效的 UTF-8 JSON") from error


def _consume_assistant_rate_limit():
    now = time.monotonic()
    while _assistant_requests and now - _assistant_requests[0] >= _ASSISTANT_RATE_WINDOW:
        _assistant_requests.popleft()
    if len(_assistant_requests) >= _ASSISTANT_RATE_LIMIT:
        raise AssistantLimitError("助手请求过于频繁，请稍后再试")
    _assistant_requests.append(now)


def _clean_assistant_result(value):
    text = str(value or "").strip()
    fenced = re.fullmatch(r"```(?:text|plaintext)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    return fenced.group(1).strip() if fenced else text


def _dictionary_explain(text):
    parts = [part.strip() for part in re.split(r"[,，、\r\n]+", str(text or "")) if part.strip()]
    if not parts:
        raise ValueError("待翻译文本为空")
    snapshot = store.snapshot()
    local = {normalize_key(tag["english"]): tag for tag in snapshot["tags"]}
    output = []
    missing = []
    for part in parts:
        weighted = re.fullmatch(r"\((.+):\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\)", part)
        lookup_part = weighted.group(1).strip() if weighted else part
        entry = local.get(normalize_key(lookup_part))
        if not entry:
            matches = store.lookup_large_tags([lookup_part])
            entry = matches[0] if matches else None
        if not entry:
            missing.append(lookup_part)
            continue
        chinese = entry["chinese"]
        output.append(f"({chinese}:{weighted.group(2)})" if weighted else chinese)
    if missing:
        raise ValueError(f"纯词库模式无法翻译：{'、'.join(missing[:8])}。请配置 Ollama 或 OpenAI 兼容接口。")
    return "，".join(output)


def _openai_endpoint(base_url):
    base = str(base_url or "").rstrip("/")
    return base if base.endswith("/chat/completions") else f"{base}/chat/completions"


async def _call_configured_assistant(action, text, instruction="", connection_test=False):
    config = assistant_store.config()
    provider = config["provider"]
    if provider == "dictionary":
        if connection_test:
            return "纯词库模式可用"
        if action in {"translate_optimize", "optimize"}:
            raise ValueError("翻译优化和提示词优化需要配置 Ollama 或 OpenAI 兼容接口")
        return dictionary_translate(text, store) if translation_direction(text) == "to_english" else _dictionary_explain(text)
    if not config.get("model"):
        raise ValueError("尚未填写模型名称")
    rule = {
        "translate": config["translation_rule"],
        "explain": config["translation_rule"],
        "translate_optimize": config["translate_optimize_rule"],
        "optimize": config["optimization_rule"],
    }[action]
    if connection_test:
        rule = "你是连接测试助手。"
        text = "只回复 OK"
    if not connection_test and action in {"translate", "explain"}:
        direction = "中文或中英混合内容翻译为英文；保留原本正确的英文标签" if translation_direction(text) == "to_english" else "英文翻译为中文"
        if action == "explain":
            direction = "将单个英文标签或英文自然语言片段翻译为简洁、忠实的中文"
        rule = f"{rule}\n\n本次任务方向：{direction}。"
    elif not connection_test and action == "translate_optimize":
        rule = f"{rule}\n\n本次任务：无论输入语言为何，最终必须输出经过优化的英文 Anima 提示词。"
    elif not connection_test and action == "optimize":
        if re.search(r"[\u3400-\u9fff]", text):
            raise ValueError("“优化为 Anima”只接受英文；中文或混合文本请使用“翻译并优化”")
        rule = f"{rule}\n\n本次任务：整理现有英文内容，不承担翻译。"
    if instruction:
        rule = f"{rule}\n\n用户本次附加要求优先遵循：{instruction.strip()}"
    timeout = ClientTimeout(total=config["timeout_seconds"])
    if provider == "ollama":
        base = (config.get("base_url") or "http://127.0.0.1:11434").rstrip("/")
        if base.endswith("/v1"):
            base = base[:-3].rstrip("/")
        endpoint = base if base.endswith("/api/chat") else f"{base}/api/chat"
        payload = {
            "model": config["model"],
            "stream": False,
            "messages": [{"role": "system", "content": rule}, {"role": "user", "content": text}],
            "options": {"temperature": config["temperature"]},
        }
        async with ClientSession(timeout=timeout) as session:
            async with session.post(endpoint, json=payload) as response:
                data = await response.json(content_type=None)
                if response.status >= 400:
                    raise ValueError(data.get("error") or f"Ollama 请求失败：HTTP {response.status}")
        result = data.get("message", {}).get("content")
    else:
        if not config.get("base_url"):
            raise ValueError("尚未填写 OpenAI 兼容 API 地址")
        headers = {"Content-Type": "application/json"}
        if config.get("api_key"):
            headers["Authorization"] = f"Bearer {config['api_key']}"
        payload = {
            "model": config["model"],
            "temperature": config["temperature"],
            "messages": [{"role": "system", "content": rule}, {"role": "user", "content": text}],
        }
        async with ClientSession(timeout=timeout) as session:
            async with session.post(_openai_endpoint(config["base_url"]), headers=headers, json=payload) as response:
                data = await response.json(content_type=None)
                if response.status >= 400:
                    detail = data.get("error") if isinstance(data, dict) else None
                    if isinstance(detail, dict):
                        detail = detail.get("message")
                    raise ValueError(detail or f"API 请求失败：HTTP {response.status}")
        choices = data.get("choices") if isinstance(data, dict) else None
        result = choices[0].get("message", {}).get("content") if choices else None
    result = _clean_assistant_result(result)
    if not result:
        raise ValueError("模型没有返回文本结果")
    if len(result) > 50000:
        raise ValueError("模型返回内容异常过长")
    if action in {"translate_optimize", "optimize"}:
        result = sanitize_anima_prompt(result)
    return result


@PromptServer.instance.routes.get("/bpi/session")
async def get_bpi_session(request):
    if not _same_origin(request):
        return error_response("跨站请求不能创建双语检查器会话", 403)
    return web.json_response(
        {"success": True, "data": {"token": _SESSION_TOKEN}},
        headers={"Cache-Control": "no-store"},
    )


@protected_route("get", "/bpi/assistant/config")
async def get_assistant_config(_request):
    return web.json_response({"success": True, "data": assistant_store.public_config()})


@protected_route("post", "/bpi/assistant/config")
async def save_assistant_config(request):
    try:
        result = assistant_store.update(await _read_json(request, _MAX_ASSISTANT_JSON_BYTES))
        return web.json_response({"success": True, "data": result})
    except (OSError, ValueError, web.HTTPBadRequest) as error:
        return error_response(error)


@protected_route("post", "/bpi/assistant/reset-rules")
async def reset_assistant_rules(_request):
    try:
        return web.json_response({"success": True, "data": assistant_store.reset_rules()})
    except OSError as error:
        return error_response(error, 500)


@protected_route("post", "/bpi/assistant/test")
async def test_assistant_connection(_request):
    try:
        _consume_assistant_rate_limit()
        try:
            await asyncio.wait_for(_assistant_slots.acquire(), timeout=0.25)
        except asyncio.TimeoutError as error:
            raise AssistantLimitError("已有多个助手任务正在运行，请稍后再试") from error
        try:
            result = await _call_configured_assistant("translate", "测试", connection_test=True)
        finally:
            _assistant_slots.release()
        return web.json_response({"success": True, "data": {"message": result}})
    except AssistantLimitError as error:
        return error_response(error, 429)
    except Exception as error:
        return error_response(error)


@protected_route("post", "/bpi/assistant/run")
async def run_assistant(request):
    try:
        payload = await _read_json(request, _MAX_ASSISTANT_JSON_BYTES)
        action = str(payload.get("action", "translate")) if isinstance(payload, dict) else "translate"
        text = str(payload.get("text", "")) if isinstance(payload, dict) else ""
        instruction = str(payload.get("instruction", "")) if isinstance(payload, dict) else ""
        if action not in {"translate", "explain", "translate_optimize", "optimize"}:
            raise ValueError("未知的助手操作")
        if not text.strip():
            raise ValueError("输入内容为空")
        if len(text) > 50000:
            raise ValueError("输入内容过长")
        if len(instruction) > 20000:
            raise ValueError("附加要求过长")
        _consume_assistant_rate_limit()
        try:
            await asyncio.wait_for(_assistant_slots.acquire(), timeout=0.25)
        except asyncio.TimeoutError as error:
            raise AssistantLimitError("已有多个助手任务正在运行，请稍后再试") from error
        try:
            result = await _call_configured_assistant(action, text, instruction)
        finally:
            _assistant_slots.release()
        return web.json_response({"success": True, "data": {"text": result, "provider": assistant_store.config()["provider"]}})
    except AssistantLimitError as error:
        return error_response(error, 429)
    except (ValueError, web.HTTPBadRequest) as error:
        return error_response(error)
    except Exception as error:
        return error_response(error, 502)


@protected_route("get", "/bpi/dictionary")
async def get_dictionary(_request):
    try:
        return web.json_response({"success": True, "data": store.snapshot()})
    except (OSError, ValueError) as error:
        return error_response(error, 500)


@protected_route("post", "/bpi/large/lookup")
async def lookup_large_dictionary(request):
    try:
        payload = await _read_json(request)
        terms = payload.get("terms", []) if isinstance(payload, dict) else []
        return web.json_response({"success": True, "data": store.lookup_large_tags(terms)})
    except (ValueError, web.HTTPBadRequest) as error:
        return error_response(error)
    except (OSError, sqlite3.Error) as error:
        return error_response(error, 500)


@protected_route("get", "/bpi/large/search")
async def search_large_dictionary(request):
    try:
        query = request.query.get("q", "")
        limit = request.query.get("limit", "40")
        return web.json_response({"success": True, "data": store.search_large_tags(query, limit=limit)})
    except ValueError as error:
        return error_response(error)
    except (OSError, sqlite3.Error) as error:
        return error_response(error, 500)


@protected_route("post", "/bpi/large/enabled")
async def set_large_dictionary_enabled(request):
    try:
        payload = await _read_json(request)
        if not isinstance(payload, dict) or "enabled" not in payload:
            raise ValueError("缺少 enabled 字段")
        result = store.set_large_dictionary_enabled(payload["enabled"])
        return web.json_response({"success": True, "data": result})
    except (ValueError, web.HTTPBadRequest) as error:
        return error_response(error)
    except OSError as error:
        return error_response(error, 500)


@protected_route("post", "/bpi/tags")
async def save_tag(request):
    try:
        value = await _read_json(request)
        tag, replaced = store.upsert(value)
        return web.json_response({"success": True, "data": tag, "replaced": replaced})
    except (ValueError, web.HTTPBadRequest) as error:
        return error_response(error)
    except OSError as error:
        return error_response(error, 500)


@protected_route("delete", "/bpi/tags/{english}")
async def delete_tag(request):
    try:
        deleted = store.delete(request.match_info["english"])
        return web.json_response({"success": True, "deleted": deleted})
    except (OSError, ValueError) as error:
        return error_response(error, 500)


@protected_route("get", "/bpi/export")
async def export_dictionary(_request):
    try:
        snapshot = store.snapshot()
        return web.json_response({"schema_version": snapshot["schema_version"], "tags": snapshot["user"]})
    except (OSError, ValueError) as error:
        return error_response(error, 500)


@protected_route("post", "/bpi/import")
async def import_dictionary(request):
    try:
        payload = await _read_json(request)
        values = payload.get("tags", []) if isinstance(payload, dict) else []
        mode = payload.get("mode", "overwrite") if isinstance(payload, dict) else "overwrite"
        result = store.import_tags(values, mode=mode)
        return web.json_response({"success": True, "data": result})
    except (ValueError, web.HTTPBadRequest) as error:
        return error_response(error)
    except OSError as error:
        return error_response(error, 500)


@protected_route("post", "/bpi/tags/bulk-update")
async def bulk_update_tags(request):
    try:
        payload = await _read_json(request)
        english_values = payload.get("english", []) if isinstance(payload, dict) else []
        updates = payload.get("updates", {}) if isinstance(payload, dict) else {}
        result = store.update_many(english_values, updates)
        return web.json_response({"success": True, "data": result})
    except (ValueError, web.HTTPBadRequest) as error:
        return error_response(error)
    except OSError as error:
        return error_response(error, 500)


@protected_route("post", "/bpi/packs/import")
async def import_dictionary_pack(request):
    try:
        payload = await _read_json(request)
        overwrite = bool(payload.get("overwrite", False)) if isinstance(payload, dict) else False
        pack_payload = payload.get("payload", payload) if isinstance(payload, dict) else payload
        result = store.import_pack(pack_payload, overwrite=overwrite)
        return web.json_response({"success": True, "data": result})
    except (ValueError, web.HTTPBadRequest) as error:
        return error_response(error)
    except OSError as error:
        return error_response(error, 500)


@protected_route("post", "/bpi/packs/{pack_id}/enabled")
async def set_dictionary_pack_enabled(request):
    try:
        payload = await _read_json(request)
        if not isinstance(payload, dict) or "enabled" not in payload:
            raise ValueError("缺少 enabled 字段")
        result = store.set_pack_enabled(request.match_info["pack_id"], payload["enabled"])
        return web.json_response({"success": True, "data": result})
    except (ValueError, web.HTTPBadRequest) as error:
        return error_response(error)
    except OSError as error:
        return error_response(error, 500)


@protected_route("get", "/bpi/packs/{pack_id}/export")
async def export_dictionary_pack(request):
    try:
        return web.json_response(store.export_pack(request.match_info["pack_id"]))
    except ValueError as error:
        return error_response(error, 404)
    except OSError as error:
        return error_response(error, 500)


@protected_route("delete", "/bpi/packs/{pack_id}")
async def delete_dictionary_pack(request):
    try:
        result = store.delete_pack(request.match_info["pack_id"])
        return web.json_response({"success": True, "data": result})
    except ValueError as error:
        return error_response(error)
    except OSError as error:
        return error_response(error, 500)
