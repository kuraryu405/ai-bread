#!/usr/bin/env python3
"""JSON Lines worker for local Keras training and image prediction."""

import json
import os
import sys
import traceback
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import tensorflow as tf

IMAGE_SIZE = 160
BATCH_SIZE = 8
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".gif"}
MIN_DETECTION_AREA_RATIO = 0.006
MAX_DETECTIONS = 12
model_cache = {"path": None, "model": None, "labels": None}

tf.get_logger().setLevel("ERROR")


def send(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def emit(event, **payload):
    send({"event": event, **payload})


def image_files(directory):
    return sorted(
        item
        for item in directory.iterdir()
        if item.is_file() and item.suffix.lower() in SUPPORTED_EXTENSIONS
    )


def scan_dataset(data_root):
    root = Path(data_root)
    if not root.is_dir():
        raise ValueError(f"学習データディレクトリが見つかりません: {root}")

    classes = []
    unsupported = []
    for directory in sorted(item for item in root.iterdir() if item.is_dir()):
        files = image_files(directory)
        invalid = sorted(
            item.name
            for item in directory.iterdir()
            if item.is_file() and item.suffix.lower() not in SUPPORTED_EXTENSIONS
        )
        classes.append(
            {
                "id": directory.name,
                "count": len(files),
                "recommendedCount": 15,
                "warning": None if len(files) >= 15 else "推奨枚数 15 枚未満です",
            }
        )
        unsupported.extend(f"{directory.name}/{name}" for name in invalid)

    return {"classes": classes, "unsupportedFiles": unsupported}


def read_metadata(metadata_path):
    path = Path(metadata_path)
    if not path.is_file():
        return None
    with path.open(encoding="utf-8") as file:
        return json.load(file)


def status(request):
    dataset = scan_dataset(request["dataRoot"])
    metadata = read_metadata(request["metadataPath"])
    model_path = Path(request["modelPath"])
    return {
        **dataset,
        "model": {
            "available": model_path.is_file() and metadata is not None,
            "metadata": metadata,
        },
    }


class TrainingProgress(tf.keras.callbacks.Callback):
    def __init__(self, epochs):
        super().__init__()
        self.epochs = epochs

    def on_epoch_end(self, epoch, logs=None):
        logs = logs or {}
        emit(
            "progress",
            currentEpoch=epoch + 1,
            totalEpochs=self.epochs,
            accuracy=float(logs.get("accuracy", 0)),
            validationAccuracy=float(logs.get("val_accuracy", 0)),
            loss=float(logs.get("loss", 0)),
        )


def train(request):
    dataset_info = scan_dataset(request["dataRoot"])
    classes = dataset_info["classes"]
    if len(classes) < 2:
        raise ValueError("学習には2種類以上のパン画像が必要です。")
    empty_classes = [item["id"] for item in classes if item["count"] == 0]
    if empty_classes:
        raise ValueError(f"画像がないパン種があります: {', '.join(empty_classes)}")

    data_root = request["dataRoot"]
    epochs = int(request.get("epochs", 15))
    tf.keras.backend.clear_session()
    tf.keras.utils.set_random_seed(123)
    emit("log", message="画像を読み込んでいます…")

    train_ds = tf.keras.utils.image_dataset_from_directory(
        data_root,
        validation_split=0.2,
        subset="training",
        seed=123,
        image_size=(IMAGE_SIZE, IMAGE_SIZE),
        batch_size=BATCH_SIZE,
    )
    validation_ds = tf.keras.utils.image_dataset_from_directory(
        data_root,
        validation_split=0.2,
        subset="validation",
        seed=123,
        image_size=(IMAGE_SIZE, IMAGE_SIZE),
        batch_size=BATCH_SIZE,
    )
    class_names = train_ds.class_names

    autotune = tf.data.AUTOTUNE
    train_ds = train_ds.prefetch(autotune)
    validation_ds = validation_ds.prefetch(autotune)
    augmentation = tf.keras.Sequential(
        [
            tf.keras.layers.RandomFlip("horizontal"),
            tf.keras.layers.RandomRotation(0.1),
            tf.keras.layers.RandomZoom(0.1),
        ],
        name="augmentation",
    )

    emit("log", message="MobileNetV2 を読み込んでいます…")
    base_model = tf.keras.applications.MobileNetV2(
        input_shape=(IMAGE_SIZE, IMAGE_SIZE, 3), include_top=False, weights="imagenet"
    )
    base_model.trainable = False
    model = tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(IMAGE_SIZE, IMAGE_SIZE, 3)),
            augmentation,
            tf.keras.layers.Rescaling(1.0 / 127.5, offset=-1),
            base_model,
            tf.keras.layers.GlobalAveragePooling2D(),
            tf.keras.layers.Dropout(0.2),
            tf.keras.layers.Dense(len(class_names), activation="softmax"),
        ],
        name="bread_classifier",
    )
    model.compile(
        optimizer="adam",
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )

    emit("log", message=f"{len(class_names)} 種類を {epochs} エポック学習します…")
    history = model.fit(
        train_ds,
        validation_data=validation_ds,
        epochs=epochs,
        verbose=0,
        callbacks=[TrainingProgress(epochs)],
    )

    model_path = Path(request["modelPath"])
    metadata_path = Path(request["metadataPath"])
    model_path.parent.mkdir(parents=True, exist_ok=True)
    model.save(model_path)
    metadata = {
        "classNames": class_names,
        "imageCounts": {item["id"]: item["count"] for item in classes},
        "epochs": epochs,
        "finalAccuracy": float(history.history["accuracy"][-1]),
        "finalValidationAccuracy": float(history.history["val_accuracy"][-1]),
    }
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    model_cache.update({"path": str(model_path), "model": model, "labels": class_names})
    emit("log", message="学習済みモデルを保存しました。")
    return {"metadata": metadata, **status(request)}


def load_model(model_path, metadata_path):
    path = str(Path(model_path))
    metadata = read_metadata(metadata_path)
    if metadata is None or not Path(path).is_file():
        raise ValueError("学習済みモデルがありません。先に学習を実行してください。")
    if model_cache["path"] != path or model_cache["model"] is None:
        emit("log", message="学習済みモデルを読み込んでいます…")
        model_cache.update(
            {
                "path": path,
                "model": tf.keras.models.load_model(path),
                "labels": metadata["classNames"],
            }
        )
    return model_cache["model"], model_cache["labels"]


def prediction_from_probabilities(labels, probabilities):
    scores = [float(value) for value in probabilities]
    top_index = max(range(len(scores)), key=scores.__getitem__)
    return {
        "label": labels[top_index],
        "confidence": scores[top_index],
        "probabilities": [
            {"label": label, "probability": probability}
            for label, probability in zip(labels, scores)
        ],
    }


def classify_array(model, labels, array):
    resized = tf.image.resize(array, (IMAGE_SIZE, IMAGE_SIZE))
    probabilities = model.predict(tf.expand_dims(resized, 0), verbose=0)[0]
    return prediction_from_probabilities(labels, probabilities)


def predict(request):
    image_path = Path(request["imagePath"])
    if not image_path.is_file():
        raise ValueError("判定用画像が見つかりません。")
    model, labels = load_model(request["modelPath"], request["metadataPath"])
    image = tf.keras.utils.load_img(image_path, target_size=(IMAGE_SIZE, IMAGE_SIZE))
    array = tf.keras.utils.img_to_array(image)
    return classify_array(model, labels, array)


def clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


def expand_box(box, image_width, image_height, ratio=0.16):
    x, y, width, height = box
    margin_x = int(width * ratio)
    margin_y = int(height * ratio)
    left = clamp(x - margin_x, 0, image_width - 1)
    top = clamp(y - margin_y, 0, image_height - 1)
    right = clamp(x + width + margin_x, left + 1, image_width)
    bottom = clamp(y + height + margin_y, top + 1, image_height)
    return (left, top, right - left, bottom - top)


def boxes_should_merge(first, second):
    ax, ay, aw, ah = first
    bx, by, bw, bh = second
    ar = ax + aw
    ab = ay + ah
    br = bx + bw
    bb = by + bh
    overlap_w = max(0, min(ar, br) - max(ax, bx))
    overlap_h = max(0, min(ab, bb) - max(ay, by))
    overlap_area = overlap_w * overlap_h
    if overlap_area == 0:
        return False
    smaller_area = min(aw * ah, bw * bh)
    return overlap_area / smaller_area > 0.35


def merge_pair(first, second):
    ax, ay, aw, ah = first
    bx, by, bw, bh = second
    left = min(ax, bx)
    top = min(ay, by)
    right = max(ax + aw, bx + bw)
    bottom = max(ay + ah, by + bh)
    return (left, top, right - left, bottom - top)


def merge_boxes(boxes):
    merged = list(boxes)
    changed = True
    while changed:
        changed = False
        next_boxes = []
        consumed = [False] * len(merged)
        for index, box in enumerate(merged):
            if consumed[index]:
                continue
            current = box
            for other_index in range(index + 1, len(merged)):
                if consumed[other_index]:
                    continue
                if boxes_should_merge(current, merged[other_index]):
                    current = merge_pair(current, merged[other_index])
                    consumed[other_index] = True
                    changed = True
            next_boxes.append(current)
        merged = next_boxes
    return merged


def detect_bread_boxes(image_path):
    try:
        import cv2
    except ImportError as error:
        raise ValueError("複数パン検出には opencv-python-headless が必要です。") from error

    bgr = cv2.imread(str(image_path))
    if bgr is None:
        raise ValueError("判定用画像を読み込めませんでした。")

    image_height, image_width = bgr.shape[:2]
    hsv = cv2.cvtColor(cv2.GaussianBlur(bgr, (7, 7), 0), cv2.COLOR_BGR2HSV)
    lower_orange = (4, 90, 90)
    upper_orange = (35, 255, 255)
    mask = cv2.inRange(hsv, lower_orange, upper_orange)

    kernel_size = max(17, int(min(image_width, image_height) * 0.02))
    if kernel_size % 2 == 0:
        kernel_size += 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=1)
    mask = cv2.dilate(mask, kernel, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)

    contours, _hierarchy = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = image_width * image_height * MIN_DETECTION_AREA_RATIO
    min_dimension = min(image_width, image_height) * 0.04
    boxes = []
    for contour in contours:
        x, y, width, height = cv2.boundingRect(contour)
        area = width * height
        aspect = min(width, height) / max(width, height)
        if area < min_area or width < min_dimension or height < min_dimension:
            continue
        if aspect < 0.2:
            continue
        boxes.append((x, y, width, height))

    boxes = merge_boxes(boxes)
    boxes = sorted(boxes, key=lambda item: item[2] * item[3], reverse=True)[:MAX_DETECTIONS]
    boxes = [expand_box(box, image_width, image_height, ratio=0.1) for box in boxes]
    boxes = sorted(boxes, key=lambda item: (item[1], item[0]))
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    return image_width, image_height, rgb, boxes


def predict_many(request):
    image_path = Path(request["imagePath"])
    if not image_path.is_file():
        raise ValueError("判定用画像が見つかりません。")

    model, labels = load_model(request["modelPath"], request["metadataPath"])
    image_width, image_height, rgb, boxes = detect_bread_boxes(image_path)
    fallback = len(boxes) == 0
    if fallback:
        boxes = [(0, 0, image_width, image_height)]

    detections = []
    for index, (x, y, width, height) in enumerate(boxes, start=1):
        crop = rgb[y : y + height, x : x + width]
        prediction = classify_array(model, labels, crop)
        detections.append(
            {
                "id": f"candidate-{index}",
                "box": {"x": x, "y": y, "width": width, "height": height},
                **prediction,
            }
        )

    return {
        "image": {"width": image_width, "height": image_height},
        "detections": detections,
        "fallback": fallback,
    }


def dispatch(request):
    action = request.get("action")
    if action == "status":
        return status(request)
    if action == "train":
        return train(request)
    if action == "predict":
        return predict(request)
    if action == "predict_many":
        return predict_many(request)
    if action == "shutdown":
        return {"stopped": True}
    raise ValueError(f"未対応の操作です: {action}")


def main():
    for line in sys.stdin:
        try:
            request = json.loads(line)
            result = dispatch(request)
            send({"id": request.get("id"), "ok": True, "result": result})
            if request.get("action") == "shutdown":
                return
        except Exception as error:  # Keep the protocol alive after a failed request.
            traceback.print_exc(file=sys.stderr)
            send({"id": request.get("id"), "ok": False, "error": str(error)})


if __name__ == "__main__":
    main()
