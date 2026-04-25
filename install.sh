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

OS=$(get_os)
ARCH=$(get_arch)

if [ "$OS" = "unsupported" ] || [ "$ARCH" = "unsupported" ]; then
  echo "Error: Unsupported platform: $(uname -s) $(uname -m)"
  echo "Supported: linux-x64, linux-arm64, darwin-x64, darwin-arm64"
  exit 1
fi

BINARY="bunny-${OS}-${ARCH}"

# Pinned version uses the tagged release URL; otherwise use the `latest`
# redirect so we don't hit api.github.com (rate-limited to 60 req/hr).
if [ -n "${1:-}" ]; then
  VERSION="$1"
  URL="https://github.com/${REPO}/releases/download/${VERSION}/${BINARY}"
  echo "Installing bunny ${VERSION} (${OS}/${ARCH})..."
else
  URL="https://github.com/${REPO}/releases/latest/download/${BINARY}"
  echo "Installing bunny (${OS}/${ARCH})..."
fi

TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

# Download
if command -v curl > /dev/null 2>&1; then
  curl -fsSL "$URL" -o "$TMPFILE"
elif command -v wget > /dev/null 2>&1; then
  wget -qO "$TMPFILE" "$URL"
else
  echo "Error: curl or wget is required."
  exit 1
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

# macOS: clear quarantine xattr (set by curl) and ad-hoc sign so Gatekeeper
# and the Apple Silicon kernel allow execution. Without this, first run on
# darwin-arm64 fails with "killed: 9".
if [ "$OS" = "darwin" ]; then
  xattr -d com.apple.quarantine "${INSTALL_DIR}/${BIN_NAME}" 2>/dev/null || true
  codesign --sign - --force "${INSTALL_DIR}/${BIN_NAME}" 2>/dev/null || true
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
