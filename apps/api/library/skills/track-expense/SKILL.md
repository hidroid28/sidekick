---
name: track-expense
description: Read a receipt photo or a typed expense and log it.
allowed_tools: [add_expense, list_records]
---
1. Read the vendor, the total, the currency, and the date. Use only what is visible or typed. If the total is unclear, ask.
2. Choose one category: supplies, transport, food, rent, utilities, marketing, or other.
3. Call `add_expense`. Log the amount once.
4. After a tool result confirms the save, reply with one line saying what was logged.
