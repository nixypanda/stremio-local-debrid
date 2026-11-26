# Nix and NixOS

The flake exports `packages.<system>.default`, a runnable default app, a default
overlay, a development shell, and `nixosModules.default`. Flake outputs support
x86-64/ARM64 Linux and Apple Silicon macOS; the service module is NixOS-only.
The pinned Nixpkgs has dropped Intel macOS support.

```sh
nix develop
npm ci
npm test
nix build
STREMIO_LOCAL_DEBRID_CONFIG=/absolute/path/to/config.json nix run
```

The server accepts `STREMIO_LOCAL_DEBRID_CONFIG` for the JSON configuration path.
Without it, the existing `config.json` beside `server.mjs` remains the default.
For an immutable installation, use absolute `stateDir` and `cacheDir` paths in
your configuration. Do not run the interactive service installer against the
Nix store; use the NixOS module or your own supervisor instead.

## Consume from dotfiles

Add this repository as a flake input (after publishing these changes):

```nix
inputs.stremio-local-debrid = {
  url = "github:nixypanda/stremio-local-debrid";
  inputs.nixpkgs.follows = "nixpkgs";
};
```

To keep an existing service wrapper, replace its local `callPackage` with:

```nix
package = inputs.stremio-local-debrid.packages.${pkgs.stdenv.hostPlatform.system}.default;
```

Its executable is `${package}/bin/stremio-local-debrid`; the existing
`${package}/lib/node_modules/stremio-local-debrid/server.mjs` path also works.
No configuration patch or WebRTC stub is needed. An existing wrapper can keep
generating its private configuration and Homepage environment file unchanged.

Alternatively, import the provided module into the host's `modules` list:

```nix
inputs.stremio-local-debrid.nixosModules.default
```

Then configure the service:

```nix
services.stremio-local-debrid = {
  enable = true;
  group = "media";
  cacheDir = "/srv/media/cache/stremio-debrid";
  settings = {
    host = "127.0.0.1";
    port = 7810;
    baseUrl = "https://your-tailnet-host:9474";
    prefetchEpisodes = 1;
    sources = [{
      name = "Torrentio";
      manifestUrl = "https://torrentio.strem.fun/manifest.json";
    }];
  };
};
```

The module creates a dedicated service user, waits for state/cache mounts, and
runs a hardened systemd service. It defaults to localhost and does not open the
firewall. Configure Caddy/Tailscale separately, or set `settings.host` and
`openFirewall = true` for direct LAN access.

On first startup it generates a persistent private token in
`/var/lib/stremio-local-debrid/token`. Configuration and `addon-url.txt` /
`status-url.txt` are regenerated there with mode `0600` at each start. To retain
an existing installation, keep its state directory and token, or set `tokenFile`
to an existing runtime secret file; systemd passes it using `LoadCredential`.

**Never put secrets in `settings`.** Those values enter the publicly readable
Nix store. For credential-bearing addon URLs or a complete existing private
configuration, set `configFile = "/run/secrets/stremio-config.json"` instead.
This bypasses configuration/token/URL generation. The file must be readable by
the service user and outside `/home` (which is hidden by service hardening).
Set module `stateDir` and `cacheDir` to match the paths in that configuration.

Homepage/dashboard integration remains host-specific. Its private environment
file should still be generated at runtime, not embedded into Nix settings.

The package correctly identifies the project's MIT-PoU license as non-free under
Nixpkgs policy. The standalone flake permits its own package; if using the
overlay or `callPackage`, permit it in the consuming Nixpkgs configuration:

```nix
nixpkgs.config.allowUnfreePredicate = pkg:
  builtins.elem (lib.getName pkg) [ "stremio-local-debrid" ];
```

## Dependency policy and updates

This is a TCP BitTorrent server. uTP is already disabled by the application;
WebRTC trackers are explicitly disabled too. `package.json` overrides
`@thaunknown/simple-peer` to `9.12.1`, the compatible release that detects a
browser RTC implementation without unconditionally importing native WebRTC.
There are no rewritten dependency files or throwing RTC stubs.

The checked-in `.npmrc` skips dependency lifecycle scripts (including `ip-set`'s
tool-downloading preinstall) and optional native addons on all platforms. The
Nix package applies the same flags. WebTorrent may print an informational uTP
unavailable warning; TCP downloads and HTTP streaming are unaffected.

When updating dependencies, regenerate `package-lock.json`, run the tests, and
update `npmDepsHash` in `nix/package.nix` to the hash reported by a Nix build.
Commit both `flake.nix` and `flake.lock`. Use `nix flake check` to build the
package and evaluate generated/external-secret NixOS configurations on your
current system; normal npm tests also exercise real TCP peer
downloads, resume, and completed-cache playback.
