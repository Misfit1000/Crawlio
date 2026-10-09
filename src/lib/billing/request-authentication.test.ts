import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getAuthenticatedUserFromRequest, ensureUserProfileFromAuthUser } from './entitlements';
test('authentication/profile reads share only a single request and suspension is checked again',async context=>{
  const saved=[process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY];
  process.env.SUPABASE_URL='https://request-auth-fixture.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-key';
  context.after(()=>{[process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY]=saved;});
  let authReads=0,profileReads=0,disabled=false;
  context.mock.method(globalThis,'fetch',async (input:RequestInfo|URL,options?:RequestInit)=>{
    const request=new Request(input,options),url=new URL(request.url);
    assert.equal(url.hostname,'request-auth-fixture.supabase.co');
    let body:unknown;
    if(url.pathname==='/auth/v1/user'){
      authReads++;body={id:'fixture-user',email:'fixture@example.net',user_metadata:{}};
    }else{
      assert.equal(url.pathname,'/rest/v1/user_profiles');assert.equal(request.method,'GET');
      profileReads++;body={id:'fixture-user',email:'fixture@example.net',role:'user',plan:'free',full_name:'Fixture',disabled};
    }
    return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
  });
  const req={headers:{authorization:'Bearer fixture-token'}};
  const users=await Promise.all([getAuthenticatedUserFromRequest(req),getAuthenticatedUserFromRequest(req)]);
  assert.equal(users[0],users[1]);assert.equal(authReads,1);
  await Promise.all(users.map(user=>ensureUserProfileFromAuthUser(user!)));
  assert.equal(profileReads,1);
  disabled=true;
  const nextUser=await getAuthenticatedUserFromRequest({headers:{authorization:'Bearer fixture-token'}});
  await assert.rejects(ensureUserProfileFromAuthUser(nextUser!),/temporarily unavailable/);
  assert.equal(authReads,2);assert.equal(profileReads,2);
  req.headers.authorization='Bearer replacement-token';
  await getAuthenticatedUserFromRequest(req);assert.equal(authReads,3);
});
