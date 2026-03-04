import { parentPort } from 'node:worker_threads';
import { runBacktest, runBacktestSweep } from './backtest.js';

if (!parentPort) {
  throw new Error('backtest-worker must run in a Worker thread');
}

parentPort.on('message', async (message) => {
  const { id, method, params } = message ?? {};
  if (!id || !method) return;

  try {
    let payload;
    if (method === 'runBacktest') {
      payload = await runBacktest(params ?? {});
    } else if (method === 'runBacktestSweep') {
      payload = await runBacktestSweep(params ?? {});
    } else {
      throw new Error(`Unknown backtest worker method: ${String(method)}`);
    }

    parentPort.postMessage({ id, ok: true, payload });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
