# OpenBot agent notes

Before claiming a server or conversation change works, follow
[`docs/verification/README.md`](docs/verification/README.md). Always launch an
isolated fixture; never verify mutations against the user's live app or data.

## Comments

Write a comment only for what the code cannot say:

- a license or attribution notice;
- a fact forced by something outside this code (a vendor, CLI, OS, browser,
  Electron or protocol behaviour), with its version when it has one;
- the doc comment of a public contract: the wire types in `shared/`, the
  driver interface, the preload bridge, `config.json` fields people edit;
- a link to an upstream issue;
- a security invariant or a known open risk.

Do not narrate what the next line does, restate a name, record history ("used
to", "no longer", PR or issue numbers, plan or slice names: git has it), point
at other files, draw banners or leave commented-out code. When our own code
needs a paragraph to explain a surprise, change the code instead: a better
name, a type, an extracted function, one shared helper. A rule ("never X",
"must match Y") belongs in a type, a test or a lint rule. Never suppress a lint
rule that guards correctness; fix the code.

More specific `AGENTS.md` files override this note within their directories.

## Learned User Preferences

- Imitate Grok Bot by copying product behavior, and keep each engine on its own subscription (Claude, Codex, Grok CLI, xAI API, or a custom CLI). Do not bind memory injection or engine choice to one model.
- Vault imitation is saved logins only. Do not add payments.
- Zero paywalls: never add any paid/charge/buy credits/auto-top-up buttons or payment flows anywhere in the application.
- Personal cloud computer (Local VM): on macOS use Docker containerization; on Windows use WSL2 / Docker Desktop with WSL2 backend (with optional native Windows CUA fallback).


## Learned Workspace Facts

- Per-bot memory is injected before the engine, not inside a driver. A name, a time zone the user states, and how every bot should speak go only in About me; the profile email is not injected. Passwords, card numbers, phone numbers, email addresses, keys, prices, balances, unread counts, limits, and screen observations (screenshots, window text, click coordinates) are not long-term memory. A confirmed outcome may be kept without the screen.
- Grok Bot defaults: a bot with no computer of its own uses the one shared account computer; an approved skill applies to the whole account; memory and routines belong to exactly one bot.
- A bot is told which sites have a saved login, not the username or password. The server types those into the page. When one site has several saved logins, the bot asks which account, then calls fill_login with the username the person gives.
