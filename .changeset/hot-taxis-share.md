---
"@zakstam/codex-local-component": patch
---

Improve external consumer onboarding docs in the published package:
- Keep `packages/codex-local-component/README.md` as the human entrypoint.
- Keep `packages/codex-local-component/LLMS.md` as the LLM-only routing manifest.
- Add a copy-paste one-shot prompt for external users to give an LLM and get setup flowing end-to-end.
- Add onboarding metadata (`description` and `codex.onboarding.prompt`) in package manifest so npm discoverability includes the same external onboarding flow.
- Add the same LLM handoff prompt to monorepo `README.md` for external consumers.
