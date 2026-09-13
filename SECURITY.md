# Security policy

## Supported version

Security fixes are applied to the latest public release. Older development snapshots
are not maintained separately.

## Reporting a vulnerability

Do not post API keys, access tokens, private prompts, personal dictionaries, or full
configuration files in a public issue.

Use GitHub private vulnerability reporting when it is enabled for the repository. If
that channel is unavailable, contact the author through the community homepage shown
in the extension and provide only a minimal reproduction with secrets removed:

https://space.bilibili.com/697555747

## Deployment boundary

This extension adds local `/bpi/*` routes to the existing ComfyUI server. Its same-origin
checks, session token, request limits, and API-key isolation reduce accidental access,
but they are not a user-login system or a network firewall. Do not expose an
unauthenticated ComfyUI instance directly to the public internet.

External translation and optimization requests are sent only to the provider configured
by the user. Review that provider's privacy policy, logging behavior, content policy,
and cost before use.
