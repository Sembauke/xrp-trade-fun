import { Worker } from 'node:worker_threads';

export class BacktestWorkerClient {
  constructor() {
    this.worker = null;
    this.seq = 0;
    this.pending = new Map();
    this.stopping = false;
    this.spawnWorker();
  }

  spawnWorker() {
    if (this.stopping) return;

    const worker = new Worker(new URL('./backtest-worker.js', import.meta.url));
    this.worker = worker;

    worker.on('message', (message) => {
      const { id, ok, payload, error } = message ?? {};
      const request = this.pending.get(id);
      if (!request) return;
      this.pending.delete(id);

      if (ok) {
        request.resolve(payload);
      } else {
        request.reject(new Error(String(error || 'Backtest worker request failed')));
      }
    });

    worker.on('error', (error) => {
      this.rejectAll(error);
    });

    worker.on('exit', (code) => {
      const unexpectedExit = !this.stopping && code !== 0;
      this.worker = null;
      if (unexpectedExit) {
        this.rejectAll(new Error(`Backtest worker exited with code ${code}`));
        setTimeout(() => this.spawnWorker(), 500);
      }
    });
  }

  rejectAll(error) {
    const err = error instanceof Error ? error : new Error(String(error));
    for (const [, request] of this.pending.entries()) {
      request.reject(err);
    }
    this.pending.clear();
  }

  run(method, params) {
    if (!this.worker) {
      this.spawnWorker();
    }
    if (!this.worker) {
      return Promise.reject(new Error('Backtest worker unavailable'));
    }

    const id = `bt-${Date.now()}-${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, method, params });
    });
  }

  runBacktest(params) {
    return this.run('runBacktest', params);
  }

  runSweep(params) {
    return this.run('runBacktestSweep', params);
  }

  async terminate() {
    this.stopping = true;
    this.rejectAll(new Error('Backtest worker terminated'));

    if (!this.worker) return;
    const worker = this.worker;
    this.worker = null;
    await worker.terminate();
  }
}
