import test from 'node:test';
import assert from 'node:assert/strict';
import { planSharedQuery, hashSharedQueryPlan } from '../src/shared-query-planner.mjs';
const vectors=[
 ['receipt: abcdef123456',1,'EXACT','FAST','B_250_CHUNK','154fbc413bc7bd12c4351896f40cfc36486ccab540b71791e09aa1903c6a1121'],
 ['what is the current status now?',1,'TEMPORAL','STANDARD','F_TEMPORAL_TRUTH','cfb2de2193f81ac958e3806a7470a2728211fb338a2ed724d2b8d0cdf7f72fea'],
 ['what are we using now?',1,'TEMPORAL','STANDARD','F_TEMPORAL_TRUTH','a5997b2f2b082ac539b4fa0fc5e730e44013ac01164bec5aaced0c2d355dbd97'],
 ['find the contradiction between these decisions',1,'CONTRADICTION','STANDARD','F_TEMPORAL_TRUTH','7e21f30073eb278ca6ff10300df9c307113b5798992634c640cdca4ca5d5eb58'],
 ['why did this fail and what repair worked?',1,'FAILURE','STANDARD','G_ADAPTIVE_HETEROGENEOUS','89c50b84de943790cd83bd6edd9423e354201b533b7809e974f5fa01442f93f4'],
 ['why does this module depend on the router?',1,'SEMANTIC','STANDARD','G_ADAPTIVE_HETEROGENEOUS','b97189fc0cce6ae6ea572d0d3ea7ca6ebc381b36e80e28b9a4f87e814ab591a2'],
 ['explain the memory architecture',1,'SEMANTIC','FAST','B_250_CHUNK','45114cd9bdb1e9323cde219ec377cbfc8a8dfb1393c0b34209ba54aefe7a6bf3'],
 ['deep archaeology trace back the full lineage',1,'GENEALOGY_ARCHAEOLOGY','DEEP','G_ADAPTIVE_HETEROGENEOUS','a88347173c462dc65276ab5b51a96d877af81f4028ccd8e1cb1e0323cebd5e13'],
 ['deep search implementation history',1,'GENEALOGY_ARCHAEOLOGY','DEEP','G_ADAPTIVE_HETEROGENEOUS','10f1c10c5917280ec5704b7b203d5fb8033978371ef02f991412ecf536fc08ce'],
 ['compare across projects',2,'MULTI_PROJECT','STANDARD','G_ADAPTIVE_HETEROGENEOUS','058b52514817e5c07f5faa44e8529308ce15bade697dc0d4a35b7797400ed59d'],
];
test('Phase 2 shared query planner vectors and hashes',()=>{for(const [q,n,c,m,r,h] of vectors){const p=planSharedQuery(q,{projectCount:n});assert.equal(p.queryClass,c);assert.equal(p.mode,m);assert.equal(p.route,r);assert.equal(hashSharedQueryPlan(p),h);}});
