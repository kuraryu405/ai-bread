const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

class PythonWorker extends EventEmitter {
  constructor({ pythonPath, workerPath }) {
    super();
    this.pythonPath = pythonPath;
    this.workerPath = workerPath;
    this.process = null;
    this.pending = new Map();
    this.sequence = 0;
    this.startError = null;
  }

  start() {
    if (this.process) return;
    if (path.isAbsolute(this.pythonPath) && !fs.existsSync(this.pythonPath)) {
      this.startError = `Python 実行ファイルが見つかりません: ${this.pythonPath}`;
      return;
    }

    this.process = spawn(this.pythonPath, [this.workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1', TF_CPP_MIN_LOG_LEVEL: '2' },
    });

    const lines = readline.createInterface({ input: this.process.stdout });
    lines.on('line', (line) => this.handleLine(line));
    this.process.stderr.on('data', (buffer) => this.emit('log', buffer.toString().trim()));
    this.process.on('error', (error) => this.failAll(error));
    this.process.on('exit', (code, signal) => {
      const error = new Error(`Python ワーカーが終了しました (code=${code}, signal=${signal ?? 'none'})`);
      this.process = null;
      this.failAll(error);
    });
  }

  handleLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit('log', line);
      return;
    }

    if (message.event) {
      this.emit('event', message);
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(message.error || 'Python ワーカーでエラーが起きました。'));
    }
  }

  request(action, payload = {}) {
    if (this.startError) return Promise.reject(new Error(this.startError));
    this.start();
    if (!this.process?.stdin.writable) {
      return Promise.reject(new Error('Python ワーカーを起動できません。'));
    }

    const id = String(++this.sequence);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process.stdin.write(`${JSON.stringify({ id, action, ...payload })}\n`);
    });
  }

  failAll(error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  async stop() {
    if (!this.process) return;
    try {
      await this.request('shutdown');
    } catch {
      // The worker may already have exited; killing it below is safe.
    }
    this.process.kill();
    this.process = null;
  }
}

function resolvePythonPath() {
  if (process.env.AI_BREAD_PYTHON) return process.env.AI_BREAD_PYTHON;
  const ds2026 = '/Users/tsutsumin/miniconda3/envs/ds2026/bin/python';
  return fs.existsSync(ds2026) ? ds2026 : 'python3';
}

module.exports = { PythonWorker, resolvePythonPath };
