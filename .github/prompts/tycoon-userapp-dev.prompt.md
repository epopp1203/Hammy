---
description: "Use when building or modifying Tycoon UserApps in this repo, with correct command/data hooks and in-game integration behavior."
name: "Tycoon UserApp Dev"
argument-hint: "Describe the feature, fix, or app change"
agent: "agent"
---
Implement the requested Tycoon UserApps change in this workspace using existing app patterns and the in-game webapp API.

Request:
${input}

Project context:
- Workspace contains multiple standalone user apps (for example blessings, bxp-tracker, exp-boost, fishing, pizza-job, xp-tracker-v1, xp-tracker-v2).
- API and data contract reference is documented in [Example2](../../Example2).
- Basic command and event usage reference is demonstrated in [Example1](../../Example1).

Requirements:
1. Scope the change to only the relevant app folder and preserve existing style in that folder.
2. Use the Tycoon webapp bridge correctly via window.parent.postMessage with valid command payloads.
3. Use incoming cache/data updates through window message handlers and only depend on documented keys.
4. For interactions, prefer documented commands and triggers from the API reference (sendCommand, getData/getNamedData, pin/close, notification/info/popup, blip APIs, trigger keys).
5. Keep UI resilient when game data is absent, delayed, or partial.
6. Do not break keyboard/focus behavior; preserve or implement escape-to-pin behavior when appropriate.
7. If behavior depends on menu or prompt automation, align with forceMenuChoice/forceMenuBack/forceSubmitValue/forceRequestResult semantics from the docs.
8. Keep changes minimal and explain assumptions when the request requires undocumented data keys.

Execution checklist:
1. Find the target app files and read nearby code before editing.
2. Implement the requested feature/fix directly in code.
3. Validate for obvious runtime issues (missing selectors, null data guards, malformed payloads).
4. Summarize what changed, where, and why.

Output format:
1. What changed (short summary)
2. Files touched
3. Key behavior details (commands, data keys, triggers used)
4. Assumptions or follow-up options
