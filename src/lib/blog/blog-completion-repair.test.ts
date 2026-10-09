import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('029 repairs skipped013 after015 without changing jobs, Groq health, or publication state', async () => {
  const db = new PGlite();
  const migration = (name: string) => readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8');
  const rows = async (sql: string, args: unknown[] = []) => (await db.query<Record<string, any>>(sql, args)).rows;
  const postId = randomUUID(), jobId = randomUUID();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to anon,authenticated,service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create table public.user_profiles(id uuid primary key);
      create function public.is_admin_user(uuid) returns boolean language sql stable as $$ select false $$;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key,bucket_id text);`);
    for (const name of ['007_blog_cms.sql','012_blog_automation_platform.sql','014_blog_provider_free_editorial_operations.sql','015_vercel_blog_workflow.sql']) {
      await db.exec(await migration(name));
    }
    await db.query(`insert into blog_posts(id,slug,title,status,scheduled_at) values($1,'held-article','Held article','scheduled',now()-interval '1 day')`,[postId]);
    await db.query(`insert into blog_generation_jobs(id,origin,state,idempotency_key,provider,model,workflow_stage,last_safe_error_code,error)
      values($1,'admin_manual','failed','repair-fixture','gemini','historic-model','quality_gate','BLOG_DATABASE_PGRST204','Missing completion columns')`,[jobId]);
    await db.exec(`insert into blog_provider_health(provider,model,status) values('groq','openai/gpt-oss-120b','connected');`);
    const snapshot = () => rows(`select jsonb_build_object(
      'posts',(select jsonb_agg(to_jsonb(p)-ARRAY['recommended_publication_at','publication_rule','publication_urgency','schedule_version','responsive_images']) from blog_posts p),
      'jobs',(select jsonb_agg(to_jsonb(j)-'generation_stages') from blog_generation_jobs j),
      'health',(select jsonb_agg(to_jsonb(h)) from blog_provider_health h),
      'healthConstraint',(select pg_get_constraintdef(oid) from pg_constraint where conrelid='blog_provider_health'::regclass and conname='blog_provider_health_provider_check'),
      'storage',(select jsonb_agg(to_jsonb(b)) from storage.buckets b)) snapshot`);
    const before = await snapshot();
    const repair = await migration('029_blog_completion_repair.sql');
    await db.exec(repair);
    await db.exec(repair);
    assert.deepEqual(await snapshot(),before);
    const settings = (await rows(`select * from blog_autopilot_settings where id='default'`))[0];
    assert.equal(settings.strict_autopilot_enabled,false);
    assert.equal(settings.required_reviewed_articles_before_autopublish,30);
    assert.equal(settings.automatic_articles_approved,0);
    assert.equal(settings.provider_enabled,false);
    assert.equal(settings.maintenance_mode,false);
    assert.equal(settings.emergency_pause,false);
    assert.equal(settings.provider_live_verification_status,'not_run');
    await assert.rejects(db.exec(`update blog_autopilot_settings set required_reviewed_articles_before_autopublish=29 where id='default'`),/check constraint/);
    const newJob = (await rows(`insert into blog_generation_jobs(origin,idempotency_key) values('admin_manual','future-groq') returning provider,model,prompt_version,execution_target,generation_stages`))[0];
    assert.deepEqual(newJob,{provider:'groq',model:'openai/gpt-oss-120b',prompt_version:'groq-vercel-v1',execution_target:'vercel',generation_stages:[]});
    const image = (await rows(`insert into blog_images(source_url) values('https://images.example/fixture.webp') returning id`))[0];
    await db.query(`insert into blog_competitor_research(article_id,reference_url,traffic_data_source,traffic_observed_at) values($1,'https://source.example/','',null)`,[postId]);
    await db.query(`update blog_posts set recommended_publication_at=now(),publication_rule='review_first',publication_urgency='normal',schedule_version=1,responsive_images='[]' where id=$1`,[postId]);
    await db.query(`update blog_generation_jobs set generation_stages='[{"stage":"quality_gate"}]' where id=$1`,[jobId]);
    await db.exec(`set role service_role`);
    await db.query(`insert into blog_section_revisions(article_id,section_key,action,before_html,after_html) values($1,'intro','rewrite','Before','After')`,[postId]);
    await assert.rejects(db.query(`insert into blog_section_revisions(article_id,section_key,action,before_html,after_html) values($1,'intro','rewrite','Before','After again')`,[postId]),/duplicate key/);
    await db.query(`insert into blog_image_variants(image_id,width,height,format,mime_type,file_size,storage_path,storage_url,content_hash)
      values($1,320,200,'webp','image/webp',100,'fixture.webp','https://images.example/fixture.webp','fixture-hash')`,[image.id]);
    assert.equal((await rows('select count(*)::int n from blog_image_variants'))[0].n,1);
    for (const role of ['anon','authenticated']) {
      await db.exec(`reset role; set role ${role}`);
      await assert.rejects(db.exec('select * from blog_section_revisions'),/permission denied/);
      await assert.rejects(db.exec('select * from blog_image_variants'),/permission denied/);
    }
    await db.exec('reset role');
    assert.ok((await rows(`select relrowsecurity from pg_class where oid in ('blog_section_revisions'::regclass,'blog_image_variants'::regclass)`)).every(row=>row.relrowsecurity));
    // Reapplication must preserve explicitly saved controls and provider diagnostic values.
    await db.exec(`update blog_autopilot_settings set provider_enabled=true,emergency_pause=true,provider_live_verification_status='connected' where id='default'`);
    await db.exec(repair);
    const saved = (await rows(`select provider_enabled,emergency_pause,provider_live_verification_status,strict_autopilot_enabled from blog_autopilot_settings where id='default'`))[0];
    assert.deepEqual(saved,{provider_enabled:true,emergency_pause:true,provider_live_verification_status:'connected',strict_autopilot_enabled:false});
  } finally { await db.close(); }
});
