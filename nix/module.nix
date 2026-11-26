{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.stremio-local-debrid;
  json = pkgs.formats.json { };
  settingsFile = json.generate "stremio-local-debrid-settings.json" (
    cfg.settings
    // {
      inherit (cfg) stateDir cacheDir;
    }
  );
in
{
  options.services.stremio-local-debrid = {
    enable = lib.mkEnableOption "Stremio Local Debrid";
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ./package.nix { };
      description = "Stremio Local Debrid package to run.";
    };
    user = lib.mkOption {
      type = lib.types.str;
      default = "stremio";
    };
    group = lib.mkOption {
      type = lib.types.str;
      default = "stremio";
    };
    stateDir = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/stremio-local-debrid";
    };
    cacheDir = lib.mkOption {
      type = lib.types.str;
      default = "/var/cache/stremio-local-debrid";
    };
    tokenFile = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Runtime secret file containing an existing token. Null generates and preserves a token in stateDir.";
    };
    configFile = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Complete private runtime JSON configuration; overrides generated settings. Must be readable by the service user. Never use a Nix path for secrets.";
    };
    settings = lib.mkOption {
      type = json.type;
      default = { };
      description = "Public server configuration. Do not put tokens or credential-bearing source URLs here: these values enter the Nix store. Use configFile for private configuration.";
    };
    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = !(cfg.settings ? token);
        message = "Use services.stremio-local-debrid.tokenFile or configFile instead of settings.token.";
      }
      {
        assertion = cfg.configFile != null || (cfg.settings.baseUrl or "") != "";
        message = "Set services.stremio-local-debrid.settings.baseUrl to the client-facing URL.";
      }
      {
        assertion = !cfg.openFirewall || cfg.configFile == null;
        message = "With configFile, configure networking.firewall.allowedTCPPorts explicitly.";
      }
    ];
    services.stremio-local-debrid.settings = {
      host = lib.mkDefault "127.0.0.1";
      port = lib.mkDefault 7810;
      maxCacheBytes = lib.mkDefault (100 * 1024 * 1024 * 1024);
      minFreeBytes = lib.mkDefault (10 * 1024 * 1024 * 1024);
      autoDiscoverAddons = lib.mkDefault false;
      preventSleep = lib.mkDefault false;
      language = lib.mkDefault "en-US";
      sources = lib.mkDefault [ ];
    };
    users.groups.${cfg.group} = { };
    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.group;
      home = cfg.stateDir;
    };
    systemd.tmpfiles.rules = [
      "d ${cfg.stateDir} 0700 ${cfg.user} ${cfg.group} - -"
      "d ${cfg.cacheDir} 0700 ${cfg.user} ${cfg.group} - -"
    ];
    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.settings.port ];
    systemd.services.stremio-local-debrid = {
      description = "Stremio Local Debrid torrent cache";
      wantedBy = [ "multi-user.target" ];
      wants = [ "network-online.target" ];
      after = [ "network-online.target" ];
      unitConfig.RequiresMountsFor = [
        cfg.stateDir
        cfg.cacheDir
      ];
      environment = {
        HOME = cfg.stateDir;
        NODE_ENV = "production";
        STREMIO_LOCAL_DEBRID_CONFIG =
          if cfg.configFile != null then cfg.configFile else "${cfg.stateDir}/config.json";
      };
      preStart = lib.mkIf (cfg.configFile == null) ''
        ${lib.getExe pkgs.nodejs_24} ${cfg.package}/lib/node_modules/stremio-local-debrid/scripts/prepare-headless.mjs \
          ${settingsFile} ${lib.optionalString (cfg.tokenFile != null) ''"$CREDENTIALS_DIRECTORY/token"''}
      '';
      serviceConfig = {
        User = cfg.user;
        Group = cfg.group;
        ExecStart = lib.getExe cfg.package;
        Restart = "always";
        RestartSec = "10s";
        UMask = "0077";
        ReadWritePaths = [
          cfg.stateDir
          cfg.cacheDir
        ];
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        NoNewPrivileges = true;
        CapabilityBoundingSet = "";
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
          "AF_NETLINK"
          "AF_UNIX"
        ];
        SystemCallArchitectures = "native";
      }
      // lib.optionalAttrs (cfg.tokenFile != null) {
        LoadCredential = [ "token:${cfg.tokenFile}" ];
      };
    };
  };
}
