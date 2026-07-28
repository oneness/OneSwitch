import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS_NAME = 'org.gnome.SessionManager';
const OBJECT_PATH = '/org/gnome/SessionManager';
const IFACE = 'org.gnome.SessionManager';

// Flag bits accepted by org.gnome.SessionManager.Inhibit.
const INHIBIT_SUSPEND = 4;  // no automatic suspend
const INHIBIT_IDLE = 8;     // session never marked idle (no blank, no lock)

// Holds a session-manager inhibitor so the machine stays awake ("caffeine").
// The session manager hands out a cookie we must give back to release it.
// Calls are async, so `_wanted` is the desired state and every reply
// reconciles against it — rapid toggling can't strand a cookie.
export class Inhibitor {
  constructor(appId, onChanged) {
    this._appId = appId;
    this._onChanged = onChanged || (() => {});
    this._cookie = null;
    this._wanted = false;
    this._busy = false;
  }

  get active() { return this._wanted; }

  toggle() { this.setActive(!this._wanted); }

  setActive(on) {
    if (on === this._wanted) return;
    this._wanted = on;
    this._onChanged(on);
    this._reconcile();
  }

  _reconcile() {
    if (this._busy) return;  // the in-flight reply will call us again
    if (this._wanted && this._cookie === null) this._inhibit();
    else if (!this._wanted && this._cookie !== null) this._uninhibit();
  }

  _inhibit() {
    this._busy = true;
    Gio.DBus.session.call(
      BUS_NAME, OBJECT_PATH, IFACE, 'Inhibit',
      new GLib.Variant('(susu)', [
        this._appId, 0, 'OneSwitch: keep awake', INHIBIT_SUSPEND | INHIBIT_IDLE,
      ]),
      new GLib.VariantType('(u)'), Gio.DBusCallFlags.NONE, -1, null,
      (bus, res) => {
        this._busy = false;
        try {
          [this._cookie] = bus.call_finish(res).deepUnpack();
        } catch (e) {
          console.error(`OneSwitch: could not inhibit suspend: ${e}`);
          this._cookie = null;
          // Nothing is being held, so don't leave the UI claiming otherwise.
          if (this._wanted) { this._wanted = false; this._onChanged(false); }
          return;
        }
        this._reconcile();
      });
  }

  _uninhibit() {
    const cookie = this._cookie;
    this._cookie = null;
    this._busy = true;
    Gio.DBus.session.call(
      BUS_NAME, OBJECT_PATH, IFACE, 'Uninhibit',
      new GLib.Variant('(u)', [cookie]),
      null, Gio.DBusCallFlags.NONE, -1, null,
      (bus, res) => {
        this._busy = false;
        try {
          bus.call_finish(res);
        } catch (e) {
          console.error(`OneSwitch: could not release inhibitor: ${e}`);
        }
        this._reconcile();
      });
  }

  destroy() {
    this._onChanged = () => {};
    this._wanted = false;
    this._reconcile();
  }
}
