---
description: "Use when polishing the visual UI of an existing Tycoon app without changing game behavior or command logic."
name: "Tycoon UI Polish"
argument-hint: "Describe the app and visual polish goals"
agent: "agent"
---
Apply a UI polish pass to an existing Tycoon UserApp in this workspace without changing gameplay behavior, command semantics, or data contracts.

Request:
${input}

Project context:
- API/data behavior reference: [Example2](../../Example2)
- Basic bridge/events pattern reference: [Example1](../../Example1)
- Workspace contains separate app folders; keep edits scoped to the requested app.

Hard constraints:
1. Do not alter app logic, command payload structure, data key usage, trigger wiring, or automation semantics.
2. Preserve keyboard and focus behavior (including escape-to-pin behavior where present).
3. Keep all existing selectors/IDs that scripts rely on unless there is a safe alias or backward-compatible fallback.
4. Avoid introducing framework dependencies unless explicitly requested.

Polish goals:
1. Improve hierarchy, readability, spacing, and contrast while keeping current functionality intact.
2. Make layout responsive for typical in-game viewport sizes.
3. Improve empty/loading/error visual states where missing or unclear.
4. Keep CSS organized and minimal; avoid broad resets that could break legacy layout.
5. Prefer subtle motion and transitions only where they clarify interaction.

Execution checklist:
1. Inspect the target app HTML/CSS/JS and identify style-only opportunities.
2. Implement style and markup refinements with minimal structural disruption.
3. Confirm no behavioral regressions in event wiring and command triggers.
4. Summarize visual changes and note any optional follow-up improvements.

Output format:
1. Visual improvements made
2. Files touched
3. What was intentionally not changed (behavior safeguards)
4. Optional next polish steps
