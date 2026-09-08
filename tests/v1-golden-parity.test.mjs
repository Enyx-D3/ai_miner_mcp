import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validateR1Graph, validateR2Graph } from "../src/graph-contracts.mjs";
import { buildGoldenR1Graph, verifyGoldenFixture } from "../src/golden-parity.mjs";

const fixture = JSON.parse(fs.readFileSync(new URL("../spec/v1/golden-graph-fixture.json", import.meta.url), "utf8"));

test("G11 golden fixture derives the frozen cross-surface R1 root", () => {
  const report = verifyGoldenFixture(fixture);
  assert.equal(report.pass, true, JSON.stringify(report.checks));
  assert.equal(report.graph.rootHash, fixture.expected.r1RootHash);
  assert.deepEqual(validateR1Graph(report.graph).ok, true);
});

test("G11 MCP contract rejects an R2 self-promotion attempt", () => {
  const r1 = buildGoldenR1Graph(fixture);
  const source = r1.nodes.find((node) => node.sourceRecordId === fixture.assertions.currentTruthSourceIds[0]);
  assert.ok(source);

  const badR2 = {
    format: "B2_R2_GRAPH",
    version: 1,
    graphVersion: "B2_R2_GRAPH_V1",
    nodes: [{
      id: "r2_bad_promotion",
      kind: "HYPOTHESIS",
      statement: "Must remain provisional.",
      derivedFrom: [source.id],
      confidence: 0.5,
      status: "PROVISIONAL",
      requiredEvidence: [],
      staleWhen: [],
      metadata: { currentTruth: true },
    }],
    edges: [],
    rootHash: "not-authoritative",
  };

  assert.throws(
    () => validateR2Graph(badR2, r1),
    /Current Truth promotion/,
  );
});
