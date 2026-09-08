import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {Brain2RuntimeWorker} from "../runtime/v1/worker.mjs";
import {buildAuthorization,sha256} from "../runtime/v1/authorization.mjs";

const limits={memoryBytes:64*1024*1024,timeoutMs:5000,cpuMillis:5000,storageBytes:1024*1024};
function request(jobId,capability="hash.sha256",inputs=["abc"]){
  return{
    format:"B2_EXECUTION_REQUEST",version:1,jobId,projectId:"p1",capability,inputs,
    filesystemScope:[],networkPolicy:"DENY",limits,verifierContract:{},
    authorization:buildAuthorization({projectId:"p1",capability,filesystemScope:[],networkPolicy:"DENY",limits}),
  };
}

test("G12.2 completed job replay returns cached result",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"b2-g122-"));
  const worker=new Brain2RuntimeWorker({stateDir:dir});
  const req=request("job-cache");
  const first=await worker.execute(req);
  const second=await worker.execute(req);
  assert.equal(first.state,"COMPLETED");
  assert.equal(second.state,"COMPLETED");
  assert.equal(second.cacheHit,true);
  assert.equal(second.outputHashes[0],first.outputHashes[0]);
});

test("G12.2 stale RUNNING checkpoint becomes INTERRUPTED",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"b2-g122-"));
  const worker=new Brain2RuntimeWorker({stateDir:dir});
  const req=request("job-interrupted");
  const file=await worker.stateFile(req.jobId);
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,JSON.stringify({
    format:"B2_EXECUTION_RESULT",version:1,jobId:req.jobId,state:"RUNNING",
    requestFingerprint:sha256(req),attempt:1,verifierResult:{verdict:"PENDING"},
  }));
  const recovered=await worker.recover(req.jobId);
  assert.equal(recovered.state,"INTERRUPTED");
  assert.equal(recovered.verifierResult.reason,"INTERRUPTED_BY_RUNTIME_RESTART");
});

test("G12.2 replay-safe interrupted job resumes as next attempt",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"b2-g122-"));
  const worker=new Brain2RuntimeWorker({stateDir:dir});
  const req=request("job-resume");
  const file=await worker.stateFile(req.jobId);
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,JSON.stringify({
    format:"B2_EXECUTION_RESULT",version:1,jobId:req.jobId,state:"RUNNING",
    requestFingerprint:sha256(req),attempt:1,verifierResult:{verdict:"PENDING"},
  }));
  const result=await worker.execute(req);
  assert.equal(result.state,"COMPLETED");
  assert.equal(result.attempt,2);
  assert.equal(result.recoveredFrom,"INTERRUPTED");
});

test("G12.2 job id traversal and corrupt checkpoint fail closed",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"b2-g122-"));
  const worker=new Brain2RuntimeWorker({stateDir:dir});
  await assert.rejects(()=>worker.recover("../escape"),/INVALID_JOB_ID/);

  const file=await worker.stateFile("job-corrupt");
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,"{not-json");
  await assert.rejects(()=>worker.recover("job-corrupt"),/RUNTIME_STATE_UNREADABLE/);
});
