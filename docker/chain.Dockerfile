# Oiko local chain: NEAR sandbox + all Oiko contracts, deployed by contracts/tests/src/bin/devnet.rs.
FROM rust:1.93-bookworm AS build
# apt: retries + IPv4 so a DNS blip reaching the package mirrors does not fail the build (CI flake).
RUN printf 'Acquire::Retries "5";\nAcquire::ForceIPv4 "true";\n' > /etc/apt/apt.conf.d/80-ci-retries \
 && for i in 1 2 3 4 5; do \
      (apt-get update && apt-get install -y --no-install-recommends python3) && break; \
      [ "$i" = 5 ] && exit 1; echo "apt attempt $i failed, retrying"; sleep $((i * 10)); \
    done \
 && rm -rf /var/lib/apt/lists/*
RUN curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/download/cargo-near-v0.22.0/cargo-near-installer.sh | sh
WORKDIR /src
# Toolchain from contracts/rust-toolchain.toml (+ wasm target) in its own layer, so contract edits don't re-download it.
COPY contracts/rust-toolchain.toml contracts/rust-toolchain.toml
RUN cd contracts && rustup toolchain install && rustup show active-toolchain
COPY contracts contracts
COPY scripts/build-contracts.sh scripts/build-contracts.sh
# Contracts -> contracts/res/*.wasm, then the devnet launcher (its build downloads the near-sandbox binary).
RUN bash scripts/build-contracts.sh \
 && cd contracts && cargo build --release -p oiko-tests --bin devnet \
 && mkdir -p /out/res \
 && cp target/release/devnet /out/devnet \
 && cp "$(find target/release/build -path '*near-sandbox*/out/.near/*' -name near-sandbox -type f | head -1)" /out/near-sandbox \
 && cp res/*.wasm /out/res/

# near-sandbox 2.13 needs glibc >= 2.39 (bookworm has 2.36).
FROM ubuntu:24.04
# apt: retries + IPv4 so a DNS blip reaching the package mirrors does not fail the build (CI flake).
RUN printf 'Acquire::Retries "5";\nAcquire::ForceIPv4 "true";\n' > /etc/apt/apt.conf.d/80-ci-retries \
 && for i in 1 2 3 4 5; do \
      (apt-get update && apt-get install -y --no-install-recommends ca-certificates curl) && break; \
      [ "$i" = 5 ] && exit 1; echo "apt attempt $i failed, retrying"; sleep $((i * 10)); \
    done \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/ /app/
ENV NEAR_SANDBOX_BIN_PATH=/app/near-sandbox \
    OIKO_RES_DIR=/app/res \
    OIKO_STATE_DIR=/state \
    DEVNET_HOST=0.0.0.0 \
    DEVNET_PORT=3030 \
    DEVNET_PUBLIC_URL=http://localhost:3030
EXPOSE 3030
HEALTHCHECK --interval=2s --timeout=3s --start-period=10s --retries=60 CMD test -f /state/ready
CMD ["/app/devnet"]
