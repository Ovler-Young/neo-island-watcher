# CLAUDE.md

This file provides guidance for Claude when working with code in this repository. Follow these rules strictly.

## ❗ LEVEL 1: MANDATORY WORKFLOW ❗

**Before writing or modifying any code, you MUST follow this checklist and propose a plan. Wait for human approval before proceeding.**

1.  **Confirm Goal:** State the user's request you are about to address.

      - *Example: "The goal is to add a new `/subscribe` command."*

2.  **Consult Documentation:** Identify and state which files from the `docs/` directory are relevant and have been consulted. If none, explain why.

      - *Example: "I will consult `docs/01-api.md` for the API endpoint and `docs/03-storage.md` for how `thread-state.json` is managed."*

3.  **Propose Changes:** List the specific files you will create or modify.

      - *Example: "I will modify `src/bot/commands.ts` and create `src/bot/subscribe.ts`."*

4.  **Outline Plan:** Briefly describe the key changes for each file.

      - *Example: "In `commands.ts`, I will import and register the new subscribe command. In `subscribe.ts`, I will implement the logic to update `thread-state.json`."*

5.  **State Verification Steps:** Specify the commands that must be run after the changes are made to ensure code quality.

      - *Example: "After coding, the verification steps are: `deno task format`, `deno task lint`, and `deno check --all --allow-import`."*

**-->> Await explicit approval from the user before writing any code. <--**

## ⭐ LEVEL 2: ACTIONABLE PRINCIPLES⭐

These are the core principles that guide your work. They are implemented through the **Mandatory Workflow**.

| Principle | ❌ Bad Practice (耻) | ✅ Required Action (荣) |
| :--- | :--- | :--- |
| **1. Query, Don't Guess** <br> (以认真查询为荣，以瞎猜接口为耻) | Guessing API signatures, paths, or logic. | **Always reference `docs/` files.** State which document provides the basis for your code. |
| **2. Confirm, Don't Assume** <br> (以寻求确认为荣，以模糊执行为耻) | Executing an ambiguous request without a clear plan. | **Follow the Mandatory Workflow.** Always present your plan and get approval before acting. |
| **3. Reuse, Don't Invent** <br> (以复用现有为荣，以臆想业务为耻) | Writing new utility functions when similar ones already exist. | Before writing new helpers, **ask if a suitable utility already exists** in the codebase. |
| **4. Test, Don't Just Create** <br> (以主动测试为荣，以创造接口为耻) | Providing code for a new feature without a way to test it. | When adding a new command or feature, **provide a simple example of how to test it.** |
| **5. Be Honest, Don't Feign** <br> (以诚实无知为荣，以假装理解为耻) | Pretending to understand a vague or incomplete request. | If a user's request is unclear, **immediately ask for clarification.** |
| **6. Follow Architecture** <br> (以遵循规范为荣，以破坏架构为耻) | Adding features that contradict the established architecture. | Explain how your proposed change **fits into the existing storage and data flow** described below. |

## 📚 LEVEL 3: PROJECT REFERENCE 📚

### 1. Code Quality Workflow

This is the standard procedure after *any* file edit. This is part of your **Verification Plan** in the Mandatory Workflow.

1.  **Format, Lint, Type Check All in One:**
    ```bash
    deno task check:all
    ```
2.  **Commit:** If all checks pass, commit *only* the specific files that were intentionally changed.

Run these workflow **Every Time** after any code modification, even if you are only fixing a typo in a comment.

### 2. File Organization

  - No single file should exceed 100 lines.
  - Split functionality into appropriate directories based on purpose.
  - Use proper module organization and clear separation of concerns.

### 3. Common Commands

  - **Development:** `deno task dev` (with file watching)
  - **Production:** `deno task start`
  - **Formatting:** `deno task format` (via Biome)
  - **Linting:** `deno task lint` (via Biome, with auto-fix)

### 4. Environment Variables (`.env`)

  - `TELEGRAM_BOT_TOKEN` (Required)
  - `XDNMB_API_BASE` (Default: `https://api.nmb.best`)
  - `XDNMB_FRONTEND_BASE` (Default: `https://www.nmbxd1.com`)
  - `MONITORING_INTERVAL` (Default: `5 minutes`)

### 5. Project Architecture

  - **Purpose:** XDNMB forum thread monitor with Telegram topic integration. Each monitored thread gets its own Telegram topic for real-time updates.
  - **Key Dependencies:** `grammy` (Telegram Bot API), `@std/json`, `@std/fs`, `@std/path`.
  - **Storage System:** JSON file-based persistence.
      - `group-cookies.json`: Auth cookies per group.
      - `feed-state.json`: State of the monitored feeds.
      - `thread-state.json`: Tracking individual threads.
      - `thread-cache/`: Cached thread data.
      - `group-bindings.json`: Relationships between Telegram groups and feeds.

### 6. Main Bot Commands

  - `/setcookie`: Set XDNMB auth cookie for the group.
  - `/bindfeed`: Bind a forum feed to the Telegram group.
  - `/reply`: Post a reply to a monitored thread.
  - `/r`: Roll dice in a thread.
  - `/subscribe`: Manage thread subscriptions.