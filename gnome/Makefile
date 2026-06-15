UUID     = oneswitch@birkey.oneness
SRC      = $(UUID)
DEST     = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SCHEMAS  = /nix/store/q9ksx8c79jfj1cawwwzmpq3qapvpvab7-glib-2.88.1-dev/bin/glib-compile-schemas

.PHONY: test schemas install uninstall enable disable reload logs

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

# Reload an already-enabled extension in-place (works for code changes after
# the extension was first enabled in the current session).
reload:
	gdbus call --session \
	  --dest org.gnome.Shell.Extensions \
	  --object-path /org/gnome/Shell/Extensions \
	  --method org.gnome.Shell.Extensions.ReloadExtension \
	  "$(UUID)"

logs:
	journalctl -f -o cat /usr/bin/gnome-shell

# Note: GNOME Shell 49 on Wayland no longer supports --nested.
# New extension installs require a session restart (log out → log in).
# After restart: make enable
# For subsequent code changes: make install && make reload
