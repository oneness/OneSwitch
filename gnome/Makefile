UUID = oneswitch@birkey.oneness
SRC  = $(UUID)
DEST = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: test schemas install uninstall nested logs

test:
	node --test

schemas:
	glib-compile-schemas $(SRC)/schemas/

install: schemas
	rm -rf "$(DEST)"
	mkdir -p "$(DEST)"
	cp -r $(SRC)/. "$(DEST)/"

uninstall:
	rm -rf "$(DEST)"

# Run a throwaway nested shell with the extension available (Wayland).
nested: install
	dbus-run-session -- gnome-shell --nested --wayland

logs:
	journalctl -f -o cat /usr/bin/gnome-shell
