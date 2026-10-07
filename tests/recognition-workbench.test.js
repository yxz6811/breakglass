const test=require('node:test'); const assert=require('node:assert/strict');
const workbench=require('../learning-site/recognition-workbench.js');
const source={kind:'local-file',id:'file-'+'a'.repeat(64),version:'1',analysisVersion:'1',materialMode:'self-authored',title:'自制测试'};
const reply=()=>({schemaVersion:'011.1',requestId:'test-read',sourceId:source.id,videoVersion:'1',analysisVersion:'1',kind:'parabola',frameTime:2,
 frameSize:{width:3024,height:1898},jpegSize:{width:640,height:402},status:'candidate',candidate:{template:'parabola',snapshot:{a:1,h:0,k:1}},
 evidence:{formulaBasis:'visible-equation',mathStatus:'consistent',placementStatus:'unknown',map:null,calibrationBasis:'none',profileVersion:'recognition-profile-v1',promptVersion:'recognition-prompt-v1',calibrationVersion:'recognition-calibration-v1'},limitations:['placement_unknown','student_confirmation_required']});
const meta={id:'student-record',createdAt:'2026-10-07T00:00:00.000Z'};
test('student correction preserves original candidate separately and never asserts pixel alignment',()=>{
 const input=reply(),record=workbench.confirmedRecord(input,{a:2,h:1,k:3},source,meta), provenance=workbench.provenanceMetadata(input,record);
 assert.deepEqual(record.snapshot,{a:2,h:1,k:3}); assert.deepEqual(provenance.originalSnapshot,{a:1,h:0,k:1});
 assert.equal(provenance.placementStatus,'unknown');assert.equal(provenance.map,null);assert.equal(provenance.confirmation,'student');
 assert.equal(provenance.attribution,'student-confirmed-candidate');assert.match(record.sourceLabel,/位置待校对/);
});
test('wrong source, unsupported candidate and nonfinite correction cannot make confirmed records',()=>{
 assert.throws(()=>workbench.confirmedRecord(reply(),{a:1,h:0,k:1},{...source,id:'file-'+'b'.repeat(64)},meta),/来源/);
 assert.throws(()=>workbench.confirmedRecord({...reply(),candidate:null}, {a:1,h:0,k:1},source,meta),/有限/);
 assert.throws(()=>workbench.confirmedRecord(reply(),{a:Infinity,h:0,k:1},source,meta));
 assert.throws(()=>workbench.confirmedRecord(reply(),{a:0,h:0,k:1},source,meta));
 assert.throws(()=>workbench.confirmedRecord(reply(),{a:1,h:1000001,k:1},source,meta));
});
test('a finite human map uses independent scales and is attributed to student calibration',()=>{
 const input=reply(),record=workbench.confirmedRecord(input,input.candidate.snapshot,source,meta),map={ox:700,oy:1200,sx:80,sy:160};
 assert.equal(workbench.provenanceMetadata(input,record,map).placementStatus,'student-calibrated');
 assert.throws(()=>workbench.provenanceMetadata(input,record,{...map,sx:0}));
});
