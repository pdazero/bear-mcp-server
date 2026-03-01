import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWriteTools } from '../src/tools/write-tools.js';

const EXPECTED_TOOLS = [
  'create_note',
  'add_text',
  'add_file',
  'trash_note',
  'archive_note',
  'rename_tag',
  'delete_tag',
  'grab_url',
];

describe('createWriteTools', () => {
  const tools = createWriteTools();

  it('creates exactly 8 write tools', () => {
    assert.equal(tools.length, 8);
  });

  it('has expected tool names', () => {
    const names = tools.map(t => t.definition.name);
    assert.deepEqual(names.sort(), [...EXPECTED_TOOLS].sort());
  });

  it('each tool has definition and handler', () => {
    for (const tool of tools) {
      assert.ok(tool.definition, `tool missing definition`);
      assert.ok(tool.definition.name, `tool missing name`);
      assert.ok(tool.definition.description, `tool missing description`);
      assert.ok(tool.definition.inputSchema, `tool missing inputSchema`);
      assert.ok(typeof tool.handler === 'function', `${tool.definition.name} handler is not a function`);
    }
  });
});

describe('write tool validation', () => {
  const tools = createWriteTools();
  const toolMap = Object.fromEntries(tools.map(t => [t.definition.name, t]));

  it('create_note rejects empty note', async () => {
    await assert.rejects(
      () => toolMap.create_note.handler({}),
      { message: 'At least title or text is required' }
    );
  });

  it('add_text rejects missing text', async () => {
    await assert.rejects(
      () => toolMap.add_text.handler({ id: '123' }),
      { message: 'text is required' }
    );
  });

  it('add_text rejects missing id and title', async () => {
    await assert.rejects(
      () => toolMap.add_text.handler({ text: 'hello' }),
      { message: 'Either id or title is required' }
    );
  });

  it('add_file rejects missing file', async () => {
    await assert.rejects(
      () => toolMap.add_file.handler({ filename: 'test.png', id: '123' }),
      { message: 'file and filename are required' }
    );
  });

  it('add_file rejects missing id and title', async () => {
    await assert.rejects(
      () => toolMap.add_file.handler({ file: 'base64data', filename: 'test.png' }),
      { message: 'Either id or title is required' }
    );
  });

  it('trash_note rejects missing id', async () => {
    await assert.rejects(
      () => toolMap.trash_note.handler({}),
      { message: 'id is required' }
    );
  });

  it('archive_note rejects missing id', async () => {
    await assert.rejects(
      () => toolMap.archive_note.handler({}),
      { message: 'id is required' }
    );
  });

  it('rename_tag rejects missing name', async () => {
    await assert.rejects(
      () => toolMap.rename_tag.handler({ new_name: 'new' }),
      { message: 'name is required' }
    );
  });

  it('rename_tag rejects missing new_name', async () => {
    await assert.rejects(
      () => toolMap.rename_tag.handler({ name: 'old' }),
      { message: 'new_name is required' }
    );
  });

  it('delete_tag rejects missing name', async () => {
    await assert.rejects(
      () => toolMap.delete_tag.handler({}),
      { message: 'name is required' }
    );
  });

  it('grab_url rejects missing url', async () => {
    await assert.rejects(
      () => toolMap.grab_url.handler({}),
      { message: 'url is required' }
    );
  });
});
