import fs from "node:fs/promises";import path from "node:path";import {V1_CAPABILITIES,capabilityManifest} from "./capabilities.mjs";import {sha256,validateR1Authorization} from "./authorization.mjs";
export const B2_RUNTIME_VERSION="B2_RUNTIME_V1";
async function atomicWrite(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const temp=`${file}.${process.pid}.tmp`;await fs.writeFile(temp,JSON.stringify(value,null,2));await fs.rename(temp,file);}
export class Brain2RuntimeWorker{
 constructor({stateDir=".brain2-runtime"}={}){this.stateDir=stateDir;this.allowedCapabilities=new Set(capabilityManifest());}
 manifest(){return{format:"B2_RUNTIME_MANIFEST",version:1,runtimeVersion:B2_RUNTIME_VERSION,capabilities:capabilityManifest()};}
 async stateFile(jobId){return path.join(this.stateDir,"jobs",`${jobId}.json`)}
 async execute(request){
  const base={format:"B2_EXECUTION_RESULT",version:1,jobId:request?.jobId??"unknown",inputHashes:[],outputHashes:[],evidenceGenerated:[],verifierResult:{verdict:"PENDING"}};
  const auth=validateR1Authorization(request,{allowedCapabilities:this.allowedCapabilities});if(!auth.ok)return{...base,state:"DENIED",verifierResult:{verdict:"FAIL",reason:auth.reason}};
  const capability=V1_CAPABILITIES.get(request.capability);if(!capability)return{...base,state:"DENIED",verifierResult:{verdict:"FAIL",reason:"CAPABILITY_NOT_IMPLEMENTED"}};
  const startedAt=new Date().toISOString();const running={...base,state:"RUNNING",startedAt,requestFingerprint:sha256(request)};await atomicWrite(await this.stateFile(request.jobId),running);
  try{const payload=await capability(request);const finishedAt=new Date().toISOString();const result={...running,state:"COMPLETED",finishedAt,outputs:payload.outputs??[],measurements:payload.measurements??[],inputHashes:(request.inputs??[]).map((item)=>sha256(item)),outputHashes:(payload.outputs??[]).map((item)=>sha256(item)),verifierResult:{verdict:"PASS",authorization:"R1_ALLOW"}};await atomicWrite(await this.stateFile(request.jobId),result);return result;}catch(error){const result={...running,state:"FAILED",finishedAt:new Date().toISOString(),verifierResult:{verdict:"FAIL",reason:error instanceof Error?error.message:String(error)}};await atomicWrite(await this.stateFile(request.jobId),result);return result;}
 }
 async recover(jobId){try{return JSON.parse(await fs.readFile(await this.stateFile(jobId),"utf8"));}catch{return null;}}
}
