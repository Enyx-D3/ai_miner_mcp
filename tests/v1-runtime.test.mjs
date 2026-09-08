import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Brain2RuntimeWorker } from '../runtime/v1/worker.mjs';
import { buildAuthorization } from '../runtime/v1/authorization.mjs';

const limits={memoryBytes:64*1024*1024,timeoutMs:5000,cpuMillis:5000,storageBytes:1024*1024};
function request(jobId,capability,inputs=[]){return{format:'B2_EXECUTION_REQUEST',version:1,jobId,projectId:'p1',capability,inputs,filesystemScope:[],networkPolicy:'DENY',limits,verifierContract:{},authorization:buildAuthorization({projectId:'p1',capability,filesystemScope:[],networkPolicy:'DENY',limits})}}

test('authorized capability executes and checkpoint can be recovered', async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'b2rt-')); const worker=new Brain2RuntimeWorker({stateDir:dir});
  const result=await worker.execute(request('job-ok','hash.sha256',['abc'])); assert.equal(result.state,'COMPLETED'); assert.equal(result.verifierResult.verdict,'PASS');
  const recovered=await worker.recover('job-ok'); assert.equal(recovered.state,'COMPLETED');
});

test('invalid R1 scope and arbitrary shell fail closed', async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'b2rt-')); const worker=new Brain2RuntimeWorker({stateDir:dir});
  const invalid={...request('job-bad','hash.sha256',['abc']),authorization:{signal:'ALLOW',projectId:'p1',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),scopeHash:'bad'}};
  assert.equal((await worker.execute(invalid)).state,'DENIED');
  const shell=await worker.execute(request('job-shell','shell.exec',['echo unsafe'])); assert.equal(shell.state,'DENIED'); assert.equal(shell.verifierResult.reason,'CAPABILITY_NOT_ALLOWED');
});
