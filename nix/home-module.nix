{ config, lib, pkgs, oneswitch, ... }:
# `oneswitch` = { extension, host } from the flake's packages.
let
  hostPath = "${oneswitch.host}/bin/oneswitch-browser";
  hostName = "health.oneness.oneswitch";
  uuid = "oneswitch@birkey.oneness";

  chromeManifest = builtins.toJSON {
    name = hostName;
    description = "OneSwitch tab bridge";
    path = hostPath;
    type = "stdio";
    # Replace with your unpacked extension id, or use a published id.
    allowed_origins = [ "chrome-extension://CHANGE_ME_CHROME_EXT_ID/" ];
  };
  firefoxManifest = builtins.toJSON {
    name = hostName;
    description = "OneSwitch tab bridge";
    path = hostPath;
    type = "stdio";
    allowed_extensions = [ uuid ];
  };
in {
  # Install + enable the Shell extension.
  home.packages = [ oneswitch.extension oneswitch.host ];
  dconf.settings."org/gnome/shell".enabled-extensions =
    lib.mkAfter [ uuid ];

  # Optional: set the hotkey declaratively.
  dconf.settings."org/gnome/shell/extensions/oneswitch".hotkey = [ "<Control>Tab" ];

  # Native-messaging manifests for Chrome + Firefox.
  home.file.".config/google-chrome/NativeMessagingHosts/${hostName}.json".text = chromeManifest;
  home.file.".config/chromium/NativeMessagingHosts/${hostName}.json".text = chromeManifest;
  home.file.".mozilla/native-messaging-hosts/${hostName}.json".text = firefoxManifest;
}
