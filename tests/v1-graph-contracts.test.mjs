import test from 'node:test';
import assert from 'node:assert/strict';
import { validateR1Graph, validateR2Graph } from '../src/graph-contracts.mjs';

test('R1 graph rejects dangling edges', () => {
  const graph={format:'B2_R1_GRAPH',version:1,graphVersion:'B2_R1_GRAPH_V1',nodes:[{id:'n1'}],edges:[{id:'e1',from:'n1',to:'missing',type:'SUPPORTS'}]};
  assert.throws(()=>validateR1Graph(graph),/missing node/);
});

test('R2 graph must be bounded to R1 and cannot self-promote', () => {
  const r1={format:'B2_R1_GRAPH',version:1,graphVersion:'B2_R1_GRAPH_V1',nodes:[{id:'r1'}],edges:[]};
  const valid={format:'B2_R2_GRAPH',version:1,graphVersion:'B2_R2_GRAPH_V1',nodes:[{id:'r2',derivedFrom:['r1'],metadata:{}}],edges:[]};
  assert.equal(validateR2Graph(valid,r1).ok,true);
  assert.throws(()=>validateR2Graph({...valid,nodes:[{id:'bad',derivedFrom:['missing']}]},r1),/not evidence-bounded/);
  assert.throws(()=>validateR2Graph({...valid,nodes:[{id:'bad2',derivedFrom:['r1'],metadata:{currentTruth:true}}]},r1),/Current Truth promotion/);
});
