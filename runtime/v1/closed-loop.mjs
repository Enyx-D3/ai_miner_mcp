import { Brain2RuntimeWorker } from "./worker.mjs";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function requireB2Job(b2job) {
  if (!isObject(b2job) || b2job.format !== "B2JOB" || b2job.version !== 2 || typeof b2job.id !== "string") throw new Error("A canonical B2JOB v2 is required.");
  if (!isObject(b2job.databox) || typeof b2job.databox.hash !== "string") throw new Error("B2JOB Databox hash is required.");
  if (!Array.isArray(b2job.evidence) || b2job.evidence.length === 0) throw new Error("B2JOB contains no bounded evidence.");
}

export function buildClosedLoopB2Result({ b2job, request, executionResult, hypothesis }) {
  requireB2Job(b2job);
  if (!isObject(request) || typeof request.jobId !== "string" || typeof request.projectId !== "string" || typeof request.capability !== "string") throw new Error("A bounded Brain2 execution request is required.");
  if (b2job.projectId && b2job.projectId !== request.projectId) throw new Error("B2JOB and runtime request project scopes differ.");
  if (!isObject(executionResult) || executionResult.state !== "COMPLETED" || executionResult?.verifierResult?.verdict !== "PASS") throw new Error("Runtime execution did not produce a verified completion.");
  const allowed = new Set(b2job.evidence.map((item) => item?.id).filter(Boolean));
  const evidenceIds = [...new Set(Array.isArray(request.evidenceIds) ? request.evidenceIds : [])];
  if (evidenceIds.length === 0) throw new Error("Runtime request must declare the B2JOB evidence it relies on.");
  const outside = evidenceIds.filter((id) => !allowed.has(id));
  if (outside.length) throw new Error(`Runtime request references ${outside.length} evidence ID(s) outside the B2JOB.`);
  const outputHashes = Array.isArray(executionResult.outputHashes) ? executionResult.outputHashes : [];
  const observedStatement = `Verified Brain2 Runtime observation: ${request.capability} completed for runtime job ${request.jobId}; ${outputHashes.length} output hash(es) recorded${outputHashes.length ? ` (${outputHashes.join(", ")})` : ""}.`;
  return {
    format: "B2RESULT", version: 2, jobId: b2job.id, databoxHash: b2job.databox.hash,
    answer: `${observedStatement} The originating hypothesis remains provisional until interpreted against this new evidence.`,
    evidenceIds, model: "BRAIN2_RUNTIME_V1", createdAt: executionResult.finishedAt ?? new Date().toISOString(),
    runtimeExecution: {
      format: "B2_RUNTIME_EVIDENCE", version: 1, runtimeJobId: request.jobId, projectId: request.projectId,
      capability: request.capability, hypothesisId: hypothesis?.id, hypothesis: hypothesis?.statement,
      observedStatement, evidenceIds, executionResult,
    },
  };
}
export async function runClosedLoopExecution({ worker, b2job, request, hypothesis }) {
  const runtime = worker ?? new Brain2RuntimeWorker();
  const executionResult = await runtime.execute(request);
  if (executionResult.state !== "COMPLETED") {
    const reason = executionResult?.verifierResult?.reason ?? executionResult.state;
    throw new Error(`Brain2 Runtime execution did not complete: ${reason}`);
  }
  return buildClosedLoopB2Result({ b2job, request, executionResult, hypothesis });
}
