# CLAUDE.md — Local AI Architect & Builder Rules

## Build & Verification
- Install: `bun install`
- Test: `bun run test`
- Typecheck & Bundle: `bun run build`
- Dev Server: `bun run dev`
- Version Bump (run before every push): `bun run version:bump` (`small` = +0.01, `medium` = +0.10, `major` = +1.00)
- npm is not installed on this machine; use bun for every script.

## Architectural Invariants
1. **Strict One-Way Layer Flow (`components -> state -> engine -> storage`):**
   - `src/types/` contains pure TypeScript interfaces and constants only.
   - `src/engine/` contains pure functions with zero React, DOM, or IndexedDB imports.
   - `src/storage/` encapsulates Dexie IndexedDB transactions, schema versioning, and `structuredClone` sanitization.
   - `src/components/` receives resolved view-models (`ResolvedCharacterSheet`) and dispatches semantic actions; never embed 5e math or regex parsers in JSX.
2. **TypeScript Hygiene:**
   - `strict: true` and `noUncheckedIndexedAccess: true` are enforced. Never introduce `any`; use `unknown` + narrowing.
3. **UI & Styling Standards:**
   - Use CSS custom properties from `src/styles/tokens.css` (`#0d1117` base, `#161b22` elevated).
   - Never use `window.alert()`, `window.confirm()`, or `window.prompt()`. Route all feedback to `StatusConsole`.
   - Keep numeric readouts aligned with `.tabular` (`font-variant-numeric: tabular-nums`).
