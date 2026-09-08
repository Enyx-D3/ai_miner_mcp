import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserBridgeHub } from '../src/browser-bridge-hub.mjs';

async function waitFor(fn, timeout = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const v = fn();
    if (v) return v;
    await new Promise(r => setTimeout(r, 5));
  }
  throw new Error('waitFor timeout');
}

test('bridge request is delivered to active browser poll and response resolves caller', async () => {
  const hub = new BrowserBridgeHub({ requestTimeoutMs: 1000, longPollMs: 1000, sessionTtlMs: 5000 });
  const pollPromise = hub.poll({ sessionId: 's1', deviceId: 'd1', memoryRoot: 'root1', snapshotVersion: 1 });
  await waitFor(() => hub.activeSessions().length === 1);
  const requestPromise = hub.request('listProjects', {});
  const command = await pollPromise;
  assert.equal(command.method, 'listProjects');
  const accepted = hub.respond({ sessionId: 's1', requestId: command.requestId, ok: true, result: { projects: [{ id: 'p1' }] } });
  assert.equal(accepted.accepted, true);
  const result = await requestPromise;
  assert.equal(result.projects[0].id, 'p1');
});

test('bridge rejects mismatched response session', async () => {
  const hub = new BrowserBridgeHub({ requestTimeoutMs: 1000, longPollMs: 1000, sessionTtlMs: 5000 });
  const pollPromise = hub.poll({ sessionId: 's1', deviceId: 'd1' });
  const requestPromise = hub.request('health', {}).catch(e => e);
  const command = await pollPromise;
  const rejected = hub.respond({ sessionId: 's2', requestId: command.requestId, ok: true, result: {} });
  assert.equal(rejected.accepted, false);
  hub.respond({ sessionId: 's1', requestId: command.requestId, ok: false, error: 'expected' });
  const err = await requestPromise;
  assert.match(err.message, /expected/);
});
