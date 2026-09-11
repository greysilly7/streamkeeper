{
  description = "AIOStreams Keeper";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let pkgs = import nixpkgs { inherit system; };
      in {
        packages.default = pkgs.rustPlatform.buildRustPackage {
          pname = "aiostreams-keeper";
          version = "0.1.0";
          src = ./.;
          cargoLock.lockFile = ./Cargo.lock;
        };
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [ rustc cargo clippy rustfmt ];
          RUST_SRC_PATH = "${pkgs.rustPlatform.rustLibSrc}";
        };
      });

  nixosModules.default = { config, lib, pkgs, ... }:
    let cfg = config.services.aiostreams-keeper;
    in {
      options.services.aiostreams-keeper = {
        enable = lib.mkEnableOption "AIOStreams Keeper";
        package = lib.mkOption { type = lib.types.package; default = self.packages.${pkgs.system}.default; };
        manifestUrl = lib.mkOption { type = lib.types.str; description = "Primary AIOStreams manifest URL."; };
        passwordFile = lib.mkOption { type = lib.types.path; description = "EnvironmentFile containing AIOSTREAMS_PASSWORD=..."; };
        mirrors = lib.mkOption { type = lib.types.listOf lib.types.str; default = []; description = "Fallback and mirror URLs."; };
        listenAddress = lib.mkOption { type = lib.types.str; default = "127.0.0.1:3000"; };
      };
      config = lib.mkIf cfg.enable {
        systemd.services.aiostreams-keeper = {
          description = "AIOStreams Keeper resilient manifest cache";
          wantedBy = [ "multi-user.target" ];
          after = [ "network-online.target" ];
          wants = [ "network-online.target" ];
          serviceConfig = {
            ExecStart = "${cfg.package}/bin/aiostreams-keeper";
            Environment = [ "AIOSTREAMS_MANIFEST_URL=${cfg.manifestUrl}" "AIOSTREAMS_MIRRORS=${lib.concatStringsSep "," cfg.mirrors}" "LISTEN_ADDR=${cfg.listenAddress}" ];
            EnvironmentFile = cfg.passwordFile;
            DynamicUser = true;
            NoNewPrivileges = true;
            ProtectSystem = "strict";
            PrivateTmp = true;
            Restart = "on-failure";
          };
        };
      };
    };
}
