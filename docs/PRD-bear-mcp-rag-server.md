# PRD: Bear MCP Server Unificado
## Nombre del proyecto: `bear-mcp-rag-server`
### Fork de `ruanodendaal/bear-mcp-server` con API completa + RAG + Auto-indexado

**Autor:** Patricio  
**Fecha:** 27 de febrero de 2026  
**Versión PRD:** 1.1  
**Licencia base:** MIT (heredada del proyecto original)

---

## 1. Visión y Objetivo

### 1.1 Problema
Actualmente existen múltiples MCP servers para Bear Notes, cada uno resolviendo un subconjunto del problema:

- **ruanodendaal/bear-mcp-server**: Búsqueda semántica RAG, pero solo lectura y con 4 tools limitados. Sin escritura, sin auto-indexado.
- **vasylenko/bear-notes-mcp**: Lectura/escritura vía x-callback-url y SQLite, pero sin búsqueda semántica.
- **bejaminjones/bear-notes-mcp**: Arquitectura compleja con muchos servicios, pero sin RAG.

Ninguno ofrece la combinación completa: **API Bear completa + búsqueda semántica RAG + re-indexado automático** en un solo MCP server.

### 1.2 Solución
Un fork del proyecto de Ruan Odendaal que extienda su base RAG con:

1. **Todas las acciones de la Bear x-callback-url API** expuestas como MCP tools
2. **Lectura directa de SQLite** para operaciones de lectura (más rápida, no abre la UI de Bear)
3. **x-callback-url** para operaciones de escritura (sync-safe con iCloud)
4. **Re-indexado automático** de vectores al detectar cambios en la base de datos
5. **Indexado incremental** (solo notas nuevas o modificadas, no full-rebuild cada vez)

### 1.3 Principios de Diseño
- **Local-first**: Todo se ejecuta en la máquina del usuario. Cero dependencias cloud.
- **Privacidad total**: Ningún dato sale del equipo. Sin API keys externas para embeddings.
- **Un solo MCP server**: No obligar al usuario a configurar múltiples servers.
- **No-UI para lectura**: Las operaciones de lectura NO deben abrir Bear ni robar el foco de la ventana.
- **Seguridad de datos**: Escrituras siempre vía Bear API oficial (x-callback-url) para respetar iCloud sync.

---

## 2. Arquitectura

### 2.1 Diagrama General

```
┌────────────────────────────────────────────────────────────────┐
│                    bear-mcp-rag-server                          │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                     MCP Server Layer                      │  │
│  │              (stdio transport, MCP SDK)                   │  │
│  └────────────┬────────────────────────┬────────────────────┘  │
│               │                        │                       │
│  ┌────────────▼──────────┐  ┌─────────▼───────────────────┐  │
│  │   READ Operations     │  │   WRITE Operations          │  │
│  │   (SQLite directo)    │  │   (x-callback-url API)      │  │
│  │                       │  │                             │  │
│  │  • search_notes       │  │  • create_note              │  │
│  │  • get_note           │  │  • add_text                 │  │
│  │  • get_tags           │  │  • add_file                 │  │
│  │  • open_tag           │  │  • trash_note               │  │
│  │  • get_untagged       │  │  • archive_note             │  │
│  │  • get_todos          │  │  • rename_tag               │  │
│  │  • get_today          │  │  • delete_tag               │  │
│  │  • get_backlinks      │  │  • grab_url                 │  │
│  │  • get_note_count     │  │                             │  │
│  │  • get_db_stats       │  │  Usa: open(bear://...)      │  │
│  │                       │  │  + x-success callback       │  │
│  │  Usa: better-sqlite3  │  │                             │  │
│  └────────────┬──────────┘  └─────────────────────────────┘  │
│               │                                               │
│  ┌────────────▼──────────────────────────────────────────┐   │
│  │            Semantic / RAG Layer                         │   │
│  │                                                        │   │
│  │  • retrieve_for_rag    (búsqueda semántica)           │   │
│  │  • semantic_search     (búsqueda por significado)     │   │
│  │  • find_related        (notas similares a una dada)   │   │
│  │  • discover_patterns   (clusters temáticos)           │   │
│  │                                                        │   │
│  │  Motor: transformers.js / Ollama / LM Studio          │   │
│  │  Vectores: 768-1024 dims (según modelo)               │   │
│  │  Índice: hnswlib-node (dimensiones dinámicas)         │   │
│  └────────────┬──────────────────────────────────────────┘   │
│               │                                               │
│  ┌────────────▼──────────────────────────────────────────┐   │
│  │            Auto-Indexing Layer                          │   │
│  │                                                        │   │
│  │  • Monitorea ZMODIFICATIONDATE en SQLite               │   │
│  │  • Polling cada N segundos (configurable)              │   │
│  │  • Re-indexa solo notas nuevas/modificadas             │   │
│  │  • Actualiza vector index incrementalmente             │   │
│  │  • Log de cambios detectados                           │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 2.2 Stack Tecnológico

| Componente | Tecnología | Justificación |
|---|---|---|
| Runtime | Node.js >= 18 | Hereda del proyecto base. Ecosistema MCP maduro. |
| MCP SDK | `@modelcontextprotocol/sdk` | SDK oficial de Anthropic |
| SQLite | `better-sqlite3` | Sincrónico, rápido, sin dependencia de binarios nativos problemáticos |
| Embeddings | Motor pluggable: `transformers.js` / `ollama` / `lmstudio` | Arquitectura de providers intercambiables (ver §2.4) |
| Vector Index | `hnswlib-node` o archivos planos (actual) | Bajo overhead, búsqueda rápida. Dimensiones dinámicas según modelo. |
| x-callback-url | `open` (Node child_process) | Protocolo nativo Bear macOS |
| Configuración | Variables de entorno + archivo `.env` | Estándar, sin complejidad extra |

### 2.3 Estructura de Archivos Propuesta

```
bear-mcp-rag-server/
├── package.json
├── .env.example
├── README.md
├── LICENSE
├── Dockerfile
├── src/
│   ├── index.js                    # Entry point del MCP server
│   ├── server.js                   # Configuración MCP, registro de tools
│   ├── config.js                   # Gestión de configuración y env vars
│   │
│   ├── db/
│   │   ├── connection.js           # Conexión SQLite (read-only)
│   │   ├── queries.js              # Todas las queries SQL parametrizadas
│   │   └── schema.js               # Constantes del schema de Bear
│   │
│   ├── bear-api/
│   │   ├── xcallback.js            # Ejecutor genérico de x-callback-url
│   │   ├── create.js               # /create
│   │   ├── add-text.js             # /add-text
│   │   ├── add-file.js             # /add-file
│   │   ├── trash.js                # /trash
│   │   ├── archive.js              # /archive
│   │   ├── rename-tag.js           # /rename-tag
│   │   ├── delete-tag.js           # /delete-tag
│   │   └── grab-url.js             # /grab-url
│   │
│   ├── rag/
│   │   ├── embeddings.js           # Interfaz abstracta + factory de providers
│   │   ├── providers/
│   │   │   ├── transformers-provider.js  # Provider: transformers.js (in-process)
│   │   │   ├── ollama-provider.js        # Provider: Ollama HTTP API
│   │   │   ├── lmstudio-provider.js      # Provider: LM Studio HTTP API
│   │   │   └── openai-compat-provider.js # Provider: cualquier API OpenAI-compatible
│   │   ├── index-manager.js        # CRUD del vector index (dimensiones dinámicas)
│   │   ├── semantic-search.js      # Búsqueda por similitud coseno
│   │   ├── chunking.js             # Estrategia de chunking adaptativa al modelo
│   │   └── patterns.js             # Descubrimiento de clusters/patrones
│   │
│   ├── indexer/
│   │   ├── auto-indexer.js         # Loop de polling + detección de cambios
│   │   ├── incremental.js          # Lógica de indexado incremental
│   │   └── full-reindex.js         # Reindexado completo (comando manual)
│   │
│   ├── tools/                      # Definición de cada MCP tool
│   │   ├── read-tools.js           # Tools de lectura (SQLite)
│   │   ├── write-tools.js          # Tools de escritura (x-callback-url)
│   │   ├── rag-tools.js            # Tools semánticos/RAG
│   │   └── admin-tools.js          # Tools administrativos (reindex, stats)
│   │
│   └── utils/
│       ├── logger.js               # Logging estructurado
│       ├── markdown.js             # Parsing/limpieza de markdown Bear
│       └── text-processing.js      # Normalización de texto para embeddings
│
├── data/                           # Generado automáticamente
│   ├── note_vectors.index          # Índice de vectores
│   ├── note_vectors.json           # Mapeo ID → metadata
│   └── index_state.json            # Estado del indexador (timestamps, checksums)
│
├── scripts/
│   ├── full-reindex.js             # Script CLI para reindexado completo
│   └── explore-db.js               # Herramienta de exploración de BD (heredada)
│
└── tests/
    ├── db.test.js
    ├── rag.test.js
    ├── xcallback.test.js
    └── indexer.test.js
```

---

### 2.4 Arquitectura de Embedding Providers

El sistema de embeddings es **pluggable**: el usuario elige qué motor y modelo usar mediante configuración, sin cambiar código. Esto permite escalar desde un modelo ligero en-proceso hasta modelos pesados corriendo en LM Studio u Ollama.

#### 2.4.1 Interfaz Abstracta

Todos los providers implementan la misma interfaz:

```javascript
// src/rag/embeddings.js
class EmbeddingProvider {
  /** Nombre del provider para logs y diagnóstico */
  get name() {}

  /** Dimensionalidad del vector de salida */
  get dimensions() {}

  /** Máximo de tokens que acepta el modelo en un solo input */
  get maxTokens() {}

  /** Inicializar el provider (cargar modelo, verificar conexión, etc.) */
  async initialize() {}

  /** Generar embedding para un texto. Retorna Float32Array. */
  async embed(text) {}

  /** Generar embeddings para múltiples textos (batch). Retorna Float32Array[]. */
  async embedBatch(texts) {}

  /** Verificar que el backend está disponible y respondiendo */
  async healthCheck() {}

  /** Liberar recursos (modelo en memoria, conexiones HTTP) */
  async dispose() {}
}
```

#### 2.4.2 Factory Pattern

```javascript
// src/rag/embeddings.js
function createProvider(config) {
  switch (config.EMBEDDING_PROVIDER) {
    case 'transformers':
      return new TransformersProvider(config.EMBEDDING_MODEL);
    case 'ollama':
      return new OllamaProvider(config.EMBEDDING_MODEL, config.OLLAMA_BASE_URL);
    case 'lmstudio':
      return new LMStudioProvider(config.EMBEDDING_MODEL, config.LMSTUDIO_BASE_URL);
    case 'openai-compatible':
      return new OpenAICompatProvider(config.EMBEDDING_MODEL, config.OPENAI_COMPAT_BASE_URL);
    default:
      throw new Error(`Unknown embedding provider: ${config.EMBEDDING_PROVIDER}`);
  }
}
```

#### 2.4.3 Modelos Pre-configurados (Presets)

El sistema incluye **3 presets** probados y documentados, más la opción de modelo custom:

| Preset | Provider | Modelo | Parámetros | Dims | Max Tokens | RAM ~  | Idiomas | Caso de uso |
|---|---|---|---|---|---|---|---|---|
| `light` | `transformers` | `EmbeddingGemma-300M` | 308M | 768 | 2048 | ~600MB | 100+ | Rápido, in-process, sin dependencias externas |
| `medium` | `ollama` o `lmstudio` | `BGE-M3` (BAAI) | 568M | 1024 | 8192 | ~1.2GB | 100+ | Balance calidad/velocidad, búsqueda híbrida |
| `heavy` | `ollama` o `lmstudio` | `Qwen3-Embedding-4B` | 4B | 1024 | 8192 | ~8GB | 100+ | Máxima calidad, instruction-aware |
| `custom` | cualquiera | definido por el usuario | — | — | — | — | — | Cualquier modelo compatible |

**Notas por preset:**

**`light` — EmbeddingGemma-300M (Google)**
- Corre dentro del proceso Node.js vía `@xenova/transformers` (ONNX runtime). Cero dependencias externas.
- Mejor modelo sub-500M del MTEB multilingüe. Diseñado por Google para on-device RAG.
- Soporta Matryoshka Representation Learning: dims truncables a 512, 256, 128 sin reentrenar.
- Compatible con transformers.js, MLX (optimizado Apple Silicon), Ollama, LM Studio.
- Buen español. Excelente para bases de hasta ~5000 notas.

**`medium` — BGE-M3 (BAAI)**
- Requiere backend externo: Ollama (`ollama pull bge-m3`) o LM Studio.
- Triple retrieval: dense + sparse + ColBERT en una sola pasada. Permite búsqueda híbrida.
- Contexto de 8192 tokens: la mayoría de las notas entran completas sin chunking.
- Excelente en español. Basado en XLM-RoBERTa, entrenado explícitamente en 100+ idiomas.
- Licencia MIT. Estándar de facto open-source para embeddings multilingües.

**`heavy` — Qwen3-Embedding-4B (Alibaba/Qwen)**
- Requiere backend externo: Ollama (`ollama pull qwen3-embedding:4b`) o LM Studio.
- 4 mil millones de parámetros. Lidera MTEB multilingüe con 70.58 score.
- **Instruction-aware**: acepta instrucciones custom que mejoran resultados 1-5%. Ejemplo:
  ```
  Instruct: Genera embeddings para búsqueda semántica de notas personales en español sobre tecnología médica\nQuery: {texto}
  ```
- Dimensiones flexibles: 32 a 1024. Configurable por el usuario.
- Pesa ~8GB en RAM. Con 32GB en Apple Silicon corre fluido pero indexado es más lento.
- Ideal para bases grandes (>5000 notas) o cuando la calidad de retrieval es crítica.

**`custom` — Cualquier modelo**
- El usuario especifica provider + modelo + dimensiones manualmente.
- Permite usar cualquier modelo disponible en Ollama, LM Studio, o cualquier API OpenAI-compatible.
- Ejemplos: `jina/jina-embeddings-v2-base-es` (bilingüe ES-EN), `nomic-embed-text`, `mxbai-embed-large`, etc.

#### 2.4.4 Providers: Detalle de Implementación

**Provider: `transformers` (in-process)**

```javascript
// src/rag/providers/transformers-provider.js
import { pipeline } from '@xenova/transformers';

class TransformersProvider extends EmbeddingProvider {
  async initialize() {
    this.pipe = await pipeline('feature-extraction', this.modelName, {
      quantized: true  // Usa ONNX cuantizado para menor RAM
    });
  }
  async embed(text) {
    const output = await this.pipe(text, { pooling: 'mean', normalize: true });
    return output.data;  // Float32Array
  }
  async embedBatch(texts) {
    // transformers.js soporta batching nativo
    return Promise.all(texts.map(t => this.embed(t)));
  }
}
```

Ventajas: Sin dependencias externas, arranque junto con el MCP server.
Desventajas: Limitado a modelos ONNX disponibles en HuggingFace. Modelos grandes no caben.

---

**Provider: `lmstudio` (HTTP API — OpenAI-compatible)**

LM Studio expone una API compatible con OpenAI en `http://localhost:1234/v1/embeddings`.

```javascript
// src/rag/providers/lmstudio-provider.js
class LMStudioProvider extends EmbeddingProvider {
  constructor(model, baseURL = 'http://localhost:1234') {
    this.model = model;
    this.baseURL = baseURL;
  }

  async embed(text) {
    const res = await fetch(`${this.baseURL}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: text })
    });
    const data = await res.json();
    return new Float32Array(data.data[0].embedding);
  }

  async embedBatch(texts) {
    // LM Studio soporta batch nativo: input puede ser array de strings
    const res = await fetch(`${this.baseURL}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts })
    });
    const data = await res.json();
    return data.data.map(d => new Float32Array(d.embedding));
  }

  async healthCheck() {
    try {
      const res = await fetch(`${this.baseURL}/v1/models`);
      return res.ok;
    } catch { return false; }
  }
}
```

Ventajas: UI gráfica para gestionar modelos, soporte Apple Silicon nativo (MLX), fácil de usar.
Desventajas: Necesita LM Studio abierto. El modelo debe estar cargado manualmente antes de usar.

---

**Provider: `ollama` (HTTP API)**

Ollama expone API en `http://localhost:11434/api/embeddings`.

```javascript
// src/rag/providers/ollama-provider.js
class OllamaProvider extends EmbeddingProvider {
  constructor(model, baseURL = 'http://localhost:11434') {
    this.model = model;
    this.baseURL = baseURL;
  }

  async embed(text) {
    const res = await fetch(`${this.baseURL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text })
    });
    const data = await res.json();
    return new Float32Array(data.embedding);
  }

  async embedBatch(texts) {
    // Ollama no soporta batch nativo — secuencial con concurrencia limitada
    const CONCURRENCY = 4;
    const results = [];
    for (let i = 0; i < texts.length; i += CONCURRENCY) {
      const batch = texts.slice(i, i + CONCURRENCY);
      const embeddings = await Promise.all(batch.map(t => this.embed(t)));
      results.push(...embeddings);
    }
    return results;
  }

  async healthCheck() {
    try {
      const res = await fetch(`${this.baseURL}/api/tags`);
      return res.ok;
    } catch { return false; }
  }
}
```

Ventajas: Daemon automático, gestión de modelos vía CLI (`ollama pull`), amplio catálogo.
Desventajas: No tiene UI gráfica. Batch no nativo (secuencial).

---

**Provider: `openai-compatible` (genérico)**

Para cualquier otra API que siga el formato OpenAI (LocalAI, vLLM, etc.):

```javascript
// src/rag/providers/openai-compat-provider.js
class OpenAICompatProvider extends EmbeddingProvider {
  constructor(model, baseURL, apiKey = null) {
    this.model = model;
    this.baseURL = baseURL;
    this.apiKey = apiKey;
  }

  async embed(text) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseURL}/v1/embeddings`, {
      method: 'POST', headers,
      body: JSON.stringify({ model: this.model, input: text })
    });
    const data = await res.json();
    return new Float32Array(data.data[0].embedding);
  }
}
```

#### 2.4.5 Flujo de Startup con Provider

```
MCP Server arranca
        │
        ▼
Lee config (.env / env vars)
        │
        ▼
¿Preset definido? ──── Sí ──→ Cargar config del preset
        │                       (modelo, dims, max_tokens)
        No
        │
        ▼
Usar config custom del usuario
(EMBEDDING_PROVIDER + EMBEDDING_MODEL + EMBEDDING_DIMENSIONS)
        │
        ▼
createProvider(config)
        │
        ▼
provider.initialize()
        │
        ├── transformers: descargar/cargar modelo ONNX
        ├── lmstudio: verificar conexión HTTP + modelo cargado
        ├── ollama: verificar conexión HTTP + modelo disponible
        └── openai-compat: verificar conexión HTTP
        │
        ▼
provider.healthCheck()
        ├── OK → Log "Embedding provider ready: {name} ({model}, {dims}d)"
        └── FAIL → Log error + degradar a búsqueda texto-only (sin RAG)
        │
        ▼
Cargar vector index existente
        ├── ¿Dimensiones del index coinciden con el provider?
        │   ├── Sí → Continuar normalmente
        │   └── No → WARN "Dimension mismatch: index={X}d, model={Y}d. Full reindex required."
        │           → Marcar index como stale, forzar reindex en background
        │
        ▼
Iniciar auto-indexer (si habilitado)
```

#### 2.4.6 Cambio de Modelo y Re-indexado

**Importante:** Cambiar de modelo de embeddings invalida todo el índice existente porque distintos modelos producen vectores en espacios semánticos incompatibles. El sistema maneja esto así:

1. Al arrancar, compara las dimensiones del índice almacenado vs. el provider activo.
2. Si hay **mismatch de dimensiones**, marca el índice como stale y fuerza un full reindex.
3. Si las dimensiones coinciden pero el **modelo cambió** (se guarda hash del modelo en `index_state.json`), también fuerza full reindex.
4. El reindex ocurre en background sin bloquear las operaciones de lectura/escritura de Bear.
5. Durante el reindex, las búsquedas semánticas retornan resultados degradados (texto-only fallback) hasta completar.

```json
// data/index_state.json — campos nuevos
{
  "embedding_provider": "lmstudio",
  "embedding_model": "bge-m3",
  "embedding_dimensions": 1024,
  "embedding_model_hash": "sha256:abc123...",
  "...": "..."
}
```

---

## 3. Catálogo Completo de MCP Tools

### 3.1 Tools de Lectura (SQLite directo)

Estas operaciones leen directamente de la BD SQLite de Bear. No abren la app ni cambian el foco.

#### `search_notes`
Búsqueda de texto completo en notas.

```json
{
  "name": "search_notes",
  "description": "Search Bear notes by text content, with optional tag filtering and date ranges. Uses SQLite FTS for fast text matching.",
  "parameters": {
    "term": { "type": "string", "required": true, "description": "Search query" },
    "tag": { "type": "string", "required": false, "description": "Filter by tag name" },
    "limit": { "type": "number", "required": false, "default": 20, "description": "Max results" },
    "sort_by": { "type": "string", "required": false, "enum": ["relevance", "modified", "created"], "default": "relevance" },
    "exclude_trashed": { "type": "boolean", "required": false, "default": true }
  },
  "returns": "Array of { id, title, snippet, tags[], modificationDate, creationDate, pinned }"
}
```

#### `get_note`
Obtener el contenido completo de una nota por ID o título.

```json
{
  "name": "get_note",
  "description": "Retrieve full content of a specific Bear note by its unique ID or title.",
  "parameters": {
    "id": { "type": "string", "required": false, "description": "Note unique identifier (UUID)" },
    "title": { "type": "string", "required": false, "description": "Exact note title" },
    "exclude_trashed": { "type": "boolean", "required": false, "default": true }
  },
  "returns": "{ id, title, content (markdown), tags[], modificationDate, creationDate, pinned, is_trashed, word_count, has_files }"
}
```

#### `get_tags`
Listar todos los tags del sidebar.

```json
{
  "name": "get_tags",
  "description": "Return all tags currently in Bear, with note counts.",
  "parameters": {},
  "returns": "Array of { name, note_count }"
}
```

#### `open_tag`
Obtener todas las notas de un tag específico.

```json
{
  "name": "open_tag",
  "description": "List all notes belonging to one or more tags.",
  "parameters": {
    "name": { "type": "string", "required": true, "description": "Tag name or comma-separated list of tags" },
    "limit": { "type": "number", "required": false, "default": 50 }
  },
  "returns": "Array of { id, title, tags[], modificationDate, creationDate, pinned }"
}
```

#### `get_untagged`
Notas sin tags.

```json
{
  "name": "get_untagged",
  "description": "List all notes that have no tags assigned.",
  "parameters": {
    "limit": { "type": "number", "required": false, "default": 50 }
  },
  "returns": "Array of { id, title, modificationDate, creationDate }"
}
```

#### `get_todos`
Notas con todos/checkboxes.

```json
{
  "name": "get_todos",
  "description": "List all notes containing todo/checkbox items.",
  "parameters": {
    "search": { "type": "string", "required": false, "description": "Optional text filter within todo notes" },
    "limit": { "type": "number", "required": false, "default": 50 }
  },
  "returns": "Array of { id, title, tags[], modificationDate, pinned, pending_todos, completed_todos }"
}
```

#### `get_today`
Notas modificadas hoy.

```json
{
  "name": "get_today",
  "description": "List notes created or modified today.",
  "parameters": {
    "search": { "type": "string", "required": false }
  },
  "returns": "Array of { id, title, tags[], modificationDate, creationDate, pinned }"
}
```

#### `get_backlinks`
Encontrar notas que enlazan a una nota específica (via wiki-links Bear).

```json
{
  "name": "get_backlinks",
  "description": "Find all notes that contain a wiki-link ([[...]]) to the specified note.",
  "parameters": {
    "id": { "type": "string", "required": false },
    "title": { "type": "string", "required": false }
  },
  "returns": "Array of { id, title, snippet_with_link, modificationDate }"
}
```

#### `get_db_stats`
Estadísticas generales de la base de datos.

```json
{
  "name": "get_db_stats",
  "description": "Return statistics about the Bear Notes database and vector index status.",
  "parameters": {},
  "returns": "{ total_notes, trashed_notes, archived_notes, total_tags, total_files, index_status: { indexed_notes, last_indexed, pending_updates } }"
}
```

---

### 3.2 Tools de Escritura (x-callback-url)

Estas operaciones usan la API oficial de Bear vía `bear://x-callback-url/...` para respetar iCloud sync. Requieren que Bear esté abierto en macOS.

#### `create_note`
Crear una nueva nota.

```json
{
  "name": "create_note",
  "description": "Create a new note in Bear. Uses Bear's x-callback-url API to ensure iCloud sync safety.",
  "parameters": {
    "title": { "type": "string", "required": false },
    "text": { "type": "string", "required": false, "description": "Note body in markdown" },
    "tags": { "type": "string", "required": false, "description": "Comma-separated list of tags" },
    "pin": { "type": "boolean", "required": false, "default": false },
    "open_note": { "type": "boolean", "required": false, "default": false, "description": "If true, display the note in Bear's window" },
    "timestamp": { "type": "boolean", "required": false, "default": false, "description": "Prepend current date/time to text" },
    "type": { "type": "string", "required": false, "enum": ["markdown", "html"], "default": "markdown" }
  },
  "returns": "{ identifier, title }"
}
```

#### `add_text`
Agregar texto a una nota existente.

```json
{
  "name": "add_text",
  "description": "Append, prepend, or replace text in an existing Bear note.",
  "parameters": {
    "id": { "type": "string", "required": false },
    "title": { "type": "string", "required": false },
    "text": { "type": "string", "required": true },
    "mode": { "type": "string", "required": false, "enum": ["prepend", "append", "replace_all", "replace"], "default": "append" },
    "header": { "type": "string", "required": false, "description": "Target a specific header/section within the note" },
    "new_line": { "type": "boolean", "required": false, "default": true },
    "tags": { "type": "string", "required": false, "description": "Additional tags to add" },
    "timestamp": { "type": "boolean", "required": false, "default": false },
    "open_note": { "type": "boolean", "required": false, "default": false }
  },
  "returns": "{ note (updated text), title }"
}
```

#### `add_file`
Adjuntar un archivo (base64) a una nota.

```json
{
  "name": "add_file",
  "description": "Attach a file (base64 encoded) to an existing Bear note.",
  "parameters": {
    "id": { "type": "string", "required": false },
    "title": { "type": "string", "required": false },
    "file": { "type": "string", "required": true, "description": "Base64-encoded file content" },
    "filename": { "type": "string", "required": true, "description": "File name with extension (e.g., 'diagram.png')" },
    "header": { "type": "string", "required": false },
    "mode": { "type": "string", "required": false, "enum": ["prepend", "append"], "default": "append" },
    "open_note": { "type": "boolean", "required": false, "default": false }
  },
  "returns": "{ note (updated text) }"
}
```

#### `trash_note`
Mover una nota a la papelera.

```json
{
  "name": "trash_note",
  "description": "Move a Bear note to trash.",
  "parameters": {
    "id": { "type": "string", "required": true, "description": "Note unique identifier" },
    "show_window": { "type": "boolean", "required": false, "default": false }
  },
  "returns": "{ success: boolean }"
}
```

#### `archive_note`
Archivar una nota.

```json
{
  "name": "archive_note",
  "description": "Move a Bear note to the archive.",
  "parameters": {
    "id": { "type": "string", "required": true },
    "show_window": { "type": "boolean", "required": false, "default": false }
  },
  "returns": "{ success: boolean }"
}
```

#### `rename_tag`
Renombrar un tag existente.

```json
{
  "name": "rename_tag",
  "description": "Rename an existing Bear tag. Affects all notes using this tag.",
  "parameters": {
    "name": { "type": "string", "required": true, "description": "Current tag name" },
    "new_name": { "type": "string", "required": true, "description": "New tag name" }
  },
  "returns": "{ success: boolean }"
}
```

#### `delete_tag`
Eliminar un tag (no elimina las notas).

```json
{
  "name": "delete_tag",
  "description": "Delete a tag from Bear. Notes are preserved but lose this tag.",
  "parameters": {
    "name": { "type": "string", "required": true }
  },
  "returns": "{ success: boolean }"
}
```

#### `grab_url`
Capturar contenido de una URL como nueva nota.

```json
{
  "name": "grab_url",
  "description": "Create a new Bear note with the content of a web page (web clipper).",
  "parameters": {
    "url": { "type": "string", "required": true },
    "tags": { "type": "string", "required": false },
    "pin": { "type": "boolean", "required": false, "default": false }
  },
  "returns": "{ identifier, title }"
}
```

---

### 3.3 Tools Semánticos / RAG

Estas operaciones usan el índice de vectores para búsqueda por significado.

#### `semantic_search`
Búsqueda semántica pura.

```json
{
  "name": "semantic_search",
  "description": "Search Bear notes by semantic meaning using vector embeddings. Finds conceptually related notes even without keyword matches. For example, searching 'productivity systems' will find notes about GTD, Pomodoro, time blocking, etc.",
  "parameters": {
    "query": { "type": "string", "required": true, "description": "Natural language query describing what you're looking for" },
    "limit": { "type": "number", "required": false, "default": 10 },
    "min_similarity": { "type": "number", "required": false, "default": 0.3, "description": "Minimum cosine similarity threshold (0-1)" },
    "tag_filter": { "type": "string", "required": false, "description": "Optional tag to narrow results" }
  },
  "returns": "Array of { id, title, snippet, similarity_score, tags[], modificationDate }"
}
```

#### `retrieve_for_rag`
Recuperar contexto relevante formateado para RAG.

```json
{
  "name": "retrieve_for_rag",
  "description": "Retrieve notes semantically similar to a query, formatted specifically for use as context in AI responses. Returns chunked and ranked content optimized for LLM consumption.",
  "parameters": {
    "query": { "type": "string", "required": true },
    "limit": { "type": "number", "required": false, "default": 5 },
    "max_tokens": { "type": "number", "required": false, "default": 4000, "description": "Approximate max tokens of combined context to return" },
    "include_metadata": { "type": "boolean", "required": false, "default": true }
  },
  "returns": "{ context_text (combined markdown), sources: [{ id, title, similarity, snippet }], total_notes_searched }"
}
```

#### `find_related`
Encontrar notas similares a una nota específica.

```json
{
  "name": "find_related",
  "description": "Find notes that are semantically similar to a specific note. Useful for discovering connections and related content.",
  "parameters": {
    "id": { "type": "string", "required": false, "description": "Note ID to find related notes for" },
    "title": { "type": "string", "required": false, "description": "Note title to find related notes for" },
    "limit": { "type": "number", "required": false, "default": 10 },
    "min_similarity": { "type": "number", "required": false, "default": 0.4 }
  },
  "returns": "Array of { id, title, similarity_score, shared_tags[], snippet }"
}
```

#### `discover_patterns`
Descubrir clusters temáticos en las notas.

```json
{
  "name": "discover_patterns",
  "description": "Analyze the vector space of your notes to discover thematic clusters and recurring patterns. Helps identify knowledge areas and gaps.",
  "parameters": {
    "num_clusters": { "type": "number", "required": false, "default": 8, "description": "Number of thematic clusters to identify" },
    "tag_filter": { "type": "string", "required": false, "description": "Limit analysis to notes with this tag" }
  },
  "returns": "Array of { cluster_label (auto-generated), representative_notes: [{ id, title }], note_count, top_terms[] }"
}
```

---

### 3.4 Tools Administrativos

#### `reindex_all`
Forzar reindexado completo.

```json
{
  "name": "reindex_all",
  "description": "Force a complete rebuild of the semantic vector index. Use when the index seems stale or after importing many notes.",
  "parameters": {
    "confirm": { "type": "boolean", "required": true, "description": "Must be true to proceed" }
  },
  "returns": "{ notes_indexed, duration_seconds, index_size_bytes }"
}
```

#### `index_status`
Estado actual del índice y del embedding provider.

```json
{
  "name": "index_status",
  "description": "Check the current status of the vector index, auto-indexer, and embedding provider.",
  "parameters": {},
  "returns": "{ total_indexed, total_notes_in_db, pending_updates, last_full_index, last_incremental_update, auto_indexer_running, polling_interval_seconds, embedding: { provider, model, dimensions, preset, backend_status } }"
}
```

---

## 4. Bear x-callback-url API — Referencia Completa

La siguiente es la referencia oficial completa de la API que se implementará. Fuente: `bear.app/faq/x-callback-url-scheme-documentation/`

### 4.1 Formato Base
```
bear://x-callback-url/[action]?[action parameters]&[x-callback parameters]
```

Parámetros x-callback disponibles: `x-success`, `x-error`.

### 4.2 Acciones Completas

| Acción | Categoría | Requiere Token | Requiere Bear Abierto |
|---|---|---|---|
| `/open-note` | Lectura | No (Solo si `selected=yes`) | Sí |
| `/create` | Escritura | No | Sí |
| `/add-text` | Escritura | No (Solo si `selected=yes`) | Sí |
| `/add-file` | Escritura | No (Solo si `selected=yes`) | Sí |
| `/tags` | Lectura | **Sí** | Sí |
| `/open-tag` | Lectura | Opcional (para x-success data) | Sí |
| `/rename-tag` | Escritura | No | Sí |
| `/delete-tag` | Escritura | No | Sí |
| `/trash` | Escritura | No | Sí |
| `/archive` | Escritura | No | Sí |
| `/untagged` | Lectura | Opcional | Sí |
| `/todo` | Lectura | Opcional | Sí |
| `/today` | Lectura | Opcional | Sí |
| `/locked` | Lectura | No | Sí |
| `/search` | Lectura | Opcional | Sí |
| `/grab-url` | Escritura | No | Sí |

### 4.3 Decisión Arquitectónica: SQLite vs x-callback-url

| Operación | Método | Razón |
|---|---|---|
| Lectura de notas | **SQLite directo** | No abre Bear UI, más rápido, no roba foco |
| Búsqueda de texto | **SQLite directo** | FTS5 es más rápido que x-callback |
| Listar tags | **SQLite directo** | No requiere token de API |
| Lectura de metadata | **SQLite directo** | Acceso a campos que la API no expone |
| Crear nota | **x-callback-url** | Respeta iCloud sync |
| Modificar nota | **x-callback-url** | Respeta iCloud sync |
| Adjuntar archivo | **x-callback-url** | Único método que maneja archivos correctamente |
| Trash/Archive | **x-callback-url** | Operación destructiva, usar API oficial |
| Rename/Delete tag | **x-callback-url** | Afecta múltiples notas, usar API oficial |
| Grab URL | **x-callback-url** | Bear maneja el web clipping internamente |

### 4.4 Gestión del Token

El token de Bear es necesario para algunos endpoints de lectura vía x-callback-url, pero como nosotros leemos directamente de SQLite, **solo lo necesitamos para operaciones que no podemos resolver vía DB**.

Configuración:
```
BEAR_API_TOKEN=123456-654321-123456
```

Se obtiene en Bear → `Help` → `Advanced` → `API Token` → `Copy Token`.

**Importante:** El token generado en macOS no es válido para iOS y viceversa.

---

## 5. Sistema de Auto-indexado

### 5.1 Estrategia de Detección de Cambios

Bear almacena las fechas como **Core Data timestamps** (segundos desde 2001-01-01). El campo clave es `ZMODIFICATIONDATE` en la tabla `ZSFNOTE`.

```sql
-- Notas modificadas después de un timestamp dado
SELECT ZUNIQUEIDENTIFIER, ZTITLE, ZMODIFICATIONDATE, ZTEXT
FROM ZSFNOTE
WHERE ZMODIFICATIONDATE > ?
  AND ZTRASHED = 0
ORDER BY ZMODIFICATIONDATE DESC;
```

### 5.2 Flujo de Auto-indexado

```
Startup del MCP Server
        │
        ▼
Cargar index_state.json
(last_indexed_timestamp)
        │
        ▼
┌───────────────────────┐
│   Polling Loop         │◀──────────────────────┐
│   (cada N segundos)    │                        │
└───────────┬───────────┘                        │
            │                                     │
            ▼                                     │
    Query: notas con                              │
    ZMODIFICATIONDATE >                           │
    last_indexed_timestamp                        │
            │                                     │
            ▼                                     │
    ¿Hay cambios?                                 │
    ├── No ──────── sleep(N) ─────────────────────┘
    │
    └── Sí
         │
         ▼
    Para cada nota cambiada:
    1. Limpiar markdown → texto plano
    2. Generar embedding (transformers.js)
    3. Actualizar/insertar en vector index
    4. Actualizar index_state.json
         │
         ▼
    Log: "Indexed N notes (X new, Y updated)"
         │
         ▼
    sleep(N) ─────────────────────────────────────┘
```

### 5.3 Configuración del Indexador

```bash
# .env
AUTO_INDEX_ENABLED=true
AUTO_INDEX_INTERVAL_SECONDS=60      # Polling cada 60 segundos
AUTO_INDEX_ON_STARTUP=true          # Indexar cambios pendientes al arrancar
INDEX_DATA_DIR=./data               # Directorio para archivos de índice
```

### 5.4 Estado Persistente (`data/index_state.json`)

```json
{
  "last_full_index": "2026-02-27T10:30:00Z",
  "last_incremental_update": "2026-02-27T15:45:12Z",
  "last_indexed_timestamp": 793889112.456,
  "embedding_provider": "lmstudio",
  "embedding_model": "bge-m3",
  "embedding_dimensions": 1024,
  "embedding_model_hash": "sha256:abc123def456...",
  "embedding_preset": "medium",
  "indexed_notes": {
    "UUID-1234": { "checksum": "abc123", "indexed_at": "2026-02-27T15:45:12Z" },
    "UUID-5678": { "checksum": "def456", "indexed_at": "2026-02-27T14:20:00Z" }
  },
  "total_indexed": 342,
  "version": "1.1.0"
}
```

### 5.5 Detección de Notas Eliminadas

Además de notas nuevas/modificadas, el indexador debe detectar notas que fueron trashadas o eliminadas y remover sus vectores del índice:

```sql
-- Notas que están en el índice pero ahora están en trash
SELECT ZUNIQUEIDENTIFIER FROM ZSFNOTE
WHERE ZUNIQUEIDENTIFIER IN (/* IDs del índice */)
  AND ZTRASHED = 1;
```

---

## 6. Estrategia de Chunking

Las notas largas necesitan ser divididas en chunks para generar embeddings más precisos. La estrategia se adapta al modelo seleccionado.

### 6.1 Reglas de Chunking (adaptativas al modelo)

| Tamaño de nota | Modelo con max_tokens ≤ 2048 (light) | Modelo con max_tokens = 8192 (medium/heavy) |
|---|---|---|
| < 512 tokens | Un solo embedding | Un solo embedding |
| 512 - 2048 tokens | Dividir por headers (##, ###) | Un solo embedding |
| 2048 - 8192 tokens | Headers + sliding window (512t, 128 overlap) | Dividir por headers (##, ###) |
| > 8192 tokens | Headers + sliding window (512t, 128 overlap) | Headers + sliding window (2048t, 256 overlap) |

**Nota:** Con BGE-M3 o Qwen3-Embedding-4B (8192 tokens de contexto), la mayoría de las notas de Bear caben en un solo embedding sin chunking, lo que simplifica el sistema y mejora la calidad de retrieval.

### 6.2 Metadata por Chunk

Cada chunk mantiene referencia a la nota padre. Las dimensiones del vector varían según el modelo:

```json
{
  "chunk_id": "UUID-1234_chunk_0",
  "note_id": "UUID-1234",
  "note_title": "Arquitectura del Avatar Médico",
  "chunk_index": 0,
  "total_chunks": 3,
  "header_context": "## Backend Architecture",
  "vector": [0.123, -0.456, ...],  // 768d (light), 1024d (medium/heavy)
  "token_count": 487,
  "embedding_model": "bge-m3"
}
```

---

## 7. Implementación del x-callback-url Handler

### 7.1 Patrón de Ejecución en macOS

El x-callback-url de Bear se ejecuta vía el protocolo `bear://`. En Node.js, se invoca con `open`:

```javascript
// Pseudocódigo del patrón
import { exec } from 'child_process';

function callBearAPI(action, params) {
  return new Promise((resolve, reject) => {
    const queryString = new URLSearchParams(params).toString();
    const url = `bear://x-callback-url/${action}?${queryString}&show_window=no`;

    exec(`open "${url}"`, (error) => {
      if (error) reject(error);
      // Para operaciones que no necesitan respuesta
      resolve({ success: true });
    });
  });
}
```

### 7.2 Manejo de Respuestas (x-success)

Para operaciones que retornan datos (como `/create` que retorna el ID), hay dos estrategias:

**Estrategia A — Fire-and-forget + SQLite verification:**
1. Ejecutar x-callback-url
2. Esperar breve delay (500ms)
3. Verificar el resultado leyendo SQLite directamente
4. Retornar los datos desde SQLite

Esta es la estrategia preferida porque:
- No necesita montar un servidor HTTP local para recibir callbacks
- No requiere app custom registrada como URL handler
- SQLite da acceso a más datos que el x-success
- Más confiable y simple

**Estrategia B — HTTP callback server (alternativa avanzada):**
1. Levantar un servidor HTTP temporal en un puerto aleatorio
2. Registrar una URL scheme custom como x-success handler
3. Ejecutar x-callback-url con x-success apuntando al handler
4. Recibir la respuesta y cerrar el servidor

Más compleja pero da acceso directo a los datos retornados por Bear. Solo implementar si Estrategia A resulta insuficiente.

### 7.3 Parámetro `show_window`

**Importante:** Todas las operaciones de escritura deben enviar `show_window=no` por defecto para evitar que Bear robe el foco de la ventana activa. El usuario puede override esto con el parámetro `open_note=true` en los tools que lo soporten.

---

## 8. Configuración

### 8.1 Variables de Entorno

```bash
# .env.example

# === Database ===
BEAR_DATABASE_PATH=~/Library/Group Containers/9K33E3U3T4.net.shinyfrog.bear/Application Data/database.sqlite

# === Bear API ===
BEAR_API_TOKEN=           # Opcional. Solo necesario si se usan endpoints que lo requieren.

# === Auto-indexing ===
AUTO_INDEX_ENABLED=true
AUTO_INDEX_INTERVAL_SECONDS=60
AUTO_INDEX_ON_STARTUP=true

# ==============================
# === Embedding Configuration ===
# ==============================
#
# Opción 1: Usar un PRESET predefinido (recomendado)
#   EMBEDDING_PRESET=light    → EmbeddingGemma-300M vía transformers.js (768d, in-process)
#   EMBEDDING_PRESET=medium   → BGE-M3 vía LM Studio u Ollama (1024d)
#   EMBEDDING_PRESET=heavy    → Qwen3-Embedding-4B vía LM Studio u Ollama (1024d)
#
# Opción 2: Configuración CUSTOM (ignora preset)
#   EMBEDDING_PROVIDER=lmstudio|ollama|transformers|openai-compatible
#   EMBEDDING_MODEL=nombre-del-modelo
#   EMBEDDING_DIMENSIONS=1024
#
# Si se define EMBEDDING_PRESET, los valores de PROVIDER/MODEL/DIMENSIONS
# se infieren automáticamente. Si se define EMBEDDING_PROVIDER, el preset se ignora.

EMBEDDING_PRESET=medium

# --- Preset override: provider backend para presets medium/heavy ---
# Los presets medium y heavy necesitan un backend externo.
# Default: lmstudio. Cambiar a ollama si prefieres ese backend.
EMBEDDING_BACKEND=lmstudio

# --- Custom provider (solo si NO usas preset) ---
# EMBEDDING_PROVIDER=lmstudio
# EMBEDDING_MODEL=text-embedding-bge-m3
# EMBEDDING_DIMENSIONS=1024

# --- Instruction prefix (solo Qwen3-Embedding y modelos instruction-aware) ---
# Se antepone a cada texto antes de generar el embedding.
# Mejora calidad 1-5% en modelos que lo soportan. Dejar vacío para modelos sin soporte.
# EMBEDDING_INSTRUCTION=Instruct: Genera embeddings para búsqueda semántica de notas personales\nQuery:

# --- Backend URLs ---
LMSTUDIO_BASE_URL=http://localhost:1234
OLLAMA_BASE_URL=http://localhost:11434

# --- OpenAI-compatible (solo para provider openai-compatible) ---
# OPENAI_COMPAT_BASE_URL=http://localhost:8080
# OPENAI_COMPAT_API_KEY=              # Opcional

# === RAG ===
CHUNK_SIZE=512                         # Tokens por chunk (ajustado automáticamente por preset)
CHUNK_OVERLAP=128                      # Overlap entre chunks
MIN_SIMILARITY_THRESHOLD=0.3          # Umbral mínimo de similitud coseno

# === Storage ===
INDEX_DATA_DIR=./data

# === Logging ===
LOG_LEVEL=info            # debug | info | warn | error

# === Server ===
SHOW_WINDOW_DEFAULT=false # Default para show_window en x-callback-url calls
```

### 8.2 Configuración MCP para Claude Desktop

```json
{
  "mcpServers": {
    "bear": {
      "command": "node",
      "args": ["/absolute/path/to/bear-mcp-rag-server/src/index.js"],
      "env": {
        "BEAR_DATABASE_PATH": "/Users/USER/Library/Group Containers/9K33E3U3T4.net.shinyfrog.bear/Application Data/database.sqlite",
        "AUTO_INDEX_ENABLED": "true",
        "AUTO_INDEX_INTERVAL_SECONDS": "60",
        "EMBEDDING_PRESET": "medium",
        "EMBEDDING_BACKEND": "lmstudio",
        "LMSTUDIO_BASE_URL": "http://localhost:1234",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### 8.3 Configuración para Claude Code

```bash
claude mcp add-json "bear" '{
  "command": "node",
  "args": ["/absolute/path/to/bear-mcp-rag-server/src/index.js"],
  "env": {
    "BEAR_DATABASE_PATH": "/Users/USER/Library/Group Containers/9K33E3U3T4.net.shinyfrog.bear/Application Data/database.sqlite",
    "AUTO_INDEX_ENABLED": "true",
    "EMBEDDING_PRESET": "medium",
    "EMBEDDING_BACKEND": "lmstudio"
  }
}'
```

### 8.4 Ejemplos Rápidos de Configuración por Preset

**Light — Sin dependencias externas (solo Node.js):**
```bash
EMBEDDING_PRESET=light
# No necesita EMBEDDING_BACKEND, LMSTUDIO_BASE_URL ni OLLAMA_BASE_URL
# El modelo se descarga automáticamente la primera vez (~600MB)
```

**Medium — Con LM Studio (recomendado para Patricio):**
```bash
EMBEDDING_PRESET=medium
EMBEDDING_BACKEND=lmstudio
LMSTUDIO_BASE_URL=http://localhost:1234
# En LM Studio: descargar y cargar "nomic-ai/nomic-embed-text-v1.5-GGUF"
# o "BAAI/bge-m3-GGUF" desde el catálogo de modelos
```

**Heavy — Con LM Studio:**
```bash
EMBEDDING_PRESET=heavy
EMBEDDING_BACKEND=lmstudio
LMSTUDIO_BASE_URL=http://localhost:1234
EMBEDDING_INSTRUCTION=Instruct: Genera embeddings para búsqueda semántica de notas personales\nQuery:
# En LM Studio: descargar y cargar "Qwen/Qwen3-Embedding-4B-GGUF"
```

**Custom — Modelo de tu elección en LM Studio:**
```bash
EMBEDDING_PROVIDER=lmstudio
EMBEDDING_MODEL=jina-embeddings-v2-base-es    # o el nombre que le ponga LM Studio
EMBEDDING_DIMENSIONS=768
LMSTUDIO_BASE_URL=http://localhost:1234
```

**Custom — Modelo de tu elección en Ollama:**
```bash
EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=jina/jina-embeddings-v2-base-es
EMBEDDING_DIMENSIONS=768
OLLAMA_BASE_URL=http://localhost:11434
# Previamente: ollama pull jina/jina-embeddings-v2-base-es
```

---

## 9. Schema de la Base de Datos de Bear

### 9.1 Tablas Principales

Tablas relevantes del SQLite de Bear (documentadas por ingeniería inversa de la comunidad):

```sql
-- Notas
ZSFNOTE:
  Z_PK                    INTEGER PRIMARY KEY
  ZUNIQUEIDENTIFIER       TEXT        -- UUID de la nota
  ZTITLE                  TEXT        -- Título
  ZTEXT                   TEXT        -- Contenido completo (markdown)
  ZSUBTITLE               TEXT        -- Subtítulo/preview
  ZCREATIONDATE           REAL        -- Core Data timestamp
  ZMODIFICATIONDATE       REAL        -- Core Data timestamp
  ZPINNED                 INTEGER     -- 0 o 1
  ZTRASHED                INTEGER     -- 0 o 1
  ZARCHIVED               INTEGER     -- 0 o 1
  ZENCRYPTED              INTEGER     -- 0 o 1
  ZHASIMAGES              INTEGER
  ZHASFILES               INTEGER
  ZLOCKED                 INTEGER
  ZTODOCOMPLETED          INTEGER     -- Todos completados
  ZTODOINCOMPLETED        INTEGER     -- Todos pendientes
  ZWORDCOUNT              INTEGER

-- Tags
ZSFNOTETAG:
  Z_PK                    INTEGER PRIMARY KEY
  ZTITLE                  TEXT        -- Nombre del tag

-- Relación Nota-Tag (many-to-many)
Z_7TAGS:
  Z_7NOTES                INTEGER     -- FK a ZSFNOTE.Z_PK
  Z_14TAGS                INTEGER     -- FK a ZSFNOTETAG.Z_PK
```

### 9.2 Conversión de Timestamps

Bear usa Core Data timestamps (segundos desde 2001-01-01):

```javascript
// Core Data timestamp → JavaScript Date
function coreDataToDate(timestamp) {
  const CORE_DATA_EPOCH = new Date('2001-01-01T00:00:00Z').getTime();
  return new Date(CORE_DATA_EPOCH + (timestamp * 1000));
}

// JavaScript Date → Core Data timestamp
function dateToCoreData(date) {
  const CORE_DATA_EPOCH = new Date('2001-01-01T00:00:00Z').getTime();
  return (date.getTime() - CORE_DATA_EPOCH) / 1000;
}
```

---

## 10. Plan de Desarrollo por Fases

### Fase 1: Fork y Fundación (1-2 días)

**Objetivo:** Fork funcional con estructura mejorada y provider architecture.

- [ ] Fork de `ruanodendaal/bear-mcp-server`
- [ ] Reestructurar en la nueva estructura de carpetas
- [ ] Migrar de `require` a ES modules
- [ ] Agregar `better-sqlite3` para queries directas
- [ ] Configurar `.env` y `config.js` con sistema de presets
- [ ] Implementar `EmbeddingProvider` interfaz abstracta + factory
- [ ] Implementar `TransformersProvider` (migrar código existente)
- [ ] Implementar `LMStudioProvider` (HTTP, OpenAI-compatible)
- [ ] Implementar `OllamaProvider` (HTTP)
- [ ] Implementar `OpenAICompatProvider` (genérico)
- [ ] Health check y detección de mismatch de dimensiones al startup
- [ ] Verificar que las 4 herramientas originales siguen funcionando
- [ ] Setup de logging con niveles

**Entregable:** Server MCP funcional con embedding provider pluggable y 3 presets (light/medium/heavy).

### Fase 2: Tools de Lectura Extendidos (2-3 días)

**Objetivo:** Todos los endpoints de lectura de Bear vía SQLite.

- [ ] `get_note` — mejorado con más metadata
- [ ] `search_notes` — con filtros por tag, fecha, sort
- [ ] `get_tags` — con conteo de notas
- [ ] `open_tag` — notas por tag
- [ ] `get_untagged`
- [ ] `get_todos` — con conteo pending/completed
- [ ] `get_today`
- [ ] `get_backlinks` — parsear wiki-links en content
- [ ] `get_db_stats`
- [ ] Tests unitarios para cada query

**Entregable:** Lectura completa de Bear sin necesidad de la x-callback-url API.

### Fase 3: Tools de Escritura (2-3 días)

**Objetivo:** Todas las operaciones de escritura vía x-callback-url.

- [ ] Implementar `xcallback.js` — ejecutor genérico
- [ ] `create_note`
- [ ] `add_text`
- [ ] `add_file`
- [ ] `trash_note`
- [ ] `archive_note`
- [ ] `rename_tag`
- [ ] `delete_tag`
- [ ] `grab_url`
- [ ] Implementar Estrategia A (fire-and-forget + SQLite verify)
- [ ] Tests de integración

**Entregable:** CRUD completo de Bear desde un solo MCP server.

### Fase 4: Auto-indexado Incremental (2-3 días)

**Objetivo:** Vectores se actualizan automáticamente.

- [ ] Implementar `auto-indexer.js` con polling loop
- [ ] Implementar `incremental.js` para indexar solo cambios
- [ ] Persistir estado en `index_state.json`
- [ ] Detectar notas trashadas y limpiar del índice
- [ ] Indexar notas nuevas al detectarlas
- [ ] Re-vectorizar notas modificadas
- [ ] Configurar intervalo de polling vía env
- [ ] Log de actividad del indexador

**Entregable:** El índice de vectores se mantiene actualizado automáticamente.

### Fase 5: RAG Avanzado (2-3 días)

**Objetivo:** Capacidades semánticas avanzadas.

- [ ] Mejorar `semantic_search` con filtros
- [ ] Implementar `find_related` (nota → notas similares)
- [ ] Implementar chunking inteligente por headers
- [ ] Implementar `discover_patterns` (clustering básico via k-means sobre vectores)
- [ ] Mejorar `retrieve_for_rag` con token budget
- [ ] Optimizar similarity threshold adaptativo

**Entregable:** Búsqueda semántica avanzada con descubrimiento de patrones.

### Fase 6: Pulido y Empaque (1-2 días)

**Objetivo:** Listo para uso diario y compartir.

- [ ] README completo con instrucciones
- [ ] `.env.example` documentado
- [ ] Dockerfile actualizado
- [ ] Script de setup one-liner
- [ ] Opción de empaque MCPB para Claude Desktop
- [ ] CI básico con GitHub Actions (lint + test)

**Entregable:** Proyecto publicable y mantenible.

---

## 11. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Bear cambia el schema de SQLite en una actualización | Media | Alto | Versionar las queries. Detectar schema version al startup. Log warnings si hay campos desconocidos. |
| x-callback-url no retorna datos confiablemente | Media | Medio | Estrategia A (verify via SQLite) elimina la dependencia de callbacks. |
| Polling constante consume CPU/batería | Baja | Medio | Intervalo configurable. Default 60s es imperceptible. Opción de deshabilitar. |
| SQLite WAL mode causa lock con Bear abierto | Baja | Alto | Abrir con `SQLITE_OPEN_READONLY`. Bear usa WAL, y SQLite permite múltiples lectores concurrentes. |
| Notas encriptadas no son accesibles | Seguro | Bajo | Documentar limitación. Excluir `ZENCRYPTED=1` de todas las queries. |
| Backend de embeddings (LM Studio/Ollama) no está corriendo | Media | Alto | Health check al startup con fallback a búsqueda texto-only. Log claro indicando que RAG está deshabilitado. Reintentar conexión periódicamente. |
| Cambio de modelo invalida índice completo | Media | Medio | Detectar mismatch de modelo/dimensiones al startup. Reindex automático en background. Fallback a texto-only durante reindex. |
| LM Studio requiere modelo cargado manualmente | Media | Bajo | Documentar claramente qué modelo cargar. Health check verifica modelo disponible y sugiere acción. |
| Modelos grandes (Qwen3-4B) ralentizan el indexado | Baja | Bajo | Indexado en background no bloquea operaciones. Concurrencia limitada para no saturar RAM. Con 32GB en Apple Silicon es manejable. |

---

## 12. Consideraciones Futuras (Post-v1.0)

Funcionalidades para considerar después del lanzamiento inicial:

- **Fine-tuning de embeddings**: Usar notas existentes para fine-tunear un modelo base (ej: EmbeddingGemma fine-tuned con corpus médico personal).
- **Remote MCP**: Exponer como HTTP/SSE server para uso desde claude.ai web via Custom Connectors.
- **MCPB packaging**: Empaquetar como extensión de Claude Desktop con un clic de instalación.
- **Knowledge graph**: Extraer entidades y relaciones entre notas para construir un grafo de conocimiento.
- **OCR de adjuntos**: Extraer texto de imágenes y PDFs adjuntos a notas para incluir en el índice.
- **MCP Resources**: Exponer notas como MCP Resources además de Tools, para mejor integración con el protocolo.
- **Webhook/SSE para cambios**: En vez de polling, usar FSEvents de macOS para detección instantánea de cambios.
- **Métricas de uso**: Tracking local de qué tools se usan más para optimizar.
- **Benchmark local**: Script que compara calidad de retrieval entre presets usando las propias notas del usuario como ground truth.
- **Hybrid search (BGE-M3)**: Aprovechar los 3 tipos de retrieval de BGE-M3 (dense + sparse + ColBERT) para búsqueda híbrida con reranking.

---

## 13. Métricas de Éxito

| Métrica | light (EmbeddingGemma) | medium (BGE-M3) | heavy (Qwen3-4B) |
|---|---|---|---|
| Tiempo de búsqueda semántica (1000 notas) | < 200ms | < 500ms | < 500ms |
| Tiempo de embedding por nota | < 50ms | < 100ms | < 300ms |
| Tiempo de indexado completo (1000 notas) | < 2 min | < 5 min | < 15 min |
| RAM del provider (modelo en memoria) | ~600MB | ~1.2GB | ~8GB |
| Overhead de CPU del auto-indexer (idle) | < 0.5% | < 0.5% | < 0.5% |

| Métrica | Target (todos los presets) |
|---|---|
| Disponibilidad de operaciones de lectura | 100% (no depende de Bear abierto) |
| Cobertura de la API Bear | 100% de las acciones documentadas |
| Degradación graceful sin embedding backend | Búsqueda texto-only funcional |
| Tiempo de detección de cambios (auto-indexer) | ≤ `AUTO_INDEX_INTERVAL_SECONDS` |

---

*Fin del PRD v1.1*
