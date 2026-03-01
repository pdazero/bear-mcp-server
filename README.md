# Bear Notes MCP Server

> A Model Context Protocol server that gives AI assistants full access to your Bear Notes — read, write, and semantic search — all running locally on your Mac.

## Features

- **21 MCP tools** — 9 read, 8 write, 4 semantic/RAG
- **Pluggable embedding providers** — built-in transformers.js, Ollama, LM Studio, or any OpenAI-compatible API
- **Auto-incremental indexing** — vector index stays fresh without manual rebuilds
- **Local-first, privacy-first** — everything runs on your machine, no data leaves your computer

## Quick Start

```bash
git clone https://github.com/pda/bear-mcp-server.git
cd bear-mcp-server
npm install
```

To enable semantic search and RAG tools, create a vector index:

```bash
npm run index
```

Then configure your MCP client (see below).

## Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bear-notes": {
      "command": "node",
      "args": ["/absolute/path/to/bear-mcp-server/src/index.js"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add bear-notes -- node /absolute/path/to/bear-mcp-server/src/index.js
```

### Environment Variables

All configuration is optional — sensible defaults are built in.

| Variable | Default | Description |
|----------|---------|-------------|
| `BEAR_DATABASE_PATH` | Auto-detected | Path to Bear's SQLite database |
| `EMBEDDING_PRESET` | `light` | Preset: `light`, `medium`, or `heavy` (see below) |
| `EMBEDDING_BACKEND` | `lmstudio` | Backend for medium/heavy presets: `lmstudio` or `ollama` |
| `EMBEDDING_PROVIDER` | _(from preset)_ | Override preset: `transformers`, `ollama`, `lmstudio`, `openai-compat` |
| `EMBEDDING_MODEL` | _(from preset)_ | Model name (required if EMBEDDING_PROVIDER is set) |
| `EMBEDDING_DIMENSIONS` | _(from preset)_ | Vector dimensions (required if EMBEDDING_PROVIDER is set) |
| `EMBEDDING_BASE_URL` | — | API base URL for ollama/lmstudio/openai-compat providers |
| `EMBEDDING_API_KEY` | — | API key for openai-compat provider |
| `EMBEDDING_INSTRUCTION_PREFIX` | — | Prefix prepended to text before embedding |
| `AUTO_INDEX_ENABLED` | `false` | Enable auto-incremental indexing |
| `AUTO_INDEX_INTERVAL_SECONDS` | `300` | Seconds between auto-index checks |
| `DATA_DIR` | `data` | Directory for vector index storage |
| `LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |

### Embedding Presets

| Preset | Provider | Model | Dimensions | Notes |
|--------|----------|-------|------------|-------|
| `light` | transformers.js | onnx-community/embeddinggemma-300m-ONNX | 768 | Built-in, no external dependencies |
| `medium` | LM Studio / Ollama | bge-m3 | 1024 | Requires local inference server |
| `heavy` | LM Studio / Ollama | qwen3-embedding:4b | 1024 | Best quality, requires local inference server |

## Available Tools

### Read Tools (9)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `search_notes` | Search notes by text (semantic or keyword) | `query`, `tag`, `limit`, `sort_by`, `semantic` |
| `get_note` | Retrieve a note by ID or title | `id`, `title` |
| `get_tags` | List all tags with note counts | — |
| `open_tag` | List notes under a tag | `name`, `limit` |
| `get_untagged` | List notes with no tags | `limit` |
| `get_todos` | List notes with todo items | `search`, `limit` |
| `get_today` | Notes created or modified today | `search` |
| `get_backlinks` | Find notes linking to a given note | `id`, `title` |
| `get_db_stats` | Database and vector index statistics | — |

### Write Tools (8)

Write tools use Bear's `x-callback-url` API. Bear must be running.

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `create_note` | Create a new note | `title`, `text`, `tags`, `pin` |
| `add_text` | Append/prepend text to a note | `id`, `title`, `text`, `mode` |
| `add_file` | Attach a file to a note | `id`, `title`, `file` (base64), `filename` |
| `trash_note` | Move a note to trash | `id` |
| `archive_note` | Archive a note | `id` |
| `rename_tag` | Rename a tag across all notes | `name`, `new_name` |
| `delete_tag` | Delete a tag from all notes | `name` |
| `grab_url` | Create a note from a web page | `url`, `tags` |

### Semantic / RAG Tools (4)

These tools require a vector index. Run `npm run index` first.

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `semantic_search` | Search by meaning with similarity scores | `query`, `limit`, `min_similarity`, `tag_filter` |
| `retrieve_for_rag` | Retrieve context for AI responses (token-budgeted) | `query`, `limit`, `max_tokens` |
| `find_related` | Find notes similar to a given note | `id`, `title`, `limit` |
| `discover_patterns` | Cluster notes into thematic groups | `num_clusters`, `tag_filter` |

## Architecture

```
src/
├── index.js                  # Entry point — wires everything together
├── config.js                 # Environment-based configuration + presets
├── server.js                 # MCP protocol server (stdio transport)
├── tools/
│   ├── read-tools.js         # 9 read tools + 4 conditional semantic tools
│   └── write-tools.js        # 8 write tools via x-callback-url
├── db/
│   ├── connection.js          # SQLite connection management
│   ├── schema.js              # Bear database schema constants
│   └── queries.js             # All database queries
├── rag/
│   ├── embeddings.js          # Provider factory
│   ├── index-manager.js       # HNSW vector index (hnswlib-node)
│   ├── semantic-search.js     # Search, RAG, find_related, discover_patterns
│   ├── kmeans.js              # K-means clustering for discover_patterns
│   └── providers/
│       ├── transformers-provider.js   # Built-in (transformers.js)
│       ├── ollama-provider.js
│       ├── lmstudio-provider.js
│       └── openai-compat-provider.js
├── bear-api/
│   └── xcallback.js           # x-callback-url bridge for write operations
├── indexer/
│   └── auto-indexer.js        # Incremental background indexing
└── utils/
    ├── logger.js              # Structured logging
    └── text-budget.js         # Token estimation and truncation
```

## How It Works

- **Read operations** query Bear's SQLite database directly — no UI interaction, no focus stealing.
- **Write operations** use Bear's `x-callback-url` API, which is iCloud-sync safe and respects Bear's data model.
- **Semantic search** embeds queries with a configurable provider and searches an HNSW vector index built from your notes. Adaptive similarity thresholds and k-means clustering power the RAG and discovery tools.

## Auto-Indexing

When enabled, the server periodically checks for new or modified notes and updates the vector index incrementally — no full rebuild needed.

```bash
# Enable via environment
AUTO_INDEX_ENABLED=true
AUTO_INDEX_INTERVAL_SECONDS=300  # check every 5 minutes
```

You still need an initial `npm run index` to create the index. Auto-indexing keeps it up to date after that.

## Docker

```bash
# Build
docker build -t bear-mcp-server .

# Index your notes (persists index in a named volume)
docker run \
  -v "/path/to/Bear/database.sqlite:/app/database.sqlite:ro" \
  -v bear-data:/app/data \
  -e BEAR_DATABASE_PATH=/app/database.sqlite \
  bear-mcp-server npm run index

# Run the server (same volume to access the index)
docker run \
  -v "/path/to/Bear/database.sqlite:/app/database.sqlite:ro" \
  -v bear-data:/app/data \
  -e BEAR_DATABASE_PATH=/app/database.sqlite \
  bear-mcp-server
```

> Replace `/path/to/Bear/database.sqlite` with the actual path. The default Bear database location is:
> `~/Library/Group Containers/9K33E3U3T4.net.shinyfrog.bear/Application Data/database.sqlite`

## Requirements

- **Node.js** >= 18
- **macOS** with Bear Notes installed
- **Bear must be running** for write tools (`create_note`, `add_text`, etc.)
- **Embedding provider** for semantic tools — built-in `transformers.js` works out of the box, or use Ollama / LM Studio for higher quality

## Troubleshooting

**Semantic search not working?**
Run `npm run index` to create the vector index. Check that your embedding provider is running if using `medium` or `heavy` presets.

**Database not found?**
The server auto-detects Bear's default database path. If you moved it, set `BEAR_DATABASE_PATH`.

**Write tools failing?**
Make sure Bear is open. Write operations use `x-callback-url` which requires the Bear app to be running.

**Auto-indexing not starting?**
Set `AUTO_INDEX_ENABLED=true` and ensure the vector index exists (run `npm run index` first).

## License

MIT
