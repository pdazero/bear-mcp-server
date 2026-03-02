import { execFile } from 'node:child_process';

/**
 * AppleScript to get the title of Bear's frontmost window via System Events.
 * Requires Accessibility permissions for the host process.
 */
export const APPLESCRIPT = `
tell application "System Events"
  if not (exists process "Bear") then
    error "Bear is not running"
  end if
  tell process "Bear"
    if (count of windows) is 0 then
      error "Bear has no open windows"
    end if
    return name of window 1
  end tell
end tell
`.trim();

/**
 * Get the title of the currently active note in Bear.
 * Uses osascript + System Events AXTitle (requires Accessibility permissions).
 * @returns {Promise<string>} The window title (typically the note title)
 */
export function getActiveNoteTitle() {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', APPLESCRIPT], { timeout: 5000 }, (error, stdout) => {
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
