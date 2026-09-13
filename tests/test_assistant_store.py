import json
import tempfile
import unittest
from pathlib import Path

from assistant_store import (
    AssistantStore,
    DEFAULT_OPTIMIZATION_RULE,
    DEFAULT_TRANSLATE_OPTIMIZE_RULE,
    DEFAULT_TRANSLATION_RULE,
    LEGACY_DEFAULT_OPTIMIZATION_RULE,
    LEGACY_DEFAULT_TRANSLATION_RULE,
    V17_DEFAULT_TRANSLATION_RULE,
    dictionary_translate,
    sanitize_anima_prompt,
    translation_direction,
)
from dictionary_store import DictionaryStore


class AssistantStoreTests(unittest.TestCase):
    def make_dictionary(self, root):
        data = Path(root) / "dictionary"
        data.mkdir()
        (data / "base_tags.json").write_text(json.dumps({"tags": [
            {"english": "long hair", "chinese": "长发", "category": "发型"},
            {"english": "smile", "chinese": "微笑", "category": "表情"},
        ]}), encoding="utf-8")
        (data / "user_tags.json").write_text('{"tags": []}', encoding="utf-8")
        return DictionaryStore(data)

    def test_config_masks_api_key_and_preserves_custom_rules(self):
        with tempfile.TemporaryDirectory() as root:
            store = AssistantStore(Path(root) / "config")
            public = store.update({
                "provider": "openai_compatible",
                "base_url": "https://example.test/v1",
                "model": "example-model",
                "api_key": "secret-value",
                "translation_rule": "自定义仅翻译",
                "translate_optimize_rule": "自定义翻译并优化",
                "optimization_rule": "自定义优化",
            })
            self.assertTrue(public["api_key_configured"])
            self.assertNotIn("api_key", public)
            self.assertEqual(store.config()["api_key"], "secret-value")
            self.assertEqual(store.config()["translation_rule"], "自定义仅翻译")
            self.assertEqual(store.config()["translate_optimize_rule"], "自定义翻译并优化")
            self.assertNotIn("explanation_rule", public)

    def test_dictionary_translation_preserves_weight(self):
        with tempfile.TemporaryDirectory() as root:
            dictionary = self.make_dictionary(root)
            self.assertEqual(dictionary_translate("长发，(微笑:1.2)", dictionary), "long hair, (smile:1.2)")

    def test_api_key_is_bound_to_provider_and_base_url(self):
        with tempfile.TemporaryDirectory() as root:
            store = AssistantStore(Path(root) / "config")
            store.update({
                "provider": "openai_compatible",
                "base_url": "https://first.example/v1",
                "model": "example-model",
                "api_key": "secret-value",
            })
            self.assertEqual(store.config()["api_key"], "secret-value")
            public = store.update({"base_url": "https://second.example/v1"})
            self.assertFalse(public["api_key_configured"])
            self.assertEqual(store.config()["api_key"], "")

    def test_new_installation_id_invalidates_saved_configuration(self):
        with tempfile.TemporaryDirectory() as root:
            config_dir = Path(root) / "config"
            first_marker = Path(root) / "first-installation-id"
            first = AssistantStore(config_dir, install_id_path=first_marker)
            first.update({
                "provider": "openai_compatible",
                "base_url": "https://example.test/v1",
                "model": "example-model",
                "api_key": "secret-value",
            })
            second = AssistantStore(config_dir, install_id_path=Path(root) / "second-installation-id")
            config = second.config()
            self.assertEqual(config["provider"], "dictionary")
            self.assertEqual(config["base_url"], "")
            self.assertEqual(config["api_key"], "")

    def test_remote_http_endpoint_is_rejected_but_local_http_is_allowed(self):
        with tempfile.TemporaryDirectory() as root:
            store = AssistantStore(Path(root) / "config")
            with self.assertRaisesRegex(ValueError, "HTTPS"):
                store.update({"provider": "openai_compatible", "base_url": "http://public.example/v1"})
            result = store.update({"provider": "ollama", "base_url": "http://127.0.0.1:11434"})
            self.assertEqual(result["base_url"], "http://127.0.0.1:11434")

    def test_dictionary_translation_reports_unknown(self):
        with tempfile.TemporaryDirectory() as root:
            dictionary = self.make_dictionary(root)
            with self.assertRaisesRegex(ValueError, "纯词库模式无法翻译"):
                dictionary_translate("不存在的中文标签", dictionary)

    def test_language_direction_and_anima_punctuation(self):
        self.assertEqual(translation_direction("masterpiece, best quality"), "to_chinese")
        self.assertEqual(translation_direction("杰作, best quality"), "to_english")
        self.assertEqual(
            sanitize_anima_prompt("```text\nmasterpiece，(smile：1.2)；@artist！\n```"),
            "masterpiece, (smile:1.2), @artist.",
        )
        with self.assertRaisesRegex(ValueError, "不符合 Anima"):
            sanitize_anima_prompt("masterpiece [smile]")
        with self.assertRaisesRegex(ValueError, "仍包含中文"):
            sanitize_anima_prompt("masterpiece, 杰作")

    def test_legacy_default_rules_are_upgraded(self):
        with tempfile.TemporaryDirectory() as root:
            store = AssistantStore(Path(root) / "config")
            store.config_dir.mkdir(parents=True, exist_ok=True)
            store.config_path.write_text(json.dumps({
                "provider": "openai_compatible",
                "translation_rule": LEGACY_DEFAULT_TRANSLATION_RULE,
                "optimization_rule": LEGACY_DEFAULT_OPTIMIZATION_RULE,
            }, ensure_ascii=False), encoding="utf-8")
            config = store.config()
            self.assertEqual(config["translation_rule"], DEFAULT_TRANSLATION_RULE)
            self.assertEqual(config["translate_optimize_rule"], DEFAULT_TRANSLATE_OPTIMIZE_RULE)
            self.assertEqual(config["optimization_rule"], DEFAULT_OPTIMIZATION_RULE)

    def test_v17_default_translation_rule_is_upgraded_without_overwriting_custom_rules(self):
        with tempfile.TemporaryDirectory() as root:
            store = AssistantStore(Path(root) / "config")
            store.config_dir.mkdir(parents=True, exist_ok=True)
            store.config_path.write_text(json.dumps({
                "installation_id": store.installation_id,
                "provider": "dictionary",
                "translation_rule": V17_DEFAULT_TRANSLATION_RULE,
            }, ensure_ascii=False), encoding="utf-8")
            self.assertEqual(store.config()["translation_rule"], DEFAULT_TRANSLATION_RULE)

            store.update({"translation_rule": "我的自定义翻译规则"})
            self.assertEqual(store.config()["translation_rule"], "我的自定义翻译规则")


if __name__ == "__main__":
    unittest.main()
