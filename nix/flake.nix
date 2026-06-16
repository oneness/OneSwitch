{
  description = "OneSwitch for GNOME (Wayland)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      uuid = "oneswitch@birkey.oneness";
      src = ../gnome;
    in {
      packages.${system} = {
        extension = pkgs.stdenv.mkDerivation {
          pname = "oneswitch-gnome-extension";
          version = "1.0";
          inherit src;
          nativeBuildInputs = [ pkgs.glib ];
          installPhase = ''
            dest=$out/share/gnome-shell/extensions/${uuid}
            mkdir -p $dest
            cp -r ${uuid}/. $dest/
            glib-compile-schemas $dest/schemas
          '';
        };

        host = pkgs.stdenv.mkDerivation {
          pname = "oneswitch-browser-host";
          version = "1.0";
          inherit src;
          dontBuild = true;
          nativeBuildInputs = [ pkgs.makeWrapper ];
          buildInputs = [ pkgs.gjs ];
          installPhase = ''
            mkdir -p $out/libexec/oneswitch
            cp native-host/oneswitch-browser.js native-host/framing.js $out/libexec/oneswitch/
            chmod +x $out/libexec/oneswitch/oneswitch-browser.js
            makeWrapper ${pkgs.gjs}/bin/gjs $out/bin/oneswitch-browser \
              --add-flags "-m $out/libexec/oneswitch/oneswitch-browser.js"
          '';
        };
      };

      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [ gjs nodejs glib gnome-shell zip nodePackages.eslint ];
      };
    };
}
