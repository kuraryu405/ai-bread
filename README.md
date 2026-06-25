# AIパンレジ

ローカルに置いたパン写真をTensorFlow/Kerasで学習し、Electron上のカメラ判定から会計まで行うデスクトップアプリです。

## クローンして起動するコマンド

Node.js/npm と Miniconda または Anaconda が入っているMacなら、次をターミナルに貼ってください。

```bash
git clone https://github.com/kuraryu405/ai-bread.git
cd ai-bread
npm install

conda create -n ai-bread python=3.10 -y
conda activate ai-bread
python -m pip install -r python/requirements.txt

AI_BREAD_PYTHON="$(python -c 'import sys; print(sys.executable)')" npm run dev
```

Windowsの場合は、PowerShellで次を実行してください。

```powershell
git clone https://github.com/kuraryu405/ai-bread.git
cd ai-bread
npm install

conda create -n ai-bread python=3.10 -y
conda activate ai-bread
python -m pip install -r python/requirements.txt

$env:AI_BREAD_PYTHON = (python -c "import sys; print(sys.executable)")
npm run dev
```

2回目以降は次だけで起動できます。

Macの場合:

```bash
cd ai-bread
conda activate ai-bread
AI_BREAD_PYTHON="$(python -c 'import sys; print(sys.executable)')" npm run dev
```

Windowsの場合:

```powershell
cd ai-bread
conda activate ai-bread
$env:AI_BREAD_PYTHON = (python -c "import sys; print(sys.executable)")
npm run dev
```

## 起動方法

既にNode依存とPython依存を入れている場合は、Pythonワーカーの場所を指定して起動します。

Mac/Linux:

```bash
AI_BREAD_PYTHON=/absolute/path/to/python npm run dev
```

Windows PowerShell:

```powershell
$env:AI_BREAD_PYTHON = "C:\Users\your-name\miniconda3\envs\ai-bread\python.exe"
npm run dev
```

Windowsのコマンドプロンプトを使う場合:

```bat
set AI_BREAD_PYTHON=C:\Users\your-name\miniconda3\envs\ai-bread\python.exe
npm run dev
```

開発者MacではPythonワーカーが標準で `/Users/tsutsumin/miniconda3/envs/ds2026/bin/python` を使う設定です。他のPCでは、起動前に `AI_BREAD_PYTHON` を指定してください。

新しい環境を作る場合は、Python 3.10 以降でTensorFlowとOpenCVを導入してください。

Mac/Linux:

```bash
conda create -n ai-bread python=3.10 tensorflow=2.20.0
AI_BREAD_PYTHON="$HOME/miniconda3/envs/ai-bread/bin/python" npm run dev
```

Windows PowerShell:

```powershell
conda create -n ai-bread python=3.10 tensorflow=2.20.0
conda activate ai-bread
$env:AI_BREAD_PYTHON = (python -c "import sys; print(sys.executable)")
npm run dev
```

pipで依存を入れる場合は次を実行します。

Mac/Linux:

```bash
AI_BREAD_PYTHON="$HOME/miniconda3/envs/ai-bread/bin/python"
"$AI_BREAD_PYTHON" -m pip install -r python/requirements.txt
```

Windows PowerShell:

```powershell
$env:AI_BREAD_PYTHON = (python -c "import sys; print(sys.executable)")
python -m pip install -r python/requirements.txt
```

## データと学習

- 学習画像は `data/training/` に同梱済みです。クローン後は上の「クローンして起動するコマンド」でアプリを起動できます。
- `npm run organize-data` は、このMac上の元データフォルダから `data/training/` へ分類済みコピーを作り直すメンテナンス用コマンドです。通常のクローン後実行には不要です。WindowsではGit Bashなどbashを実行できる環境が必要です。
- 学習対象はブレッド、ツイスト、デニッシュ、ロール、バゲット、カンパーニュの6種類です。
- 学習済みモデル、カメラ画像、SQLite会計DBはElectronのユーザーデータ領域に保存され、Gitには含めません。
- 初回起動後、画面の「AIに学習させる」で同梱データから6種類モデルを作成します。

## 複数パン判定

- カメラ画像からパン色の領域をOpenCVで検出し、候補ごとに既存の分類モデルで種類を判定します。
- 判定後は候補一覧を確認し、誤検出は削除、誤分類は商品プルダウンで修正してから「検出結果をまとめてカートに入れる」を押します。
- 個別領域を検出できない場合は、従来と同じく画像全体を1件として判定します。
- v1は机の上に離して置かれたパン向けです。重なりが強いパン、接触したパン、画面端で大きく切れたパンは正しく分離できない場合があります。

## 確認

```bash
npm run verify-data
npm test
npm run build
npm run test:electron
```
