#!/bin/sh
set -e

REPO="bunnyWay/cli"
INSTALL_DIR="${BUNNY_INSTALL_DIR:-/usr/local/bin}"

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

# Determine version
if [ -n "$1" ]; then
  VERSION="$1"
else
  VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
fi

if [ -z "$VERSION" ]; then
  echo "Error: Could not determine latest version."
  exit 1
fi

BINARY="bunny-${OS}-${ARCH}"
URL="https://github.com/${REPO}/releases/download/${VERSION}/${BINARY}"

echo "Installing bunny ${VERSION} (${OS}/${ARCH})..."

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

# Install
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMPFILE" "${INSTALL_DIR}/bunny"
else
  echo "Installing to ${INSTALL_DIR} (requires sudo)..."
  sudo mv "$TMPFILE" "${INSTALL_DIR}/bunny"
fi

echo "bunny ${VERSION} installed to ${INSTALL_DIR}/bunny"
echo ""
echo "Run 'bunny --help' to get started."
