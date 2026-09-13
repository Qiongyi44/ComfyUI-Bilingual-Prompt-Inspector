# Contributing

Issues and focused pull requests are welcome.

Before submitting a change:

1. Do not commit API keys, assistant settings, personal dictionaries, converted
   databases, generated archives, logs, or model files.
2. Keep optional third-party datasets outside the repository.
3. Preserve the rule that only the English prompt output is sent to downstream nodes.
4. Add or update tests for parsing, synchronization, dictionary, or server behavior.
5. Run both test suites from the repository root:

   ```powershell
   npm test
   python -m unittest discover -s tests -p "test_*.py"
   ```

6. Review staged files with `git diff --cached` before committing.

Bug reports should include the ComfyUI version, frontend version, installation type,
browser or Desktop environment, reproduction steps, and a sanitized error log. Never
include credentials or private prompt content.
