import crypto from "node:crypto";
const sha256=(value)=>crypto.createHash("sha256").update(value).digest("hex");
export const V1_CAPABILITIES = new Map([
 ["hash.sha256", async ({inputs=[]})=>({outputs:inputs.map((value)=>({sha256:sha256(typeof value==="string"?value:JSON.stringify(value))})),measurements:[]})],
 ["artifact.verify", async ({inputs=[]})=>{const outputs=inputs.map((item)=>{const actual=sha256(typeof item?.content==="string"?item.content:JSON.stringify(item?.content??null));return{expected:item?.sha256??null,actual,ok:Boolean(item?.sha256)&&item.sha256===actual};});return{outputs,measurements:[]};}],
 ["benchmark.hash", async ({inputs=[],limits={}})=>{const loops=Math.max(1,Math.min(10000,Number(inputs?.[0]?.loops??1000)));const payload=String(inputs?.[0]?.payload??"brain2");const start=performance.now();let last="";for(let i=0;i<loops;i++)last=sha256(payload+String(i));const durationMs=performance.now()-start;return{outputs:[{last}],measurements:[{metric:"hash.loops_per_second",value:loops/(durationMs/1000),unit:"ops/s",loops,durationMs}]};}]
]);
export function capabilityManifest(){return [...V1_CAPABILITIES.keys()].sort();}
