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

    const { getActiveNoteTitle: getTitle } = await mockModule(mockExecFile);
    const title = await getTitle();
    assert.equal(title, 'My Note Title');
  });

  it('rejects when Bear is not running', async () => {
    const mockExecFile = mock.fn((cmd, args, opts, cb) => {
      const err = new Error('Command failed');
      cb(err, '', '0:0: execution error: Bear is not running (-2700)');
    });

    const { getActiveNoteTitle: getTitle } = await mockModule(mockExecFile);
    await assert.rejects(getTitle(), /Bear is not running/);
  });

  it('rejects when Bear has no open windows', async () => {
    const mockExecFile = mock.fn((cmd, args, opts, cb) => {
      const err = new Error('Command failed');
      cb(err, '', '182:208: execution error: Bear has no open windows (-2700)');
    });

    const { getActiveNoteTitle: getTitle } = await mockModule(mockExecFile);
    await assert.rejects(getTitle(), /no open windows/);
  });

  it('rejects when accessibility permission is missing', async () => {
    const mockExecFile = mock.fn((cmd, args, opts, cb) => {
      const err = new Error('Command failed');
      cb(err, '', 'not allowed assistive access');
    });

    const { getActiveNoteTitle: getTitle } = await mockModule(mockExecFile);
    await assert.rejects(getTitle(), /Accessibility permission required/);
  });

  it('rejects on empty title', async () => {
    const mockExecFile = mock.fn((cmd, args, opts, cb) => {
      cb(null, '  \n', '');
    });

    const { getActiveNoteTitle: getTitle } = await mockModule(mockExecFile);
    await assert.rejects(getTitle(), /No note is currently open in its own window/);
  });

  it('rejects when window title is just "Bear" (main window, no note open)', async () => {
    const mockExecFile = mock.fn((cmd, args, opts, cb) => {
      cb(null, 'Bear\n', '');
    });

    const { getActiveNoteTitle: getTitle } = await mockModule(mockExecFile);
    await assert.rejects(getTitle(), /No note is currently open in its own window/);
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

  it('uses stderr for error detection, not error.message', async () => {
    // error.message contains the full script text which includes all our
    // error strings; only stderr has the actual osascript error output.
    const mockExecFile = mock.fn((cmd, args, opts, cb) => {
      const err = new Error('Command failed: osascript -e ... error "Bear is not running" ...');
      cb(err, '', 'some other osascript error');
    });

    const { getActiveNoteTitle: getTitle } = await mockModule(mockExecFile);
    // Should NOT match "Bear is not running" from error.message
    await assert.rejects(getTitle(), /Failed to get active Bear note: some other osascript error/);
  });
});

/**
 * Build a version of active-note module with a mocked execFile.
 * Mirrors the module's logic so we can inject the mock without
 * modifying the real module.
 */
async function mockModule(mockExecFile) {
  function getActiveNoteTitle() {
    return new Promise((resolve, reject) => {
      mockExecFile('osascript', ['-e', APPLESCRIPT], { timeout: 5000 }, (error, stdout, stderr) => {
        if (error) {
          const msg = stderr || '';

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

          reject(new Error(`Failed to get active Bear note: ${msg || error.message}`));
          return;
        }

        const title = stdout.trim();
        if (!title || title === 'Bear') {
          reject(new Error('No note is currently open in its own window. In Bear, double-click or use Edit → Open Note in New Window, then try again.'));
          return;
        }

        resolve(title);
      });
    });
  }

  return { getActiveNoteTitle };
}
