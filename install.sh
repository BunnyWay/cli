#!/bin/sh
set -e

REPO="bunnyWay/cli"
INSTALL_DIR="${BUNNY_INSTALL_DIR:-$HOME/.bunny/bin}"
BIN_NAME="bunny"

get_os() {
  case "$(uname -s)" in
    Linux*)  echo "linux" ;;
    Darwin*) echo "darwin" ;;
    *)       echo "unsupported" ;;
  esac
}

get_arch() {
  case "$(uname -m)" in
    x86_64)       echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *)            echo "unsupported" ;;
  esac
}

has_avx2() {
  case "$OS" in
    linux)  grep -qw avx2 /proc/cpuinfo 2>/dev/null ;;
    darwin) sysctl -n machdep.cpu.leaf7_features 2>/dev/null | grep -qiw avx2 ;;
    *)      return 1 ;;
  esac
}

download() {
  if command -v curl > /dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget > /dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    echo "Error: curl or wget is required."
    exit 1
  fi
}

latest_version() {
  url="https://github.com/${REPO}/releases/latest"
  resolved=""
  if command -v curl > /dev/null 2>&1; then
    resolved=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$url" 2>/dev/null) || true
  elif command -v wget > /dev/null 2>&1; then
    resolved=$(wget -S --spider "$url" 2>&1 | awk '/^ *[Ll]ocation: /{loc=$2} END{print loc}') || true
  fi
  echo "${resolved##*/}"
}

sha256() {
  if command -v sha256sum > /dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum > /dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

OS=$(get_os)
ARCH=$(get_arch)

if [ "$OS" = "unsupported" ] || [ "$ARCH" = "unsupported" ]; then
  echo "Error: Unsupported platform: $(uname -s) $(uname -m)"
  echo "Supported: linux-x64, linux-arm64, darwin-x64, darwin-arm64"
  exit 1
fi

# The default Bun-compiled binary uses AVX2; pre-Haswell (~2013) x64 CPUs lack it and crash with "Illegal instruction", so fall back to the baseline build.
VARIANT=""
if [ "$ARCH" = "x64" ] && ! has_avx2; then
  VARIANT="-baseline"
  echo "AVX2 not detected; using baseline build."
fi

BINARY="bunny-${OS}-${ARCH}${VARIANT}"

if [ -n "${1:-}" ]; then
  VERSION="$1"
else
  # Resolve `latest` once via the github.com redirect (not the rate-limited API) so the binary and SHA256SUMS come from the same release.
  VERSION=$(latest_version)
  case "$VERSION" in
    v*) ;;
    *)
      echo "Error: could not resolve the latest bunny release."
      exit 1
      ;;
  esac
fi

BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"
echo "Installing bunny ${VERSION} (${OS}/${ARCH})..."

TMPFILE=$(mktemp)
SUMSFILE=$(mktemp)
trap 'rm -f "$TMPFILE" "$SUMSFILE"' EXIT

download "${BASE_URL}/${BINARY}" "$TMPFILE"

# Releases published before checksums shipped have no SHA256SUMS, so only a mismatch is fatal.
if download "${BASE_URL}/SHA256SUMS" "$SUMSFILE" 2>/dev/null; then
  EXPECTED=$(awk -v f="$BINARY" '$2 == f { print $1 }' "$SUMSFILE")
  ACTUAL=$(sha256 "$TMPFILE")
  if [ -z "$EXPECTED" ]; then
    echo "Error: ${BINARY} is not listed in the release's SHA256SUMS."
    exit 1
  elif [ -z "$ACTUAL" ]; then
    echo "Warning: sha256sum or shasum not found; skipping checksum verification."
  elif [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "Error: checksum mismatch for ${BINARY}."
    echo "  expected: ${EXPECTED}"
    echo "  actual:   ${ACTUAL}"
    exit 1
  fi
else
  echo "Warning: could not fetch SHA256SUMS for this release; skipping checksum verification."
fi

chmod +x "$TMPFILE"

# Create install dir, falling back to sudo if needed (only relevant when
# BUNNY_INSTALL_DIR points somewhere unwritable like /usr/local/bin).
if ! mkdir -p "$INSTALL_DIR" 2>/dev/null; then
  echo "Creating ${INSTALL_DIR} (requires sudo)..."
  sudo mkdir -p "$INSTALL_DIR"
fi

# Install
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMPFILE" "${INSTALL_DIR}/${BIN_NAME}"
else
  echo "Installing to ${INSTALL_DIR} (requires sudo)..."
  sudo mv "$TMPFILE" "${INSTALL_DIR}/${BIN_NAME}"
fi

# macOS: older releases shipped an invalid signature that arm64 kills with "killed: 9", so re-sign only when it fails to verify.
if [ "$OS" = "darwin" ]; then
  xattr -d com.apple.quarantine "${INSTALL_DIR}/${BIN_NAME}" 2>/dev/null || true
  if ! codesign --verify "${INSTALL_DIR}/${BIN_NAME}" 2>/dev/null; then
    codesign --sign - --force "${INSTALL_DIR}/${BIN_NAME}" 2>/dev/null || true
  fi
fi

echo "bunny installed to ${INSTALL_DIR}/${BIN_NAME}"

# Warn if a previous install left a copy at /usr/local/bin/bunny — depending on
# PATH order, that older binary may shadow the one we just installed.
LEGACY_BIN="/usr/local/bin/bunny"
if [ "${INSTALL_DIR}/${BIN_NAME}" != "$LEGACY_BIN" ] && [ -f "$LEGACY_BIN" ]; then
  echo ""
  echo "Warning: an existing bunny binary was found at ${LEGACY_BIN}."
  echo "  Earlier versions of this installer wrote to /usr/local/bin. Depending on"
  echo "  your PATH order, that older binary may shadow the new install."
  echo "  Remove it with:  sudo rm ${LEGACY_BIN}"
fi

# PATH reminder when installing to a directory not on PATH
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo ""
    echo "${INSTALL_DIR} is not on your PATH. Add it by running:"
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    echo "and adding that line to your shell's rc file (~/.zshrc, ~/.bashrc, etc)."
    ;;
esac

echo ""
echo "Run 'bunny --help' to get started."
echo "Using AI coding tools? Run 'bunny skills install --global' so they know how to use the CLI."
