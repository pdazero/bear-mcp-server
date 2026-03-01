export function createReadTools({ db, provider, indexManager, hasSemanticSearch }) {
  const tools = [
    // -- search_notes (enhanced: tag filter, sort_by, exclude_trashed) --
    {
      definition: {
        name: 'search_notes',
        description: 'Search Bear notes by text content, with optional tag filtering. Uses semantic search when available, falls back to keyword.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            tag: { type: 'string', description: 'Filter results by tag name' },
            limit: { type: 'number', description: 'Max results (default: 20)' },
            sort_by: { type: 'string', enum: ['modified', 'created'], description: 'Sort order (default: modified)' },
            semantic: { type: 'boolean', description: 'Use semantic search (default: true when available)' },
            exclude_trashed: { type: 'boolean', description: 'Exclude trashed notes (default: true)' },
          },
          required: ['query'],
        },
      },
      handler: async ({ query, tag, limit = 20, sort_by = 'modified', semantic = true, exclude_trashed = true }) => {
        const useSemantic = semantic && hasSemanticSearch && !tag;
        if (useSemantic) {
          try {
            const { semanticSearch } = await import('../rag/semantic-search.js');
            const notes = await semanticSearch(provider, indexManager, db, query, { limit });
            if (notes.length > 0) return { notes, searchMethod: 'semantic' };
          } catch { /* fall through */ }
        }
        const notes = db.searchNotesByKeyword(query, limit, { tag, sortBy: sort_by, excludeTrashed: exclude_trashed });
        return { notes, searchMethod: 'keyword' };
      },
    },

    // -- get_note (enhanced: title lookup, more metadata) --
    {
      definition: {
        name: 'get_note',
        description: 'Retrieve full content of a specific Bear note by its unique ID or title.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Note unique identifier (UUID)' },
            title: { type: 'string', description: 'Exact note title' },
          },
        },
      },
      handler: async ({ id, title }) => {
        if (!id && !title) throw new Error('Either id or title is required');
        const note = id ? db.getNoteById(id) : db.getNoteByTitle(title);
        return { note };
      },
    },

    // -- get_tags (enhanced: note counts) --
    {
      definition: {
        name: 'get_tags',
        description: 'Return all tags currently in Bear, with note counts.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => {
        const tags = db.getAllTags();
        return { tags };
      },
    },

    // -- open_tag (new) --
    {
      definition: {
        name: 'open_tag',
        description: 'List all notes belonging to a specific tag.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Tag name' },
            limit: { type: 'number', description: 'Max results (default: 50)' },
          },
          required: ['name'],
        },
      },
      handler: async ({ name, limit = 50 }) => {
        const notes = db.getNotesForTag(name, limit);
        return { notes, tag: name };
      },
    },

    // -- get_untagged (new) --
    {
      definition: {
        name: 'get_untagged',
        description: 'List all notes that have no tags assigned.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max results (default: 50)' },
          },
        },
      },
      handler: async ({ limit = 50 } = {}) => {
        const notes = db.getUntaggedNotes(limit);
        return { notes };
      },
    },

    // -- get_todos (new) --
    {
      definition: {
        name: 'get_todos',
        description: 'List all notes containing todo/checkbox items, with pending and completed counts.',
        inputSchema: {
          type: 'object',
          properties: {
            search: { type: 'string', description: 'Optional text filter within todo notes' },
            limit: { type: 'number', description: 'Max results (default: 50)' },
          },
        },
      },
      handler: async ({ search, limit = 50 } = {}) => {
        const notes = db.getTodoNotes(search, limit);
        return { notes };
      },
    },

    // -- get_today (new) --
    {
      definition: {
        name: 'get_today',
        description: 'List notes created or modified today.',
        inputSchema: {
          type: 'object',
          properties: {
            search: { type: 'string', description: 'Optional text filter' },
          },
        },
      },
      handler: async ({ search } = {}) => {
        const notes = db.getTodayNotes(search);
        return { notes };
      },
    },

    // -- get_backlinks (new) --
    {
      definition: {
        name: 'get_backlinks',
        description: 'Find all notes that contain a wiki-link ([[...]]) to the specified note.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Note UUID to find backlinks for' },
            title: { type: 'string', description: 'Note title to find backlinks for' },
          },
        },
      },
      handler: async ({ id, title }) => {
        if (!id && !title) throw new Error('Either id or title is required');
        const notes = db.getBacklinks(id, title);
        return { notes };
      },
    },

    // -- get_db_stats (new) --
    {
      definition: {
        name: 'get_db_stats',
        description: 'Return statistics about the Bear Notes database and vector index status.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => {
        const stats = db.getDbStats(indexManager);
        return { stats };
      },
    },
  ];

  // -- Semantic search tools (conditional on semantic search) --
  if (hasSemanticSearch) {
    tools.push({
      definition: {
        name: 'retrieve_for_rag',
        description: 'Retrieve notes semantically similar to a query, formatted for use as context in AI responses. Supports token budget and metadata control.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Query for which to find relevant notes' },
            limit: { type: 'number', description: 'Maximum number of notes to retrieve (default: 5)' },
            max_tokens: { type: 'number', description: 'Token budget for context text (default: 4000)' },
            include_metadata: { type: 'boolean', description: 'Include metadata headers in context (default: true)' },
          },
          required: ['query'],
        },
      },
      handler: async ({ query, limit = 5, max_tokens = 4000, include_metadata = true }) => {
        const { retrieveForRAG } = await import('../rag/semantic-search.js');
        const result = await retrieveForRAG(provider, indexManager, db, query, {
          limit, maxTokens: max_tokens, includeMetadata: include_metadata,
        });
        return { ...result, query };
      },
    });

    tools.push({
      definition: {
        name: 'semantic_search',
        description: 'Search Bear notes using semantic similarity. Returns notes ranked by relevance to the query, with optional tag filtering.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results (default: 10)' },
            min_similarity: { type: 'number', description: 'Minimum similarity threshold 0-1 (default: 0.3)' },
            tag_filter: { type: 'string', description: 'Only return notes with this tag' },
          },
          required: ['query'],
        },
      },
      handler: async ({ query, limit = 10, min_similarity = 0.3, tag_filter }) => {
        const { semanticSearch } = await import('../rag/semantic-search.js');
        const notes = await semanticSearch(provider, indexManager, db, query, {
          limit, minSimilarity: min_similarity, tagFilter: tag_filter,
        });
        return {
          notes: notes.map(n => ({
            id: n.id,
            title: n.title,
            snippet: n.content ? (n.content.replace(/^#{1,6}\s+.*$/gm, '').trim().slice(0, 200) || '') : '',
            similarity_score: n.score,
            tags: n.tags,
            modification_date: n.modification_date,
          })),
          searchMethod: 'semantic',
        };
      },
    });

    tools.push({
      definition: {
        name: 'find_related',
        description: 'Find notes semantically similar to a given note. Useful for discovering connections between notes.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Note UUID to find related notes for' },
            title: { type: 'string', description: 'Note title to find related notes for' },
            limit: { type: 'number', description: 'Max results (default: 10)' },
            min_similarity: { type: 'number', description: 'Minimum similarity threshold 0-1 (default: 0.4)' },
          },
        },
      },
      handler: async ({ id, title, limit = 10, min_similarity = 0.4 }) => {
        if (!id && !title) throw new Error('Either id or title is required');
        const { findRelated } = await import('../rag/semantic-search.js');
        const related = await findRelated(provider, indexManager, db, {
          id, title, limit, minSimilarity: min_similarity,
        });
        return { related };
      },
    });

    tools.push({
      definition: {
        name: 'discover_patterns',
        description: 'Discover thematic patterns across notes using clustering. Groups similar notes together and extracts common terms.',
        inputSchema: {
          type: 'object',
          properties: {
            num_clusters: { type: 'number', description: 'Number of clusters to create (default: 8)' },
            tag_filter: { type: 'string', description: 'Only cluster notes with this tag' },
          },
        },
      },
      handler: async ({ num_clusters = 8, tag_filter } = {}) => {
        const { discoverPatterns } = await import('../rag/semantic-search.js');
        const result = await discoverPatterns(indexManager, db, {
          numClusters: num_clusters, tagFilter: tag_filter,
        });
        return result;
      },
    });
  }

  return tools;
}
