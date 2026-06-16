UUID     = oneswitch@birkey.oneness
SRC      = $(UUID)
DEST     = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SCHEMAS  = /nix/store/q9ksx8c79jfj1cawwwzmpq3qapvpvab7-glib-2.88.1-dev/bin/glib-compile-schemas

HOST_JS  = $(abspath native-host/oneswitch-browser-node.js)
FF_HOST  = $(HOME)/.mozilla/native-messaging-hosts/health.oneness.oneswitch.json

.PHONY: test schemas install uninstall enable disable reload logs install-firefox

test:
	node --test

schemas:
	$(SCHEMAS) $(SRC)/schemas/

install: schemas
	rm -rf "$(DEST)"
	mkdir -p "$(DEST)"
	cp -r $(SRC)/. "$(DEST)/"

uninstall:
	rm -rf "$(DEST)"
	gnome-extensions disable $(UUID) 2>/dev/null || true

# After install + session restart, enable the extension.
enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

reload:
	gnome-extensions disable $(UUID)
	gnome-extensions enable $(UUID)

# Install the Firefox native messaging host manifest so the browser extension
# can launch oneswitch-browser.js and stream tabs to the Shell extension.
install-firefox:
	mkdir -p "$(dir $(FF_HOST))"
	sed 's|@HOST_PATH@|$(HOST_JS)|g' native-host/manifests/firefox.json.in > "$(FF_HOST)"
	@echo "Manifest written to $(FF_HOST)"
	@echo "Now load gnome/webext/ as a temporary extension in Firefox:"
	@echo "  about:debugging → This Firefox → Load Temporary Add-on → select webext/manifest.json"

logs:
	journalctl -f -o cat /usr/bin/gnome-shell

# Note: GNOME Shell 49 on Wayland no longer supports --nested.
# New extension installs require a session restart (log out → log in).
# After restart: make enable
# For subsequent code changes: make install && make reload (disable + enable)
