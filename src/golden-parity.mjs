import crypto from "node:crypto";

export const G11_IDENTITY_VERSION = "B2_ID_V9_ASIF_READER";
export const G11_R1_GRAPH_VERSION = "B2_R1_GRAPH_V1";

function normalize(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalId(prefix, ...parts) {
  const stable = [G11_IDENTITY_VERSION, ...parts].map(normalize).join("\u241f");
  return `${prefix}_${sha256(stable).slice(0, 24)}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function verification(status) {
  if (["CURRENT", "HISTORICAL", "SUPERSEDED"].includes(status)) return "VERIFIED";
  if (status === "CONFLICTING") return "CONFLICTING";
  return "UNVERIFIED";
}

function atomKind(kind) {
  if (kind === "decision") return "DECISION";
  if (kind === "constraint") return "CONSTRAINT";
  if (kind === "task") return "TASK";
  if (kind === "question") return "OPEN_QUESTION";
  return "ATOM";
}

function makeEdge(from, to, type) {
  return { id: canonicalId("r1e", G11_R1_GRAPH_VERSION, from, type, to), from, to, type };
}

export function buildGoldenR1Graph(fixture) {
  const nodes = [];
  const edges = [];
  const atomIds = new Map();
  const truthIds = new Map();

  for (const atom of fixture.atoms ?? []) {
    const id = canonicalId("r1n", G11_R1_GRAPH_VERSION, "atom", atom.id);
    atomIds.set(atom.id, id);
    nodes.push({
      id,
      kind: atomKind(atom.kind),
      projectId: atom.projectId,
      label: atom.text,
      sourceRecordId: atom.id,
      truthStatus: atom.truthStatus,
      verificationState: verification(atom.truthStatus),
      evidenceIds: unique([atom.messageId, atom.sourceId, ...(atom.provenance ?? [])]),
    });
  }

  for (const truth of fixture.truths ?? []) {
    const id = canonicalId("r1n", G11_R1_GRAPH_VERSION, "truth", truth.id);
    truthIds.set(truth.id, id);
    nodes.push({
      id,
      kind: truth.kind === "decision" ? "DECISION" : truth.kind === "constraint" ? "CONSTRAINT" : "TRUTH",
      projectId: truth.projectId,
      label: truth.text,
      sourceRecordId: truth.id,
      truthStatus: truth.status,
      verificationState: verification(truth.status),
      evidenceIds: unique([truth.atomId, truth.sourceId, ...(truth.evidenceAtomIds ?? [])]),
    });
  }

  for (const atom of fixture.atoms ?? []) {
    const from = atomIds.get(atom.id);
    if (atom.parentAtomId && atomIds.has(atom.parentAtomId)) edges.push(makeEdge(from, atomIds.get(atom.parentAtomId), "DERIVED_FROM"));
    if (atom.truthRecordId && truthIds.has(atom.truthRecordId)) edges.push(makeEdge(from, truthIds.get(atom.truthRecordId), "SUPPORTS"));
    if (atom.supersedesTruthId && truthIds.has(atom.supersedesTruthId)) edges.push(makeEdge(from, truthIds.get(atom.supersedesTruthId), "SUPERSEDES"));
  }

  for (const truth of fixture.truths ?? []) {
    const from = truthIds.get(truth.id);
    if (atomIds.has(truth.atomId)) edges.push(makeEdge(from, atomIds.get(truth.atomId), "DERIVED_FROM"));
    for (const evidenceId of truth.evidenceAtomIds ?? []) {
      if (atomIds.has(evidenceId)) edges.push(makeEdge(atomIds.get(evidenceId), from, "SUPPORTS"));
    }
    if (truth.supersedes && truthIds.has(truth.supersedes)) edges.push(makeEdge(from, truthIds.get(truth.supersedes), "SUPERSEDES"));
  }

  nodes.sort((a, b) => a.id.localeCompare(b.id));
  const dedupedEdges = [...new Map(edges.map((item) => [item.id, item])).values()].sort((a, b) => a.id.localeCompare(b.id));
  const rootMaterial = [
    nodes.map((node) => [node.id, node.kind, node.projectId ?? "", node.label, node.sourceRecordId ?? "", node.truthStatus ?? "", node.verificationState, node.evidenceIds]),
    dedupedEdges.map((edge) => [edge.id, edge.from, edge.to, edge.type]),
  ];
  return {
    format: "B2_R1_GRAPH",
    version: 1,
    graphVersion: G11_R1_GRAPH_VERSION,
    nodes,
    edges: dedupedEdges,
    rootHash: sha256(JSON.stringify(rootMaterial)),
  };
}

export function verifyGoldenFixture(fixture) {
  const graph = buildGoldenR1Graph(fixture);
  const truthIds = new Set((fixture.truths ?? []).map((truth) => truth.id));
  const current = graph.nodes
    .filter((node) => node.truthStatus === "CURRENT" && truthIds.has(node.sourceRecordId))
    .map((node) => node.sourceRecordId)
    .sort();
  const superseded = graph.nodes
    .filter((node) => node.truthStatus === "SUPERSEDED" && truthIds.has(node.sourceRecordId))
    .map((node) => node.sourceRecordId)
    .sort();
  const edges = new Set(graph.edges.map((edge) => edge.type));
  const same = (a, b) => [...a].sort().join("\u241f") === [...b].sort().join("\u241f");
  const checks = {
    root: graph.rootHash === fixture.expected?.r1RootHash,
    nodeCount: graph.nodes.length === fixture.expected?.r1NodeCount,
    edgeCount: graph.edges.length === fixture.expected?.r1EdgeCount,
    currentTruth: same(current, fixture.assertions?.currentTruthSourceIds ?? []),
    supersededTruth: same(superseded, fixture.assertions?.supersededTruthSourceIds ?? []),
    requiredEdges: (fixture.assertions?.mustContainEdgeTypes ?? []).every((type) => edges.has(type)),
    r2BoundaryDeclared: fixture.assertions?.r2MayNotBecomeCurrentTruth === true,
  };
  return { pass: Object.values(checks).every(Boolean), graph, checks };
}
