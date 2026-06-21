import Gio from 'gi://Gio';
import St from 'gi://St';

// Runs one shell command at a time via `bash -lc`. Captures stdout+stderr and
// the exit code, copies the combined output to the clipboard, and reports via
// the onDone callback. cancel() kills a running command (for Esc).
export class CommandRunner {
  constructor() { this._proc = null; }

  run(cmd, onDone) {
    this.cancel();
    let proc;
    try {
      proc = Gio.Subprocess.new(
        ['bash', '-lc', cmd],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    } catch (e) {
      onDone({ output: `failed to start: ${e}`, code: -1 });
      return;
    }
    this._proc = proc;
    proc.communicate_utf8_async(null, null, (p, res) => {
      let output, code;
      try {
        const [, stdout, stderr] = p.communicate_utf8_finish(res);
        output = (stdout || '') + (stderr || '');
        code = p.get_exit_status();
      } catch (e) {
        output = String(e);
        code = -1;
      }
      this._proc = null;
      St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, output);
      onDone({ output, code });
    });
  }

  cancel() {
    if (this._proc) {
      try { this._proc.force_exit(); } catch (_e) {}
      this._proc = null;
    }
  }
}
