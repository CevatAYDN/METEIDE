---
name: openui-setup
description: Set up a first Generative UI agent with the recommended OpenUI stack (scaffold, required user steps, first message). Use when the user asks to try OpenUI, scaffold an OpenUI app, or prototype a generative UI for the METE studio view.
---

# OpenUI setup

Docs: https://www.openui.com/docs/getting-started

1. Scaffold: run `npx @openuidev/cli@latest create`. It runs without prompts, creates the project folder, and installs dependencies.
2. Tell the user if there are any steps required of them to complete (for example API keys or accounts).
3. First message: start the app, open its local URL, send one message, and tell the user what the server log actually returned.

## METE rules

- Scaffold outside the METE monorepo packages (for example a scratch folder) unless the user says otherwise. Adding OpenUI to METE needs an ADR first (AGENTS.md rule 10).
- Use only free providers (overview: no card on file). If the scaffold asks for a paid key, stop and tell the user.
- Report the real server log output; never summarize a run that did not happen.
