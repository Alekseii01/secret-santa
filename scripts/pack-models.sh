#!/usr/bin/env bash
# Пакует нужные модели Kenney в один сжатый файл web/src/assets/pack.bin
# (merge → dedup → prune → meshopt). Vite кладёт его в /assets/ с хешем в имени,
# а расширение .bin CDN кэширует на своих серверах.
set -euo pipefail
cd "$(dirname "$0")/.."
NAMES=(present-a-cube present-a-rectangle present-b-cube present-b-round present-a-round
  tree-decorated-snow tree-snow-a tree-snow-b tree-snow-c reindeer sled-long candy-cane-red candy-cane-green
  sock-red sock-green sock-red-cane sock-green-cane lantern lights-colored snowman-hat snow-pile rocks-medium
  wreath-decorated gingerbread-man)
TMP=$(mktemp -d)
FILES=()
for n in "${NAMES[@]}"; do FILES+=("models-src/$n.glb"); done
npx gltf-transform merge "${FILES[@]}" "$TMP/merged.glb" >/dev/null
npx gltf-transform dedup "$TMP/merged.glb" "$TMP/dedup.glb" >/dev/null
npx gltf-transform prune "$TMP/dedup.glb" "$TMP/pruned.glb" >/dev/null
npx gltf-transform meshopt "$TMP/pruned.glb" "$TMP/pack.glb" >/dev/null
mkdir -p web/src/assets
cp "$TMP/pack.glb" web/src/assets/pack.bin
rm -rf "$TMP"
ls -la web/src/assets/pack.bin
