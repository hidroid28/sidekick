# Agent guide

Read this before changing anything. It tells any coding agent where the project stands, how to work in it, and what to do next. For product details, see [README.md](README.md).

## Project in brief

Sidekick is a hackathon demo: a practical AI assistant for one person, such as a sole trader or someone doing personal admin. Keep it universal and small. Do not add enterprise features such as roles, multi-tenancy, or billing unless the user asks.

| Part | Stack |
|---|---|
| `apps/api` | NestJS 12 on Express, ESM, plain `tsc`, `node:sqlite` |
| `apps/web` | Next.js 16 App Router, React 19 |
| `packages/shared` | Zod schemas and types used by both apps |
| `apps/api/library` | Markdown rules and skills |
| Model | Gemma 4 through the Gemini API |

## Current state

Last updated: 2026-10-31.

**Done:** chat with streaming, skills and rules with an in-app editor, profile setup, approval cards, quotes, expenses, document upload with citations, the Records page, and the phone layout.

**Not verified:**

- **Real Gemma 4 has never been used.** No API key was available, so tests used a fake model, and a browser walkthrough used a local stand-in for the Gemini API.
- The text tool protocol is untested on real model output. It is the biggest risk in the project.
- Attaching a receipt photo has not been tried in a real browser.
- The walkthrough was not repeated after the final phone CSS and placeholder fix.

Do not describe any of these as working until you have seen them work. Update this section when that changes.

## Next tasks, in order

1. **Verify Gemma 4.** Ask the user for a key if `apps/api/.env` has none, then run `npm run check:gemma`, set `GEMMA_MODEL`, and run it again.
2. **Act on the results.** The README's setup table says what each failure means. If the model will not follow the tool protocol, tighten the prompt in `apps/api/src/agent/prompt.ts` first, then consider native tools if `check:gemma` shows they pass.
3. **Run the demo by hand** using the README's three-minute script, including a real receipt photo. Fix what breaks.
4. **Deploy** to one small server with a persistent disk, and set `DEMO_PASSCODE`.

Only after those, and if the user wants them: an Ollama provider, DOCX upload, or a way to clear the active skill in a chat.

## Commands

Run everything from the repo root.

```powershell
npm install
npm test            # 134 offline tests, no key needed
npm run typecheck
npm run build -w @sidekick/web
npm run check:gemma # calls the real API, needs a key in apps/api/.env
npm run dev:api     # http://localhost:3001, compiles once at startup
npm run dev:web     # http://localhost:3000
```

Before calling work finished, run `npm test` and `npm run typecheck`. Also run the web build if you touched `apps/web` or `packages/shared`.

## Rules that must not break

Markdown guides the model, but it cannot enforce anything. Keep these in code, and add a test when you touch them:

1. **Tool permissions are server-side.** `ToolsService.dispatch` checks every call. Never rely on prompt text.
2. **Actions need approval.** Anything that saves or sends must go through `pending_actions`. The model never performs one directly.
3. **An action runs once.** `settlePending` is the guard.
4. **The server does the money.** Use whole cents, never a model's total, and never add different currencies together.
5. **Outside content is untrusted.** Wrap tool results and document text with `wrapUntrusted`.
6. **Skill files stay in their folder.** Keep the path check in `readSkillFile`.
7. **Never run frontmatter as code.** Only YAML is parsed, which is why `gray-matter` is not used.
8. **Model reasoning stays hidden.** Thought parts are dropped in `GeminiProvider`, and tool blocks are hidden by `ToolBlockFilter`.
9. **Secrets stay out of the repo.** The API key lives in `apps/api/.env`, on the server, and is sent in a header. Never put a key in a URL or a `NEXT_PUBLIC_` variable.
10. **Errors stay safe.** Only `ModelError` messages reach users.

## Project-specific gotchas

- **Do not use `tsx`.** It ignored `experimentalDecorators` here. The API must compile with `tsc`.
- **Nest 12 is ESM-only.** Local imports in `apps/api` need `.js` extensions.
- **Use `@Inject(...)` on every constructor parameter.** Vitest does not emit decorator metadata, so type-based injection fails in tests.
- **Use `import type` for types in decorated constructors.** This covers interfaces such as `AppConfig`.
- **`packages/shared` must be built.** Apps import its `dist`. The package scripts build it first, but run `npm run build -w @sidekick/shared` if types look stale.
- **`dev:api` does not watch files.** Restart it after backend changes.
- **Rules and skills load per request.** Do not cache them, because instant editing is a demo feature.
- **`next build` skips type-checking** to stay light on memory, so run `npm run typecheck` separately.
- **Keep the system prompt inline by default.** `GEMMA_USE_SYSTEM_INSTRUCTION` stays false until `check:gemma` shows it works.
- **npm warns about skipped `esbuild` install scripts.** This has been harmless so far.
- **On a low-memory machine,** run installs and builds in the foreground, one at a time.

## How to change common things

**Add a skill:** create `apps/api/library/skills/<name>/SKILL.md`. The `name` field must match the folder, and `allowed_tools` must list every tool it needs. It needs no code or restart.

**Add a rule:** create `apps/api/library/rules/<name>.md` with `title` and `priority`. Lower numbers come first, and the highest numbers are dropped first when over budget.

**Add a read tool:** add it to `TOOLS` in `apps/api/src/tools/tools.service.ts`, handle it in `read()`, and allow it in the relevant skills.

**Add an action tool:** do the above with `action: true`, add a Zod schema in `packages/shared`, handle it in `propose()` and `execute()`, and add tests for the refusal, approval, and decline paths.

**Add a model provider:** implement `ModelProvider` in `apps/api/src/llm`, and bind it to `MODEL_PROVIDER` in `app.module.ts`. It must never yield reasoning text.

## Working style

- Keep changes small and match the existing code.
- Test behaviour through public methods. `apps/api/test/helpers.ts` has `FakeModel`, `toolBlock`, and `makeServices`.
- Update the README when behaviour changes, and update "Current state" here when you verify or finish something.
- Use made-up data only. Never commit `.env`, SQLite files, or real customer information.
- Ask before pushing, deploying, or sending data to a new outside service.
- Report honestly. If something was only tested with the fake model, say so.
