import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { Brain2RuntimeWorker } from "../runtime/v1/worker.mjs";
import { buildAuthorization } from "../runtime/v1/authorization.mjs";
import { runClosedLoopExecution } from "../runtime/v1/closed-loop.mjs";

function fixture() {
  const b2job = {
    format:"B2JOB", version:2, id:"b2job_g10_fixture", projectId:"project_g10",
    memoryRoot:"memory_g10", databox:{hash:"databox_g10"},
    evidence:[
      {id:"atom_g10_1",type:"atom",text:"Runtime artifact needs deterministic verification."},
      {id:"truth_g10_2",type:"truth",text:"Execution must remain R1-authorized."},
    ],
  };
  const request = {
    jobId:"runtime_g10_001", projectId:b2job.projectId, capability:"hash.sha256",
    inputs:[{text:"Brain2 G10 closed loop"}], evidenceIds:["atom_g10_1"],
    filesystemScope:[], networkPolicy:"DENY", limits:{},
  };
  request.authorization = buildAuthorization({
    projectId:request.projectId, capability:request.capability, filesystemScope:request.filesystemScope,
    networkPolicy:request.networkPolicy, limits:request.limits,
  });
  return {b2job,request};
}

test("R1-authorized runtime emits proof-carrying B2RESULT v2", async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"brain2-g10-"));
  try {
    const {b2job,request}=fixture();
    const result=await runClosedLoopExecution({
      worker:new Brain2RuntimeWorker({stateDir:dir}), b2job, request,
      hypothesis:{id:"r2_hyp_1",statement:"A deterministic runtime check can close this evidence gap."},
    });
    assert.equal(result.format,"B2RESULT");
    assert.equal(result.version,2);
    assert.equal(result.jobId,b2job.id);
    assert.equal(result.databoxHash,b2job.databox.hash);
    assert.deepEqual(result.evidenceIds,["atom_g10_1"]);
    assert.equal(result.runtimeExecution.executionResult.state,"COMPLETED");
    assert.equal(result.runtimeExecution.executionResult.verifierResult.verdict,"PASS");
    assert.match(result.answer,/hypothesis remains provisional/i);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test("closed loop rejects evidence outside the B2JOB", async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"brain2-g10-"));
  try {
    const {b2job,request}=fixture(); request.evidenceIds=["invented_evidence_id"];
    await assert.rejects(()=>runClosedLoopExecution({worker:new Brain2RuntimeWorker({stateDir:dir}),b2job,request}),/outside the B2JOB/);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test("closed loop fails closed on R1 DENY", async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"brain2-g10-"));
  try {
    const {b2job,request}=fixture(); request.authorization={...request.authorization,signal:"DENY"};
    await assert.rejects(()=>runClosedLoopExecution({worker:new Brain2RuntimeWorker({stateDir:dir}),b2job,request}),/R1_DENY/);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
