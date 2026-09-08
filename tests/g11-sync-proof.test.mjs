import assert from "node:assert/strict";
import test from "node:test";
import { AiMinerClient } from "../src/ai-miner-client.mjs";

test("G11.1 AiMinerClient requests live sync proof through browser IndexedDB bridge", async () => {
  const calls = [];
  const bridgeHub = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === "syncProof") {
        return {
          format: "B2_G11_SYNC_PROOF",
          version: 1,
          surface: "WEB",
          memoryRoot: "b2m_test",
          truthStateRoot: "truth_root",
        };
      }
      throw new Error(`unexpected method ${method}`);
    },
    status() { return { ok: true, activeSessions: [{}] }; },
  };
  const client = new AiMinerClient({ bridgeHub });
  const proof = await client.syncProof();
  assert.equal(proof.format, "B2_G11_SYNC_PROOF");
  assert.equal(proof.surface, "WEB");
  assert.deepEqual(calls, [{ method: "syncProof", params: undefined }]);
});
