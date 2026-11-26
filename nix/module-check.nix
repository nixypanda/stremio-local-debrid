{
  nixpkgs,
  module,
  pkgs,
}:
let
  evaluate =
    service:
    (nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        module
        {
          system.stateVersion = "26.05";
          fileSystems."/".device = "/dev/test-root";
          fileSystems."/".fsType = "ext4";
          boot.loader.grub.devices = [ "/dev/test-disk" ];
          services.stremio-local-debrid = {
            enable = true;
          }
          // service;
        }
      ];
    }).config;
  generated = evaluate { settings.baseUrl = "https://cache.example"; };
  credential = evaluate {
    settings.baseUrl = "https://cache.example";
    tokenFile = "/run/secrets/token";
  };
  external = evaluate { configFile = "/run/secrets/config.json"; };
  invalid = evaluate {
    settings = {
      baseUrl = "https://cache.example";
      token = "must-not-enter-store";
    };
  };
  valid = host: builtins.all (a: a.assertion) host.assertions;
in
assert valid generated;
assert valid credential;
assert valid external;
assert !(valid invalid);
assert
  generated.systemd.services.stremio-local-debrid.environment.STREMIO_LOCAL_DEBRID_CONFIG
  == "/var/lib/stremio-local-debrid/config.json";
assert
  credential.systemd.services.stremio-local-debrid.serviceConfig.LoadCredential
  == [ "token:/run/secrets/token" ];
assert external.systemd.services.stremio-local-debrid.preStart == "";
assert
  external.systemd.services.stremio-local-debrid.environment.STREMIO_LOCAL_DEBRID_CONFIG
  == "/run/secrets/config.json";
pkgs.runCommand "stremio-local-debrid-module-check" { } ''
  touch "$out"
''
