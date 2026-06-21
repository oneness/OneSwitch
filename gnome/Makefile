UUID     = oneswitch@birkey.co
SRC      = $(UUID)
DEST     = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SCHEMAS  = /nix/store/q9ksx8c79jfj1cawwwzmpq3qapvpvab7-glib-2.88.1-dev/bin/glib-compile-schemas

HOST_JS  = $(abspath native-host/oneswitch-browser-node.js)
FF_HOST  = $(HOME)/.mozilla/native-messaging-hosts/health.oneness.oneswitch.json
XPI_OUT  = $(HOME)/.local/share/oneswitch/$(UUID).xpi

.PHONY: test schemas install uninstall enable disable reload logs install-firefox xpi install-firefox-ext

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
	@echo "For a permanent extension (survives restarts), run: make install-firefox-ext"
	@echo "For a temporary session only:"
	@echo "  about:debugging → This Firefox → Load Temporary Add-on → select webext/manifest.json"

# Package the web extension as an XPI file.
xpi:
	mkdir -p "$(dir $(XPI_OUT))"
	cd webext && zip -r "$(XPI_OUT)" manifest.json background.js
	@echo "XPI packaged: $(XPI_OUT)"

# Install the extension permanently into the active Firefox profile.
# Works on Firefox Developer Edition and Firefox ESR (allows unsigned extensions).
# On standard Firefox release, signatures are enforced — use Dev Edition instead.
#
# NixOS users: use nix/home-module.nix instead — it handles this automatically
# via programs.firefox.policies.ExtensionSettings (force_installed).
install-firefox-ext: xpi
	@FF_PROFILE=$$(find "$(HOME)/.mozilla/firefox" -maxdepth 2 -name "prefs.js" 2>/dev/null \
	  | head -1 | xargs -I{} dirname {}); \
	if [ -z "$$FF_PROFILE" ]; then echo "ERROR: No Firefox profile found under ~/.mozilla/firefox"; exit 1; fi; \
	mkdir -p "$$FF_PROFILE/extensions"; \
	cp "$(XPI_OUT)" "$$FF_PROFILE/extensions/$(UUID).xpi"; \
	grep -q "xpinstall.signatures.required" "$$FF_PROFILE/user.js" 2>/dev/null \
	  || echo 'user_pref("xpinstall.signatures.required", false);' >> "$$FF_PROFILE/user.js"; \
	echo "Extension installed to $$FF_PROFILE/extensions/$(UUID).xpi"; \
	echo "Restart Firefox to activate (requires Firefox Developer Edition or ESR)."

logs:
	journalctl -f -o cat /usr/bin/gnome-shell

# Note: GNOME Shell 49 on Wayland no longer supports --nested.
# ALL code changes require a full session restart (log out → log in).
# The ES module cache is NOT cleared by disable+enable on GNOME 49 Wayland.
# Workflow: make install → log out → log in → make enable
