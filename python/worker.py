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


def predict(request):
    image_path = Path(request["imagePath"])
    if not image_path.is_file():
        raise ValueError("判定用画像が見つかりません。")
    model, labels = load_model(request["modelPath"], request["metadataPath"])
    image = tf.keras.utils.load_img(image_path, target_size=(IMAGE_SIZE, IMAGE_SIZE))
    array = tf.keras.utils.img_to_array(image)
    probabilities = model.predict(tf.expand_dims(array, 0), verbose=0)[0]
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


def dispatch(request):
    action = request.get("action")
    if action == "status":
        return status(request)
    if action == "train":
        return train(request)
    if action == "predict":
        return predict(request)
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
