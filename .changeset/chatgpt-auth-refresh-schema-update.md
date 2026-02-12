---
"@zakstam/codex-local-component": patch
---

Align ChatGPT auth-token response/request handling with the latest Codex app-server schema by replacing `idToken` payload usage with `chatgptAccountId` and optional `chatgptPlanType`, while keeping `accessToken` as required.
