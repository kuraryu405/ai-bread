#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="/Users/tsutsumin/Documents/パン　学習用データ"
TARGET_DIR="$(cd "$(dirname "$0")/.." && pwd)/data"
CAMPAGNE_SOURCE="$SOURCE_DIR/カンパーニュ"
ROLL_SOURCE="$SOURCE_DIR/ロール"
TWIST_SOURCE="$SOURCE_DIR/ツイスト"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "学習用データが見つかりません: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR/training/roll" "$TARGET_DIR/training/twist" \
  "$TARGET_DIR/training/campagne" "$TARGET_DIR/evaluation/mixed"

for number in $(seq 6007 6021); do
  cp -f "$ROLL_SOURCE/IMG_${number}.JPG" "$TARGET_DIR/training/roll/"
done

for number in $(seq 6022 6036); do
  cp -f "$TWIST_SOURCE/IMG_${number}.JPG" "$TARGET_DIR/training/twist/"
done

for number in 6037 6038 6039 6040 6041 6046; do
  cp -f "$SOURCE_DIR/IMG_${number}.JPG" "$TARGET_DIR/evaluation/mixed/"
done

for image in "$CAMPAGNE_SOURCE"/*.HEIC; do
  filename="$(basename "$image" .HEIC).jpg"
  sips -s format jpeg "$image" --out "$TARGET_DIR/training/campagne/$filename" >/dev/null
done

echo "学習データを整理しました: $TARGET_DIR"
