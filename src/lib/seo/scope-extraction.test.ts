import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHtml } from './html-parser';
import { auditHtmlExtraction, selectedCheckModules } from '../../workers/scalable-audit-worker';
import { makeAuditScope, AUDIT_CHECK_GROUPS } from '../audit/audit-scope';
import { toAuditDocument } from '../supabase/audit-repository';
import { runCheckSetSafely } from './checks/runner';
const html='<html><head><title>Fixture</title></head><body><main><h1>Hello</h1><a href="/next">Next</a><img src="/image"><input><script type="application/ld+json">{}</script></main></body></html>';
test('scope extraction preserves each selected check result and excludes unperformed evidence',()=>{
  const full=parseHtml(html,'https://example.com/');
  for(const group of AUDIT_CHECK_GROUPS){
    const audit=toAuditDocument({id:'fixture',effective_mode:'quick',plan:'free',audit_scope:makeAuditScope(group),normalized_url:'https://example.com/'})!;
    const extracted=parseHtml(html,audit.normalizedUrl,auditHtmlExtraction(audit,'2.2'));
    const modules=selectedCheckModules(audit,'2.2');
    const context={url:audit.normalizedUrl,finalUrl:audit.normalizedUrl,status:200,headers:{},loadTimeMs:100,pageSizeBytes:html.length};
    assert.deepEqual(runCheckSetSafely(modules,{...extracted,...context}),runCheckSetSafely(modules,{...full,...context}),group);
    assert.equal(extracted.topKeywords,undefined);
    if(group==='security'){
      assert.equal(extracted.accessibility,undefined);assert.equal(extracted.jsonLd,undefined);
      assert.equal(extracted.internalLinks,undefined);assert.equal(extracted.imageCount,undefined);
    }
  }
  const site=toAuditDocument({id:'fixture',effective_mode:'quick',audit_scope:makeAuditScope('security','site'),normalized_url:'https://example.com/'})!;
  assert.equal(parseHtml(html,site.normalizedUrl,auditHtmlExtraction(site,'2.2')).internalLinks?.length,1);
});
