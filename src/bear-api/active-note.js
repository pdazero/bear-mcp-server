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
    execFile('osascript', ['-e', APPLESCRIPT], { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        // Use stderr (actual osascript output) to detect the cause;
        // error.message contains the full script text, so matching against it
        // would falsely match our own AppleScript error strings.
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
