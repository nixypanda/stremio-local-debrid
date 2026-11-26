{
  description = "Stremio Local Debrid package and NixOS service";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor =
        system:
        import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };
    in
    {
      packages = forAllSystems (system: rec {
        stremio-local-debrid = (pkgsFor system).callPackage ./nix/package.nix { };
        default = stremio-local-debrid;
      });
      apps = forAllSystems (system: {
        default = {
          type = "app";
          meta.description = "Stremio Local Debrid server (set STREMIO_LOCAL_DEBRID_CONFIG)";
          program = "${self.packages.${system}.default}/bin/stremio-local-debrid";
        };
      });
      overlays.default = final: _: {
        stremio-local-debrid = final.callPackage ./nix/package.nix { };
      };
      nixosModules.default = { pkgs, lib, ... }: {
        imports = [ ./nix/module.nix ];
        services.stremio-local-debrid.package =
          lib.mkDefault
            self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      };
      devShells = forAllSystems (system: {
        default = (pkgsFor system).mkShell {
          packages = with (pkgsFor system); [
            nodejs_24
            nixfmt
          ];
        };
      });
      checks = forAllSystems (system: {
        package = self.packages.${system}.default;
        module = import ./nix/module-check.nix {
          inherit nixpkgs;
          module = self.nixosModules.default;
          pkgs = pkgsFor system;
        };
      });
      formatter = forAllSystems (system: (pkgsFor system).nixfmt);
    };
}
