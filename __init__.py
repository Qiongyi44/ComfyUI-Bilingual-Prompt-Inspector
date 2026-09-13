from .nodes import BilingualPromptInspector
from . import server  # noqa: F401 - importing registers local API routes


NODE_CLASS_MAPPINGS = {
    "BilingualPromptInspector": BilingualPromptInspector,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "BilingualPromptInspector": "双语提示词检查器（英文输出）",
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
