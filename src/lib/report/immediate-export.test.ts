import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeAuditScope } from '../audit/audit-scope';
import { toAuditDocument } from '../supabase/audit-repository';
import { prepareImmediateExport, type ImmediateExportDependencies } from './immediate-export';

const audit = toAuditDocument({id:'fixture-audit',hostname:'example.com',normalized_url:'https://example.com/',
  status:'completed',processing_version:2,audit_scope:makeAuditScope('security'),page_limit:1})!;
function fixture() {
  const rows: Record<string, any[]> = {
    pages:[{id:'p1',url:'https://example.com/',statusCode:200,title:'Not selected',responseTimeMs:10}],
    issues:Array.from({length:125},(_,i)=>({id:`i${String(i).padStart(4,'0')}`,category:'security',severity:'low',title:`Finding ${i}`,affectedUrl:'https://example.com/'})),
    events:[{id:'e1',type:'score_updated',message:'Measured',data:{secret:'private'}}],
  };
  const dependencies: ImmediateExportDependencies = {
    count:async (_id,section)=>rows[section].length,
    report:async()=>null,
    read:async (_id,section,cursor)=>{
      const start=cursor ? rows[section].findIndex(item=>item.id===cursor)+1 : 0;
      const items=rows[section].slice(start,start+50);
      return {items,nextCursor:start+50<rows[section].length ? items.at(-1).id : null};
    },
  };
  return {rows,dependencies};
}
test('immediate JSON includes all cursor findings and only selected public evidence',async()=>{
  const {dependencies}=fixture();
  const result=await prepareImmediateExport(audit,'json',dependencies);
  assert.ok(result);
  const exported=JSON.parse(result.body.toString()).data;
  assert.equal(exported.issues.length,125);
  assert.equal(exported.pages.length,1);
  assert.equal('title' in exported.pages[0],false);
  assert.equal('responseTimeMs' in exported.pages[0],false);
  assert.equal('data' in exported.events[0],false);
});
test('capacity, bytes, time, and incomplete cursor evidence select background preparation',async()=>{
  const f=fixture();
  f.dependencies.count=async (_id,section)=>section==='issues' ? 1001 : 1;
  assert.equal(await prepareImmediateExport(audit,'json',f.dependencies),null);
  const large=fixture(); large.rows.issues[0].description='x'.repeat(2*1024*1024);
  assert.equal(await prepareImmediateExport(audit,'json',large.dependencies),null);
  const late=fixture(); let clock=0; late.dependencies.now=()=>clock;
  late.dependencies.report=async()=>{clock=4000;return null;};
  assert.equal(await prepareImmediateExport(audit,'json',late.dependencies),null);
  const inconsistent=fixture(); inconsistent.dependencies.count=async()=>1;
  assert.equal(await prepareImmediateExport(audit,'json',inconsistent.dependencies),null);
});
test('active audits are not exported and scope/CSV guards are retained',async()=>{
  const {dependencies,rows}=fixture();
  assert.equal(await prepareImmediateExport({...audit,status:'running'},'json',dependencies),null);
  await assert.rejects(prepareImmediateExport(audit,'sitemap.xml',dependencies),/EXPORT_SCOPE_NOT_INCLUDED/);
  rows.issues[0].title='=IMPORTXML("unsafe")';
  const csv=await prepareImmediateExport(audit,'issues.csv',dependencies);
  assert.ok(csv?.body.toString().includes("'=IMPORTXML"));
  const controller=new AbortController(); controller.abort();
  await assert.rejects(prepareImmediateExport(audit,'json',dependencies,controller.signal),/abort/i);
});
