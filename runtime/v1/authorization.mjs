import crypto from "node:crypto";
export const R1_SIGNALS = new Set(["ALLOW","DENY","PAUSE","REVOKE","REQUIRE_TICK","LIMIT_CHANGED"]);
export function canonicalJson(value){ if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`; if(value&&typeof value==="object"){return `{${Object.keys(value).sort().map((k)=>JSON.stringify(k)+":"+canonicalJson(value[k])).join(",")}}`;} return JSON.stringify(value); }
export function sha256(value){return crypto.createHash("sha256").update(typeof value==="string"?value:canonicalJson(value)).digest("hex");}
export function validateR1Authorization(request,{now=Date.now(),allowedCapabilities}={}){
 const auth=request?.authorization;if(!auth||!R1_SIGNALS.has(auth.signal))return{ok:false,reason:"MISSING_OR_INVALID_R1_SIGNAL"};
 if(auth.signal!=="ALLOW")return{ok:false,reason:`R1_${auth.signal}`};
 const expiry=Date.parse(auth.expiresAt);if(!Number.isFinite(expiry)||expiry<=now)return{ok:false,reason:"R1_AUTH_EXPIRED"};
 if(!request.projectId||auth.projectId&&auth.projectId!==request.projectId)return{ok:false,reason:"PROJECT_SCOPE_MISMATCH"};
 if(allowedCapabilities&&!allowedCapabilities.has(request.capability))return{ok:false,reason:"CAPABILITY_NOT_ALLOWED"};
 const scope={projectId:request.projectId,capability:request.capability,filesystemScope:[...(request.filesystemScope??[])].sort(),networkPolicy:request.networkPolicy??"DENY",limits:request.limits??{}};
 if(auth.scopeHash!==sha256(scope))return{ok:false,reason:"R1_SCOPE_HASH_MISMATCH"};
 return{ok:true,reason:"R1_ALLOW"};
}
export function buildAuthorization({projectId,capability,filesystemScope=[],networkPolicy="DENY",limits,ttlMs=300000,issuedAt=new Date()}){const scope={projectId,capability,filesystemScope:[...filesystemScope].sort(),networkPolicy,limits};return{signal:"ALLOW",projectId,issuedAt:issuedAt.toISOString(),expiresAt:new Date(issuedAt.getTime()+ttlMs).toISOString(),scopeHash:sha256(scope)};}
