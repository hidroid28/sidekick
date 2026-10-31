# Sidekick

Sidekick is a practical AI assistant for one person: a sole trader, a freelancer, or anyone handling everyday admin. It writes quotes, reads receipts, drafts payment reminders, and answers questions about your documents. It runs on Gemma 4.

Its behaviour lives in plain Markdown files. Edit a rule or a skill in the app, and the next message follows it, with no redeploy.

This is a hackathon demo, built for one user at a time. If you're a coding agent, start with [AGENTS.md](AGENTS.md).

> **Status:** the full app works and is tested, but it has **not yet been run against the real Gemma 4 model**, because no API key was available during the build. Tests and the browser walkthrough used a stand-in for the Gemini API. Do step 2 of the setup below before relying on it.

## What it does

- **Chat** with streaming replies, saved history, and a Stop button.
- **Works for anyone.** The profile questions are optional, so it also works as a general assistant.
- **Skills:** type `/` to pick one, or let the assistant choose one.
- **Rules** that always apply, such as "never invent prices".
- **Approval cards:** nothing is saved until you press Approve.
- **Photos:** attach a receipt and log it as an expense.
- **Documents:** upload PDF, TXT, MD, or CSV files, up to 5 MB, and get answers that cite their sources.
- **Records:** see approved quotes and expenses, with totals per currency.

## Setup

You need Node.js 24 or newer, because the app uses the built-in `node:sqlite` module. It was built and tested on Node 26.

**1. Install and add your settings**

```powershell
cd C:\Users\HP\Desktop\sidekick
npm install
copy apps\api\.env.example apps\api\.env
```

Add your `GOOGLE_API_KEY` from [Google AI Studio](https://aistudio.google.com/apikey) to `apps/api/.env`.

**2. Check Gemma 4 (do this first)**

```powershell
npm run check:gemma
```

This lists the Gemma 4 model ids your key can use. Put one in `GEMMA_MODEL`, then run the command again. It tests plain text, `systemInstruction`, JSON mode, images, native tools, and the text tool protocol.

| Check | If it fails |
|---|---|
| plain text | Check the key and model id. Nothing else can work until this passes. |
| text tool protocol | Skills and tools will not work reliably. See "Tools" below. |
| image input | Receipt photos will not work. Type expenses instead. |
| systemInstruction | No action needed. This is off by default. |
| JSON mode, native tools | No action needed. The app does not use them. |

If `systemInstruction` passes, you can set `GEMMA_USE_SYSTEM_INSTRUCTION=true`.

**3. Run it, in two terminals**

```powershell
npm run dev:api
npm run dev:web
```

Open http://localhost:3000. After changing backend code, restart `dev:api`, because it compiles once at startup.

## Three-minute demo

1. Set up a profile, such as Mwila Tailoring with currency ZMW.
2. Type `/draft-quote 3 uniforms at 150 each for Sunrise Primary` and approve the card.
3. Attach a receipt photo, type `/track-expense`, and approve it. Show it on the Records page.
4. Upload `docs/sample-contract.txt` and ask "When is the balance due?". The answer shows its source.
5. Open **Skills & rules**, add a line to the Tone rule, and send a message. This is the strongest closing moment, because behaviour changes with no redeploy.

Use made-up data only, and keep a recorded backup in case rate limits or the venue Wi-Fi fail.

## How it works

```text
Next.js  ── POST /conversations/:id/messages ──▶  NestJS  ── returns runId
         ◀─ GET /runs/:id/events (SSE stream) ──
                                                    │
        rules + profile + skill list + history ─────┤
                                                    ▼
                                              Gemma 4 replies
                                               │         │
                                     plain text│         │tool block
                                               ▼         ▼
                                            saved    read tool ──▶ result goes back to the model
                                                     action ─────▶ waits for Approve or Decline
```

A reply takes two requests because Nest's `@Sse()` only handles GET. This also fits approvals, because a run can pause and a new one can continue after your decision. A client that reconnects replays the same run's events.

## Layout

```text
apps/api/
  library/     rules and skills, as Markdown
  src/agent/   prompt building and the tool loop
  src/chat/    message handling and streaming runs
  src/llm/     ModelProvider interface and Gemini provider
  src/library/ loading and saving rules and skills
  src/knowledge/ document text, chunking, search
  src/tools/   tool protocol, permissions, quotes, expenses
  src/db/      SQLite
  test/        backend tests
apps/web/      Next.js app
packages/shared/ schemas and types used by both apps
docs/          sample contract for the demo
```

## Rules

A rule is a file in `apps/api/library/rules/`. Rules are always in the prompt. Lower `priority` numbers come first, and when rules exceed the 8,000-character budget, the highest numbers are dropped first. Keep safety rules at low numbers.

```markdown
---
title: Tone
priority: 20
---
Be clear, friendly, and brief.
```

## Skills

A skill is a folder in `apps/api/library/skills/` containing a `SKILL.md`. The `name` field must match the folder name.

```markdown
---
name: draft-quote
description: Write a quote or invoice from a rough description of the work and save it.
allowed_tools: [create_quote, search_documents, read_skill_file]
---
The steps the assistant follows.
```

Only the name and description sit in the prompt. The full text loads when the skill is activated, which keeps prompts small. Extra files in the folder load on demand through `read_skill_file`.

The app can edit existing rules and skills. To add a new one, create the file, and it appears on the next message with no restart.

The starter skills are `draft-quote`, `chase-payment`, `track-expense`, `price-my-work`, `write-post`, and `explain-document`.

## Tools

| Tool | Type | Available |
|---|---|---|
| `use_skill` | read | always |
| `search_documents`, `list_records` | read | with no skill, or if the skill allows it |
| `read_skill_file` | read | if the active skill allows it |
| `create_quote`, `add_expense` | action, needs approval | only if the active skill allows it |

Tools use a text protocol, where the model replies with a fenced `tool` block. Sidekick hides that block from the user and runs it on the server. This was chosen because I found no official confirmation that Gemma 4 supports native function calling on the Gemini API. If `check:gemma` shows that native tools work, this can be swapped later inside `src/tools/protocol.ts` and `src/llm/gemini.provider.ts`.

## Safety

Markdown guides the model, but it cannot enforce anything. These protections are in code:

- **Permissions:** every tool call is checked on the server, whatever the prompt said.
- **Approvals:** actions save nothing until you approve, and an approved action cannot run twice.
- **Totals:** the server calculates money in whole cents and never uses a model's sum.
- **Untrusted content:** documents and tool results are marked as data, and the wrapper cannot be closed from inside.
- **File paths:** skill files cannot be read from outside their folder.
- **API key:** it stays on the server and is sent in a header, so it never appears in a URL.
- **Rendering:** model output goes through `react-markdown`, with raw HTML left off.
- **Limits:** messages are limited to 30 per minute per client, and uploads are checked for size and type.

Before hosting publicly, set `DEMO_PASSCODE`. Without it, anyone with the link can use your API quota and read the saved data. Check Google's data terms before using real customer information, especially on a free tier.

## Testing

```powershell
npm test
npm run typecheck
```

There are 134 tests: 125 for the backend and 9 for the frontend's shared logic. They run offline with a fake model, so they need no key. They cover the tool protocol, permissions, approvals, money, file paths, Gemini streaming, document search, and the HTTP API.

During the build, these checks were also run but are not part of `npm test`:

- Nine safety behaviours were broken on purpose, and the tests caught all nine.
- The production build was driven through the demo in Microsoft Edge, against a local stand-in for the Gemini API, at desktop and phone widths.

Automated tests do not cover React components, camera or photo upload in a real browser, or real Gemma 4 output.

## Build decisions

These changed from the original plan:

| Plan | Built | Why |
|---|---|---|
| pnpm | npm workspaces | pnpm was not installed |
| Drizzle ORM | `node:sqlite` with plain SQL | No native build, fewer dependencies |
| Embeddings | BM25 keyword search | No second model, works offline |
| Native tool calling | Text tool protocol | Works on any model |
| `nest start` with SWC | `tsc`, then Node | Nest 12 is ESM-only, and `tsx` ignored the decorator setting |
| DOCX upload | Not included | Cut for time |

`tsx` is not used. The API must be compiled with `tsc`.

## Known limits

- It has not been run against real Gemma 4 yet.
- It serves one user, with no accounts.
- Search matches words, not meaning, so "payment" will not find "deposit".
- Scanned PDFs and DOCX files are not supported.
- Quotes stay inside Sidekick and are not sent anywhere.
- A server restart loses replies in progress, and saved chats and pending approvals survive.
- A skill stays active for the rest of a chat. Start a new chat to clear it.
- `ModelProvider` is ready for Ollama, but only the Gemini provider exists.

## Troubleshooting

| Problem | Fix |
|---|---|
| "The assistant is not set up yet" | Add `GOOGLE_API_KEY` and `GEMMA_MODEL` to `apps/api/.env` |
| "Cannot reach the server" | Start `npm run dev:api` |
| "The model is busy" | You hit a rate limit, so wait a minute |
| A rule or skill is ignored | Check the API log. Invalid files are skipped with a warning |
| Tools show up as text, or replies stall | Rerun `npm run check:gemma` and see "Tools" |
| Hosting elsewhere | Set `NEXT_PUBLIC_API_URL` before `next build`, and `WEB_ORIGIN` on the API |
