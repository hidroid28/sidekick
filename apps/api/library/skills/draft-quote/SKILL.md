---
name: draft-quote
description: Write a quote or invoice from a rough description of the work and save it.
allowed_tools: [create_quote, search_documents, read_skill_file]
---
1. Find the client, the items, the quantities, and the unit prices. Ask one short question for anything missing. Never guess a price.
2. Read `templates/quote.md` with `read_skill_file`.
3. Call `create_quote`. The server calculates the total, so do not calculate it yourself.
4. After a tool result confirms the save, show the finished quote using the template and the confirmed total.
