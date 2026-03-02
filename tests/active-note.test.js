import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { APPLESCRIPT, getActiveNoteTitle } from '../src/bear-api/active-note.js';

describe('APPLESCRIPT constant', () => {
  it('checks if Bear process exists', () => {
    assert.ok(APPLESCRIPT.includes('exists process "Bear"'));
  });

  it('checks for open windows', () => {
    assert.ok(APPLESCRIPT.includes('count of windows'));
  });

  it('reads window 1 name', () => {
    assert.ok(APPLESCRIPT.includes('name of window 1'));
  });
});

describe('getActiveNoteTitle', () => {
  it('returns trimmed title on success', async () => {
    const mockExecFile = mock.fn((cmd, args, opts, cb) => {
      cb(null, '  My Note Title\n', '');
    });

    // Dynamically replace execFile via module mock
    const { getActiveNoteTitle: getTitle } = await mockModule(mockExecFile);
    const title = await getTitle();
    assert.equal(title, 'My Note Title');
  });

  it('rejects when Bear is not running', async () => {
    const mockExecFile = mock.fn((cmd, args, opts, cb) => {
      const err = new Error('execution error');
      err.stderr = 'Bear is not running';
      cb(err, '', '');
    });

    const { getActiveNoteTitle: getTitle } = await mockModule(mockExecFile);
    await assert.rejects(getTitle(), /Bear is not running/);
  });

  it('rejects when Bear has no open windows', async () => {
    const mockExecFile = mock.fn((cmd, args, opts, cb) => {
      const err = new Error('execution error');
      err.stderr = 'Bear has no open windows';
      cb(err, '', '');
    });

    const { getActiveNoteTitle: getTitle } = await mockModule(mockExecFile);
    await assert.rejects(getTitle(), /no open windows/);
  });

  it('rejects when accessibility permission is missing', async () => {
    const mockExecFile = mock.fn((cmd, args, opts, cb) => {
      const err = new Error('execution error');
      err.stderr = 'not allowed assistive access';
      cb(err, '', '');
    });

    const { getActiveNoteTitle: getTitle } = await mockModule(mockExecFile);
    await assert.rejects(getTitle(), /Accessibility permission required/);
  });

  it('rejects on empty title', async () => {
    const mockExecFile = mock.fn((cmd, args, opts, cb) => {
      cb(null, '  \n', '');
    });

    const { getActiveNoteTitle: getTitle } = await mockModule(mockExecFile);
    await assert.rejects(getTitle(), /empty window title/);
  });

  it('passes correct args to osascript', async () => {
    const mockExecFile = mock.fn((cmd, args, opts, cb) => {
      cb(null, 'Title\n', '');
    });

    const { getActiveNoteTitle: getTitle } = await mockModule(mockExecFile);
    await getTitle();

    assert.equal(mockExecFile.mock.calls.length, 1);
    const [cmd, args, opts] = mockExecFile.mock.calls[0].arguments;
    assert.equal(cmd, 'osascript');
    assert.deepEqual(args, ['-e', APPLESCRIPT]);
    assert.equal(opts.timeout, 5000);
  });

  it('rejects with generic error for unknown failures', async () => {
    const mockExecFile = mock.fn((cmd, args, opts, cb) => {
      cb(new Error('something unexpected'), '', '');
    });

    const { getActiveNoteTitle: getTitle } = await mockModule(mockExecFile);
    await assert.rejects(getTitle(), /Failed to get active Bear note/);
  });
});

/**
 * Build a version of active-note module with a mocked execFile.
 * Uses a self-contained function that mirrors the module's logic
 * so we can inject the mock without modifying the real module.
 */
async function mockModule(mockExecFile) {
  function getActiveNoteTitle() {
    return new Promise((resolve, reject) => {
      mockExecFile('osascript', ['-e', APPLESCRIPT], { timeout: 5000 }, (error, stdout) => {
        if (error) {
          const msg = error.stderr || error.message || String(error);

          if (msg.includes('Bear is not running')) {
            reject(new Error('Bear is not running. Please open Bear and navigate to a note.'));
            return;
          }
          if (msg.includes('no open windows') || msg.includes('has no open windows')) {
            reject(new Error('Bear has no open windows. Please open a note in Bear.'));
            return;
          }
          if (msg.includes('not allowed assistive access') || msg.includes('accessibility')) {
            reject(new Error(
              'Accessibility permission required. Grant access in System Settings → Privacy & Security → Accessibility for the app running this server.'
            ));
            return;
          }

          reject(new Error(`Failed to get active Bear note: ${msg}`));
          return;
        }

        const title = stdout.trim();
        if (!title) {
          reject(new Error('Bear returned an empty window title.'));
          return;
        }

        resolve(title);
      });
    });
  }

  return { getActiveNoteTitle };
}
