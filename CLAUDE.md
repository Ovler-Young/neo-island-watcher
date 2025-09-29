# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Rules

### Claude Code 八荣八耻

- 以瞎猜接口为耻，以认真查询为荣。
- 以模糊执行为耻，以寻求确认为荣。
- 以臆想业务为耻，以复用现有为荣。
- 以创造接口为耻，以主动测试为荣。
- 以跳过验证为耻，以人类确认为荣。
- 以破坏架构为耻，以遵循规范为荣。
- 以假装理解为耻，以诚实无知为荣。
- 以盲目修改为耻，以谨慎重构为荣。

### File Organization
- No single file should exceed 100 lines
- Split functionality into appropriate directories based on purpose
- Use proper module organization and clear separation of concerns

### Before Any Task
- Always ask context7 for most recent documentation
- If context7 unavailable, use deepwiki for reference

### Code Quality Workflow
1. After any file edit, immediately run:
   - `deno task format`
   - `deno task lint`
2. If no errors: commit changes with exact files only
3. Run `deno check --all --allow-import` to verify no type errors
4. If format/lint errors: fix them first, then commit

## Common Commands

### Development
- `deno task dev` - Development mode with watch
- `deno task start` - Production mode
- `deno task format` - Format code with Biome
- `deno task lint` - Lint and auto-fix with Biome

### Environment
Required `.env` variables:
- `TELEGRAM_BOT_TOKEN` (required)
- `XDNMB_API_BASE` (default: https://api.nmb.best)
- `XDNMB_FRONTEND_BASE` (default: https://www.nmbxd1.com)
- `MONITORING_INTERVAL` (default: 5 minutes)

## Project Architecture

### Core Purpose
XDNMB forum thread monitor with Telegram topic integration.
Each thread gets its own Telegram topic for real-time updates.

### Key Dependencies
- grammy: Telegram Bot API
- @std/json: JSON utilities
- @std/fs: File operations
- @std/path: Path utilities

### Storage System
JSON file-based persistence:
- `group-cookies.json`: Auth per group
- `feed-state.json`: Feed monitoring state
- `thread-state.json`: Thread tracking
- `thread-cache/`: Cached thread data
- `group-bindings.json`: Group relationships

### Main Bot Commands
- `/setcookie` - Set XDNMB auth
- `/bindfeed` - Bind feed to group
- `/reply` - Post to thread
- `/r` - Roll dice
- `/subscribe` - Manage subscriptions

See `docs/` for detailed API and integration documentation.