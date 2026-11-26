{
  lib,
  buildNpmPackage,
  nodejs_24,
  makeWrapper,
}:

buildNpmPackage {
  pname = "stremio-local-debrid";
  version = (builtins.fromJSON (builtins.readFile ../package.json)).version;
  # Only ship application inputs, never local config, cache, or secret files.
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions (
      [
        ../.npmrc
        ../package.json
        ../package-lock.json
        ../LICENSE.md
        ../CREDITS.md
        ../locales
        ../public/assets
        ../scripts
        ../test
      ]
      ++ map (name: ../. + "/${name}") (
        builtins.attrNames (
          lib.filterAttrs (name: type: type == "regular" && lib.hasSuffix ".mjs" name) (builtins.readDir ../.)
        )
      )
    );
  };

  nodejs = nodejs_24;
  npmDepsHash = "sha256-WEqiUuMuzYOxDfQkJYzuX413eNnovzD8iwK1AICIEzo=";
  # Match .npmrc explicitly: npm hooks may supply their own command-line flags.
  npmFlags = [
    "--ignore-scripts"
    "--omit=optional"
  ];
  dontNpmBuild = true;
  nativeBuildInputs = [ makeWrapper ];

  postInstall = ''
    makeWrapper ${lib.getExe nodejs_24} "$out/bin/stremio-local-debrid" \
      --add-flags "$out/lib/node_modules/stremio-local-debrid/server.mjs"
  '';

  meta = {
    description = "Self-hosted Stremio torrent cache addon";
    homepage = "https://github.com/nixypanda/stremio-local-debrid";
    license = {
      fullName = "MIT License with Proof-of-Usage Condition";
      shortName = "MIT-PoU";
      url = "https://github.com/origami-ltd/stremio-local-debrid/blob/main/LICENSE.md";
      free = false;
    };
    mainProgram = "stremio-local-debrid";
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
}
