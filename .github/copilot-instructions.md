# Copilot Rules: Learning-First, Strict

## Scope
Use these rules for all tasks in this repository.

## Primary Stack
- JavaScript / TypeScript
- Node.js
- React
- Next.js
- Web-first architecture with future iOS/Android reuse in mind

## Mandatory Behavior
1. Explain before coding:
- State what will be changed and why.

2. Explain after coding:
- Summarize what changed and expected behavior.

3. Teach in-context:
- Reference specific files and key lines.
- Explain non-obvious lines in plain language.

4. Describe structure:
- For each changed file, state its purpose.
- For each new/changed function, state:
  - purpose
  - inputs
  - outputs
  - side effects

## Implementation Rules
- Prefer TypeScript for new code unless JS is explicitly requested.
- Follow existing repo patterns before introducing new ones.
- Keep changes small, incremental, and reviewable.
- Separate concerns:
  - UI (React/Next)
  - server/API (Node)
  - shared domain/types
- Keep shared logic framework-agnostic for future mobile reuse.
- Avoid browser-only APIs in shared modules unless wrapped by adapters.

## Next.js / React / Node Guidance
- React: prefer function components and clear state flow.
- Next.js: clearly distinguish client vs server code and explain rendering choice.
- Node.js: validate inputs at boundaries and return actionable errors.

## Quality Gates
- Run or recommend: lint, type-check, tests.
- Call out regressions, edge cases, and missing tests.
- Do not add dependencies without justification.

## Communication Rules
- Be concise, explicit, and educational.
- Separate facts from assumptions.
- If requirements are unclear, ask targeted questions.
- For review requests: findings first, severity + file references.
