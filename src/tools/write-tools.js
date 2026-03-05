import { callBear } from '../bear-api/xcallback.js';

/**
 * Apply note conventions to create_note params:
 * - Prefix title with YYYYMMDDHHmm timestamp
 * - Append #_TAG context tag to body if provided
 * Mutates and returns the params object.
 */
export function prepareCreateNoteParams(params, now = new Date()) {
  const ts = String(now.getFullYear())
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0')
    + String(now.getHours()).padStart(2, '0')
    + String(now.getMinutes()).padStart(2, '0');
  params.title = params.title ? `${ts} ${params.title}` : ts;

  if (params.context_tag) {
    const tagLine = `#_${params.context_tag.toLowerCase()}`;
    params.text = params.text ? `${params.text}\n\n${tagLine}` : tagLine;
    delete params.context_tag;
  }

  return params;
}

export function createWriteTools() {
  return [
    // -- create_note --
    {
      definition: {
        name: 'create_note',
        description: 'Create a new note in Bear. A YYYYMMDDHHmm timestamp is auto-prepended to the title. Use context_tag to classify the note into one of the user\'s life domains. At least title or text must be provided.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Note title' },
            text: { type: 'string', description: 'Note body (Markdown)' },
            tags: { type: 'string', description: 'Comma-separated tags. Prefer reusing existing tags (use get_tags to check) before inventing new ones.' },
            pin: { type: 'boolean', description: 'Pin the note' },
            open_note: { type: 'boolean', description: 'Open the note in Bear' },
            type: { type: 'string', enum: ['bear', 'markdown', 'html', 'text'], description: 'Content type (default: markdown)' },
            context_tag: {
              type: 'string',
              enum: ['deilania', 'docencia', 'falp', 'startup', 'personal'],
              description: 'Context tag classifying the note into a life domain. Always set one. Values: "falp" = work at Fundación Arturo López Pérez; "deilania" = startups Deilania/Avatarmedico/Azozio; "docencia" = teaching at Universidad de los Andes; "startup" = startup ecosystem (not own startups); "personal" = personal/family/anything else.',
            },
          },
        },
      },
      handler: async (params = {}) => {
        if (!params.title && !params.text) {
          throw new Error('At least title or text is required');
        }
        prepareCreateNoteParams(params);
        return callBear('create', params);
      },
    },

    // -- add_text --
    {
      definition: {
        name: 'add_text',
        description: 'Append or prepend text to an existing Bear note.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Note unique identifier' },
            title: { type: 'string', description: 'Note title' },
            text: { type: 'string', description: 'Text to add' },
            mode: { type: 'string', enum: ['prepend', 'append', 'replace_all', 'replace'], description: 'Insert mode (default: append)' },
            header: { type: 'string', description: 'Place text under this heading' },
            new_line: { type: 'boolean', description: 'Add newline before text' },
            tags: { type: 'string', description: 'Comma-separated tags to add' },
            timestamp: { type: 'boolean', description: 'Prepend timestamp' },
            open_note: { type: 'boolean', description: 'Open the note in Bear' },
          },
          required: ['text'],
        },
      },
      handler: async (params = {}) => {
        if (!params.text) {
          throw new Error('text is required');
        }
        if (!params.id && !params.title) {
          throw new Error('Either id or title is required');
        }
        return callBear('add-text', params);
      },
    },

    // -- add_file --
    {
      definition: {
        name: 'add_file',
        description: 'Attach a file to an existing Bear note.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Note unique identifier' },
            title: { type: 'string', description: 'Note title' },
            file: { type: 'string', description: 'Base64-encoded file content' },
            filename: { type: 'string', description: 'Filename with extension' },
            header: { type: 'string', description: 'Place file under this heading' },
            mode: { type: 'string', enum: ['prepend', 'append', 'replace_all', 'replace'], description: 'Insert mode (default: append)' },
            open_note: { type: 'boolean', description: 'Open the note in Bear' },
          },
          required: ['file', 'filename'],
        },
      },
      handler: async (params = {}) => {
        if (!params.file || !params.filename) {
          throw new Error('file and filename are required');
        }
        if (!params.id && !params.title) {
          throw new Error('Either id or title is required');
        }
        return callBear('add-file', params);
      },
    },

    // -- trash_note --
    {
      definition: {
        name: 'trash_note',
        description: 'Move a Bear note to the trash.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Note unique identifier' },
            show_window: { type: 'boolean', description: 'Show Bear window' },
          },
          required: ['id'],
        },
      },
      handler: async (params = {}) => {
        if (!params.id) {
          throw new Error('id is required');
        }
        return callBear('trash', params);
      },
    },

    // -- archive_note --
    {
      definition: {
        name: 'archive_note',
        description: 'Archive a Bear note.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Note unique identifier' },
            show_window: { type: 'boolean', description: 'Show Bear window' },
          },
          required: ['id'],
        },
      },
      handler: async (params = {}) => {
        if (!params.id) {
          throw new Error('id is required');
        }
        return callBear('archive', params);
      },
    },

    // -- rename_tag --
    {
      definition: {
        name: 'rename_tag',
        description: 'Rename an existing Bear tag.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Current tag name' },
            new_name: { type: 'string', description: 'New tag name' },
          },
          required: ['name', 'new_name'],
        },
      },
      handler: async (params = {}) => {
        if (!params.name) {
          throw new Error('name is required');
        }
        if (!params.new_name) {
          throw new Error('new_name is required');
        }
        return callBear('rename-tag', params);
      },
    },

    // -- delete_tag --
    {
      definition: {
        name: 'delete_tag',
        description: 'Delete a Bear tag from all notes.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Tag name to delete' },
          },
          required: ['name'],
        },
      },
      handler: async (params = {}) => {
        if (!params.name) {
          throw new Error('name is required');
        }
        return callBear('delete-tag', params);
      },
    },

    // -- grab_url --
    {
      definition: {
        name: 'grab_url',
        description: 'Create a Bear note from a web page URL.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to grab' },
            tags: { type: 'string', description: 'Comma-separated tags. Prefer reusing existing tags (use get_tags to check) before inventing new ones.' },
            pin: { type: 'boolean', description: 'Pin the note' },
          },
          required: ['url'],
        },
      },
      handler: async (params = {}) => {
        if (!params.url) {
          throw new Error('url is required');
        }
        return callBear('grab-url', params);
      },
    },
  ];
}
