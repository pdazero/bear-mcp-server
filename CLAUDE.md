# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bear Notes MCP Server — a Model Context Protocol server providing AI assistants with read, write, and semantic search access to Bear Notes. Uses ES modules, Node.js ≥18, no build step.

## Commands

```bash
npm test                           # Run all tests (node --test)
node --test tests/config.test.js   # Run a single test file
npm start                          # Start MCP server (stdio transport)
npm run index                      # Build vector index (scripts/create-index.js)
```

CI runs `npm test` on Node 18, 20, 22 via GitHub Actions.

## Architecture

### Initialization Chain (src/index.js)

The server starts in layers with graceful degradation:
1. **Config** → load env vars / presets (immutable, frozen)
2. **Database** → open Bear's SQLite (required, exits on failure)
3. **Embeddings + Vector Index** → optional, falls back to keyword-only search
4. **Tools** → factory functions receive shared deps (`db`, `provider`, `indexManager`, `hasSemanticSearch`)
5. **MCP Server** → stdio transport
6. **Auto-indexer** → interval-based incremental sync (only if index + provider available)

### Key Modules

- **`src/server.js`** — MCP protocol wiring. Tool definitions and handlers stored in a `Map`. All tool handlers return JSON; errors become `isError: true` responses.
- **`src/db/`** — Read-only access to Bear's Core Data SQLite. `queries.js` uses a prepared statement cache. Schema constants in `schema.js` handle Apple's Core Data epoch (2001-01-01).
- **`src/tools/read-tools.js`** — 9 always-available read tools + 4 conditional semantic/RAG tools (registered only when vector index is loaded).
- **`src/tools/write-tools.js`** — 8 write tools via Bear's `x-callback-url` API (fire-and-forget through macOS `open` command).
- **`src/rag/`** — Embedding providers (factory pattern), HNSW vector index (`IndexManager`), semantic search with adaptive similarity thresholds, k-means clustering, token budgeting for RAG context.
- **`src/rag/providers/`** — Pluggable embedding backends: `transformers` (local), `ollama`, `lmstudio`, `openai-compat`. All extend `EmbeddingProvider` base class with `embed()`, `embedBatch()`, `healthCheck()`, `dispose()`.
- **`src/indexer/auto-indexer.js`** — Polls for modified notes, embeds incrementally, periodically detects trashed notes for removal.

### Configuration (src/config.js)

Three embedding presets (`light`/`medium`/`heavy`) with full custom override via `EMBEDDING_PROVIDER` + `EMBEDDING_MODEL` + `EMBEDDING_DIMENSIONS`. Config is frozen after load.

### Testing

Node.js native test runner (`node:test` + `assert/strict`). Database-dependent tests skip gracefully when Bear's SQLite isn't available. No external test framework or transpilation needed.
