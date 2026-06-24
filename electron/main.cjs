const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('./database.cjs');
const { PythonWorker, resolvePythonPath } = require('./python-worker.cjs');

let mainWindow;
let store;
let worker;

function projectPath(...parts) {
  return path.join(__dirname, '..', ...parts);
}

function runtimePaths() {
  const base = app.getPath('userData');
  const modelDirectory = path.join(base, 'models');
  const captureDirectory = path.join(base, 'captures');
  fs.mkdirSync(modelDirectory, { recursive: true });
  fs.mkdirSync(captureDirectory, { recursive: true });
  return {
    dataRoot: projectPath('data', 'training'),
    modelPath: path.join(modelDirectory, 'bread-classifier.keras'),
    metadataPath: path.join(modelDirectory, 'bread-classifier.json'),
    captureDirectory,
  };
}

function emitWorkerEvent(payload) {
  mainWindow?.webContents.send('ai:event', payload);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(projectPath('dist', 'index.html'));
  }
}

function setupIpc() {
  ipcMain.handle('ai:status', () => worker.request('status', runtimePaths()));
  ipcMain.handle('ai:train', () => worker.request('train', { ...runtimePaths(), epochs: 15 }));
  ipcMain.handle('ai:predict', (_event, imagePath) => {
    if (typeof imagePath !== 'string' || !imagePath.startsWith(app.getPath('userData'))) {
      throw new Error('判定画像の保存先が正しくありません。');
    }
    return worker.request('predict', { ...runtimePaths(), imagePath });
  });

  ipcMain.handle('capture:save', (_event, dataUrl) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/jpeg;base64,')) {
      throw new Error('JPEG 画像を受け取れませんでした。');
    }
    const base64 = dataUrl.slice('data:image/jpeg;base64,'.length);
    const outputPath = path.join(runtimePaths().captureDirectory, `${Date.now()}.jpg`);
    fs.writeFileSync(outputPath, Buffer.from(base64, 'base64'));
    return outputPath;
  });

  ipcMain.handle('pos:list-products', () => store.listProducts());
  ipcMain.handle('pos:checkout', (_event, items) => store.checkout(items));
}

app.whenReady().then(() => {
  const paths = runtimePaths();
  store = createStore(path.join(app.getPath('userData'), 'bread-pos.sqlite'));
  worker = new PythonWorker({
    pythonPath: resolvePythonPath(),
    workerPath: projectPath('python', 'worker.py'),
  });
  worker.on('event', emitWorkerEvent);
  worker.on('log', (message) => emitWorkerEvent({ event: 'log', message }));

  setupIpc();
  createWindow();
  void paths;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  store?.close();
  void worker?.stop();
});
