import crypto from "node:crypto";
export const B2_V1_CONTRACT_VERSION = "1.0.0";
export const B2_R1_GRAPH_VERSION = "B2_R1_GRAPH_V1";
export const B2_R2_GRAPH_VERSION = "B2_R2_GRAPH_V1";
const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function validateR1Graph(graph) {
  if (!graph || graph.format !== "B2_R1_GRAPH" || graph.version !== 1 || graph.graphVersion !== B2_R1_GRAPH_VERSION) throw new Error("Unsupported R1 graph contract.");
  const nodeIds = new Set(); for (const node of graph.nodes ?? []) { if (!node?.id || nodeIds.has(node.id)) throw new Error("R1 node IDs must be present and unique."); nodeIds.add(node.id); }
  for (const edge of graph.edges ?? []) if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error(`R1 edge ${edge.id ?? "<unknown>"} references a missing node.`);
  return { ok: true, nodeCount: nodeIds.size, edgeCount: (graph.edges ?? []).length, fingerprint: hash({ nodes: graph.nodes, edges: graph.edges }) };
}
export function validateR2Graph(graph, r1Graph) {
  if (!graph || graph.format !== "B2_R2_GRAPH" || graph.version !== 1 || graph.graphVersion !== B2_R2_GRAPH_VERSION) throw new Error("Unsupported R2 graph contract.");
  const r1Ids = new Set((r1Graph?.nodes ?? []).map((node) => node.id));
  const nodeIds = new Set();
  for (const node of graph.nodes ?? []) {
    if (!node?.id || nodeIds.has(node.id)) throw new Error("R2 node IDs must be present and unique."); nodeIds.add(node.id);
    if (!Array.isArray(node.derivedFrom) || node.derivedFrom.length === 0 || node.derivedFrom.some((id) => !r1Ids.has(id))) throw new Error(`R2 node ${node.id} is not evidence-bounded to R1.`);
    if (node?.metadata?.currentTruth === true) throw new Error(`R2 node ${node.id} attempted Current Truth promotion.`);
  }
  return { ok: true, nodeCount: nodeIds.size, edgeCount: (graph.edges ?? []).length, fingerprint: hash({ nodes: graph.nodes, edges: graph.edges }) };
}
