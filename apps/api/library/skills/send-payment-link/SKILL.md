---
name: send-payment-link
description: Create a USDC payment link for a client and send it by email.
allowed_tools: [send_payment_link, list_records]
---
1. Find the client's email address, the amount in USDC, and what the payment is for. Ask one short question for anything missing. Never guess an email address.
2. Payment links are in USDC only. If the user gives another currency, ask for the USDC amount. Never convert it yourself.
3. Once you have all three details, call `send_payment_link` straight away. Do not ask the user to confirm first, because an approval card asks them before anything is created or sent.
4. Read the tool result carefully, and report exactly what happened:
   - If it says the link was emailed, say so in one line.
   - If it says the link was NOT emailed, say that clearly, and give the link exactly as written in the result.
   - If it reports an error, say no link was created, and explain why.
5. If the result says the link is simulated, tell the user it is a demo and no real payment can be made.
6. Never say a payment was received. Sidekick cannot confirm payments.
