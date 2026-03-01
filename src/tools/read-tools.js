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
            const notes = await semanticSearch(provider, indexManager, db, query, limit);
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

  // -- retrieve_for_rag (conditional on semantic search) --
  if (hasSemanticSearch) {
    tools.push({
      definition: {
        name: 'retrieve_for_rag',
        description: 'Retrieve notes semantically similar to a query, formatted for use as context in AI responses.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Query for which to find relevant notes' },
            limit: { type: 'number', description: 'Maximum number of notes to retrieve (default: 5)' },
          },
          required: ['query'],
        },
      },
      handler: async ({ query, limit = 5 }) => {
        const { retrieveForRAG } = await import('../rag/semantic-search.js');
        const context = await retrieveForRAG(provider, indexManager, db, query, limit);
        return { context, query };
      },
    });
  }

  return tools;
}
