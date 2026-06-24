# AIパンレジ

ローカルに置いたパン写真をTensorFlow/Kerasで学習し、Electron上のカメラ判定から会計まで行うデスクトップアプリです。

## 起動方法

```bash
npm install
npm run organize-data
npm run verify-data
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

## データと学習

- `npm run organize-data` は元データを変更せず、`data/training/` へ分類済みのコピーを置きます。
- 学習対象はロール15枚、ツイスト15枚、カンパーニュ14枚です。カンパーニュは推奨15枚を下回るため、画面に警告を出しますが学習はできます。
- 学習済みモデル、カメラ画像、SQLite会計DBはElectronのユーザーデータ領域に保存され、Gitには含めません。
- 現在のモデルは3種類分類です。新しい種類のデータフォルダと価格を追加した後、全データで再学習してください。

## 確認

```bash
npm test
npm run build
npm run test:electron
```
