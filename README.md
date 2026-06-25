# AIパンレジ

ローカルに置いたパン写真をTensorFlow/Kerasで学習し、Electron上のカメラ判定から会計まで行うデスクトップアプリです。

## 起動方法

```bash
npm install
npm run dev
```

Pythonワーカーは標準で `/Users/tsutsumin/miniconda3/envs/ds2026/bin/python` を使います。別のTensorFlow環境を使う場合は、起動前に `AI_BREAD_PYTHON` を指定してください。

```bash
AI_BREAD_PYTHON=/absolute/path/to/python npm run dev
```

新しい環境を作る場合は、Python 3.10 以降でTensorFlowを導入してください。

```bash
conda create -n ai-bread python=3.10 tensorflow=2.20.0
AI_BREAD_PYTHON="$HOME/miniconda3/envs/ai-bread/bin/python" npm run dev
```

pipで依存を入れる場合は次を実行します。

```bash
AI_BREAD_PYTHON="$HOME/miniconda3/envs/ai-bread/bin/python"
"$AI_BREAD_PYTHON" -m pip install -r python/requirements.txt
```

## データと学習

- 学習画像は `data/training/` に同梱済みです。クローン後は `npm install` と `npm run dev` でアプリを起動できます。
- `npm run organize-data` は、このMac上の元データフォルダから `data/training/` へ分類済みコピーを作り直すメンテナンス用コマンドです。通常のクローン後実行には不要です。
- 学習対象はブレッド、ツイスト、デニッシュ、ロール、バゲット、カンパーニュの6種類です。
- 学習済みモデル、カメラ画像、SQLite会計DBはElectronのユーザーデータ領域に保存され、Gitには含めません。
- 初回起動後、画面の「AIに学習させる」で同梱データから6種類モデルを作成します。

## 確認

```bash
npm test
npm run build
npm run test:electron
```
