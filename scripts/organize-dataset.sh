#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="/Users/tsutsumin/Documents/パン　学習用データ"
TARGET_DIR="$(cd "$(dirname "$0")/.." && pwd)/data"
CAMPAGNE_SOURCE="$SOURCE_DIR/カンパーニュ"
ROLL_SOURCE="$SOURCE_DIR/ロール"
TWIST_SOURCE="$SOURCE_DIR/ツイスト"
DANISH_SOURCE="$SOURCE_DIR/デニッシュ"
BAGUETTE_SOURCE="$SOURCE_DIR/バゲット"
BREAD_SOURCE="$SOURCE_DIR/ブレッド"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "学習用データが見つかりません: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR/training/roll" "$TARGET_DIR/training/twist" \
  "$TARGET_DIR/training/campagne" "$TARGET_DIR/training/danish" \
  "$TARGET_DIR/training/baguette" "$TARGET_DIR/training/bread" \
  "$TARGET_DIR/evaluation/mixed"

copy_images() {
  local source_dir="$1"
  local target_dir="$2"

  if [[ ! -d "$source_dir" ]]; then
    echo "パン種フォルダが見つかりません: $source_dir" >&2
    exit 1
  fi

  find "$source_dir" -maxdepth 1 -type f \( \
    -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \
  \) -print0 | while IFS= read -r -d '' image; do
    cp -f "$image" "$target_dir/"
  done
}

convert_heic_images() {
  local source_dir="$1"
  local target_dir="$2"

  if [[ ! -d "$source_dir" ]]; then
    echo "パン種フォルダが見つかりません: $source_dir" >&2
    exit 1
  fi

  find "$source_dir" -maxdepth 1 -type f \( \
    -iname '*.heic' -o -iname '*.heif' \
  \) -print0 | while IFS= read -r -d '' image; do
    local base
    local filename
    base="$(basename "$image")"
    filename="${base%.*}.jpg"
    if command -v magick >/dev/null 2>&1; then
      magick "$image" -auto-orient "$target_dir/$filename"
    else
      sips -s format jpeg "$image" --out "$target_dir/$filename" >/dev/null
    fi
  done
}

copy_images "$ROLL_SOURCE" "$TARGET_DIR/training/roll"
copy_images "$TWIST_SOURCE" "$TARGET_DIR/training/twist"
copy_images "$DANISH_SOURCE" "$TARGET_DIR/training/danish"
copy_images "$BAGUETTE_SOURCE" "$TARGET_DIR/training/baguette"
copy_images "$BREAD_SOURCE" "$TARGET_DIR/training/bread"

for number in 6037 6038 6039 6040 6041 6046; do
  cp -f "$SOURCE_DIR/IMG_${number}.JPG" "$TARGET_DIR/evaluation/mixed/"
done

copy_images "$CAMPAGNE_SOURCE" "$TARGET_DIR/training/campagne"
convert_heic_images "$CAMPAGNE_SOURCE" "$TARGET_DIR/training/campagne"

echo "学習データを整理しました: $TARGET_DIR"
