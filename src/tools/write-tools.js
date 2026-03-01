import { callBear } from '../bear-api/xcallback.js';

export function createWriteTools() {
  return [
    // -- create_note --
    {
      definition: {
        name: 'create_note',
        description: 'Create a new note in Bear. At least title or text must be provided.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Note title' },
            text: { type: 'string', description: 'Note body (Markdown)' },
            tags: { type: 'string', description: 'Comma-separated tags' },
            pin: { type: 'boolean', description: 'Pin the note' },
            open_note: { type: 'boolean', description: 'Open the note in Bear' },
            timestamp: { type: 'boolean', description: 'Prepend timestamp' },
            type: { type: 'string', enum: ['bear', 'markdown', 'html', 'text'], description: 'Content type (default: markdown)' },
          },
        },
      },
      handler: async (params = {}) => {
        if (!params.title && !params.text) {
          throw new Error('At least title or text is required');
        }
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
            tags: { type: 'string', description: 'Comma-separated tags' },
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
