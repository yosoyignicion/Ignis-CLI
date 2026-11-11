#!/bin/sh
set -e

REPO="yosoyignicion/Ignis-CLI"
REF="v1.0.3"
TMP_DIR="/tmp/ignis-cli-install"

rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
curl -fsSL "https://github.com/$REPO/archive/refs/tags/$REF.tar.gz" -o "$TMP_DIR/ignis.tar.gz"
tar xzf "$TMP_DIR/ignis.tar.gz" -C "$TMP_DIR"
SRC="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d)"

mkdir -p "$HOME/.ignis-cli"
rm -rf "$HOME/.ignis-cli"
mkdir -p "$HOME/.ignis-cli"
cp -r "$SRC"/. "$HOME/.ignis-cli"/
chmod +x "$HOME/.ignis-cli/bin/ignis"
mkdir -p "$HOME/.local/bin"
ln -sf "$HOME/.ignis-cli/bin/ignis" "$HOME/.local/bin/ignis"
rm -rf "$TMP_DIR"

echo "Ignis CLI instalado. Ejecuta: ignis"
