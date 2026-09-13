class BilingualPromptInspector:
    """A lossless STRING pass-through with a bilingual browser-side inspector."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": (
                    "STRING",
                    {
                        "multiline": True,
                        "dynamicPrompts": True,
                        "default": "",
                    },
                )
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("英文提示词",)
    FUNCTION = "pass_through"
    CATEGORY = "文本/提示词工具"
    DESCRIPTION = "逐标签显示中英解释；输出始终与输入英文完全一致。"

    def pass_through(self, text):
        return (text,)
