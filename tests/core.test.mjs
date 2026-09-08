import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MissionStore } from '../src/mission-store.mjs';
import { advanceMission, exportMission, refreshMission, startMission, submitFinding } from '../src/core.mjs';

class FakeClient {
  constructor() { this.revision = 1; this.searchCalls = []; }
  async bootstrap() {
    return {
      project: { id: 'P1', name: 'R1X', tags: ['RapidRetrieve', '.ASIF'] }, projectId: 'P1', projectName: 'R1X',
      currentTruth: { heads: [{ subject: 'R1', value: 'streaming-control', state: 'CURRENT' }] },
      sources: this.revision === 1
        ? [{ id: 'S1', hash: 'h1', title: 'Silent R1 benchmark' }]
        : [{ id: 'S1', hash: 'h1', title: 'Silent R1 benchmark' }, { id: 'S2', hash: 'h2', title: 'DSP-XT integration decision' }]
    };
  }
  async search(q) {
    this.searchCalls.push(q);
    if (/RapidRetrieve benchmark/i.test(q)) return { results: [{ id:'S1', title:'Speed Demon', text:'RapidRetrieve benchmark 71783 QPS. Later architecture retained the evidence.' }] };
    if (/R1 superseded/i.test(q)) return { results: [{ id:'S1', text:'Old R1 compression framing was superseded by streaming-control.' }] };
    if (/DSP-XT/i.test(q) && this.revision === 2) return { results: [{ id:'S2', text:'DSP-XT is now a candidate integration for R1X.' }] };
    return { results: [] };
  }
}

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'b2s-')); }

test('mission is deterministic for the same AI Miner snapshot', async () => {
  const dir = tmp();
  const store = new MissionStore(dir);
  const client = new FakeClient();
  const a = await startMission(client, store, 'R1X');
  const b = await startMission(client, store, 'R1X');
  assert.equal(a.missionId, b.missionId);
  assert.equal(a.sourceFingerprint, b.sourceFingerprint);
  assert.deepEqual(a.queue, b.queue);
  store.close();
});

test('archaeology searches live evidence and creates durable residuals', async () => {
  const dir = tmp();
  const store = new MissionStore(dir);
  const client = new FakeClient();
  const s = await startMission(client, store, 'R1X');
  for (let i=0;i<30 && store.get(s.missionId).queue.length;i++) await advanceMission(client, store, s.missionId, 20);
  const state = store.get(s.missionId);
  assert.ok(client.searchCalls.length > 0);
  assert.ok(state.evidence.length > 0);
  assert.ok(state.residuals.some(r => r.type === 'CANON_REVIEW'));
  store.close();
});

test('provisional findings never mutate AI Miner bootstrap truth', async () => {
  const dir = tmp();
  const store = new MissionStore(dir);
  const client = new FakeClient();
  const s = await startMission(client, store, 'R1X');
  const before = JSON.stringify(store.get(s.missionId).bootstrap.currentTruth);
  const f = submitFinding(store, s.missionId, { claim:'R1 used to be compression', classification:'HISTORICAL', evidenceRefs:['S1'] });
  assert.equal(f.status, 'PROVISIONAL_NOT_CANONICAL');
  const after = JSON.stringify(store.get(s.missionId).bootstrap.currentTruth);
  assert.equal(before, after);
  store.close();
});

test('refresh sees a changed AI Miner snapshot without restarting mission', async () => {
  const dir = tmp();
  const store = new MissionStore(dir);
  const client = new FakeClient();
  const s = await startMission(client, store, 'R1X');
  client.revision = 2;
  const r = await refreshMission(client, store, s.missionId);
  assert.equal(r.changed, true);
  const state = store.get(s.missionId);
  assert.ok(state.terms.some(x => /DSP-XT/i.test(x)));
  assert.ok(state.residuals.some(x => x.type === 'SOURCE_OF_TRUTH_CHANGED'));
  store.close();
});

test('mission ZIP is byte-identical for unchanged state', async () => {
  const dir = tmp();
  const store = new MissionStore(dir);
  const client = new FakeClient();
  const s = await startMission(client, store, 'R1X');
  const out1 = exportMission(store, s.missionId, path.join(dir,'a'));
  const out2 = exportMission(store, s.missionId, path.join(dir,'b'));
  assert.equal(out1.sha256, out2.sha256);
  assert.deepEqual(fs.readFileSync(out1.path), fs.readFileSync(out2.path));
  store.close();
});
