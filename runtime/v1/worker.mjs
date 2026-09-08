import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {V1_CAPABILITIES,capabilityManifest} from "./capabilities.mjs";
import {sha256,validateR1Authorization} from "./authorization.mjs";

export const B2_RUNTIME_VERSION="B2_RUNTIME_V1";

const REPLAY_SAFE_CAPABILITIES=new Set([
  "hash.sha256",
  "artifact.verify",
  "benchmark.hash",
]);
const JOB_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function assertJobId(jobId){
  if(typeof jobId!=="string"||!JOB_ID_RE.test(jobId)){
    throw new Error("INVALID_JOB_ID");
  }
  return jobId;
}

async function atomicWrite(file,value){
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const temp=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle;
  try{
    handle=await fs.open(temp,"wx",0o600);
    await handle.writeFile(JSON.stringify(value,null,2));
    await handle.sync();
    await handle.close();
    handle=null;
    await fs.rename(temp,file);
    try{
      const dir=await fs.open(path.dirname(file),"r");
      try{await dir.sync();}finally{await dir.close();}
    }catch{}
  }catch(error){
    if(handle){try{await handle.close();}catch{}}
    try{await fs.unlink(temp);}catch{}
    throw error;
  }
}

async function readJsonState(file){
  try{
    const raw=await fs.readFile(file,"utf8");
    const parsed=JSON.parse(raw);
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)){
      throw new Error("Runtime state is not an object");
    }
    return parsed;
  }catch(error){
    if(error?.code==="ENOENT")return null;
    throw new Error(`RUNTIME_STATE_UNREADABLE: ${error instanceof Error?error.message:String(error)}`);
  }
}

export class Brain2RuntimeWorker{
  constructor({stateDir=".brain2-runtime"}={}){
    this.stateDir=stateDir;
    this.allowedCapabilities=new Set(capabilityManifest());
    this.activeJobs=new Set();
  }

  manifest(){
    return{
      format:"B2_RUNTIME_MANIFEST",
      version:1,
      runtimeVersion:B2_RUNTIME_VERSION,
      capabilities:capabilityManifest(),
      replaySafeCapabilities:[...REPLAY_SAFE_CAPABILITIES].sort(),
    };
  }

  async stateFile(jobId){
    return path.join(this.stateDir,"jobs",`${assertJobId(jobId)}.json`);
  }

  async _read(jobId){
    return readJsonState(await this.stateFile(jobId));
  }

  async recover(jobId){
    const id=assertJobId(jobId);
    const state=await this._read(id);
    if(!state)return null;

    if(state.state==="RUNNING"&&!this.activeJobs.has(id)){
      const interrupted={
        ...state,
        state:"INTERRUPTED",
        recoveredAt:new Date().toISOString(),
        verifierResult:{
          verdict:"FAIL",
          reason:"INTERRUPTED_BY_RUNTIME_RESTART",
        },
      };
      await atomicWrite(await this.stateFile(id),interrupted);
      return interrupted;
    }
    return state;
  }

  async execute(request){
    const base={
      format:"B2_EXECUTION_RESULT",
      version:1,
      jobId:request?.jobId??"unknown",
      inputHashes:[],
      outputHashes:[],
      evidenceGenerated:[],
      verifierResult:{verdict:"PENDING"},
    };

    const auth=validateR1Authorization(request,{allowedCapabilities:this.allowedCapabilities});
    if(!auth.ok){
      return{...base,state:"DENIED",verifierResult:{verdict:"FAIL",reason:auth.reason}};
    }

    const capability=V1_CAPABILITIES.get(request.capability);
    if(!capability){
      return{...base,state:"DENIED",verifierResult:{verdict:"FAIL",reason:"CAPABILITY_NOT_IMPLEMENTED"}};
    }

    let jobId;
    try{jobId=assertJobId(request.jobId);}
    catch{
      return{...base,state:"DENIED",verifierResult:{verdict:"FAIL",reason:"INVALID_JOB_ID"}};
    }

    if(this.activeJobs.has(jobId)){
      return{...base,state:"DENIED",verifierResult:{verdict:"FAIL",reason:"JOB_ALREADY_RUNNING"}};
    }

    const requestFingerprint=sha256(request);
    let existing=await this._read(jobId);

    if(existing){
      if(existing.requestFingerprint&&existing.requestFingerprint!==requestFingerprint){
        return{
          ...base,
          state:"DENIED",
          verifierResult:{verdict:"FAIL",reason:"JOB_ID_REUSE_MISMATCH"},
        };
      }

      if(existing.state==="COMPLETED"||existing.state==="FAILED"){
        return{...existing,cacheHit:true};
      }

      if(existing.state==="RUNNING"){
        existing={
          ...existing,
          state:"INTERRUPTED",
          recoveredAt:new Date().toISOString(),
          verifierResult:{verdict:"FAIL",reason:"INTERRUPTED_BY_RUNTIME_RESTART"},
        };
        await atomicWrite(await this.stateFile(jobId),existing);
      }

      if(existing.state==="INTERRUPTED"&&!REPLAY_SAFE_CAPABILITIES.has(request.capability)){
        return{
          ...base,
          state:"RECOVERY_REQUIRED",
          requestFingerprint,
          verifierResult:{verdict:"FAIL",reason:"CAPABILITY_NOT_REPLAY_SAFE"},
        };
      }
    }

    const attempt=Math.max(1,Number(existing?.attempt??0)+1);
    const startedAt=new Date().toISOString();
    const running={
      ...base,
      state:"RUNNING",
      startedAt,
      requestFingerprint,
      attempt,
      recoveredFrom:existing?.state==="INTERRUPTED"?"INTERRUPTED":undefined,
    };

    this.activeJobs.add(jobId);
    await atomicWrite(await this.stateFile(jobId),running);

    try{
      const payload=await capability(request);
      const finishedAt=new Date().toISOString();
      const result={
        ...running,
        state:"COMPLETED",
        finishedAt,
        outputs:payload.outputs??[],
        measurements:payload.measurements??[],
        inputHashes:(request.inputs??[]).map((item)=>sha256(item)),
        outputHashes:(payload.outputs??[]).map((item)=>sha256(item)),
        verifierResult:{verdict:"PASS",authorization:"R1_ALLOW"},
      };
      await atomicWrite(await this.stateFile(jobId),result);
      return result;
    }catch(error){
      const result={
        ...running,
        state:"FAILED",
        finishedAt:new Date().toISOString(),
        verifierResult:{
          verdict:"FAIL",
          reason:error instanceof Error?error.message:String(error),
        },
      };
      await atomicWrite(await this.stateFile(jobId),result);
      return result;
    }finally{
      this.activeJobs.delete(jobId);
    }
  }
}
