// Official SDK client with bare npm argv. No npm-stdio helper or reaper here.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { monitorOwnedProcesses } from '../../tests/processes.mjs';
import { sha256, canonical } from '../../tests/oracle.mjs';
const O=new URL('.',import.meta.url).pathname;
const S=JSON.parse(readFileSync(O+'SCRATCH.json')).path;
const F=JSON.parse(readFileSync(O+'../ROOT3124/FROZEN-CASE.json'));
const command=JSON.parse(readFileSync(O+'SCRATCH.json')).readmeCommand;
const args=command.replaceAll('\\\n','').trim().split(/\s+/).slice(1);
args.splice(1,0,'--offline');
const env={PATH:process.env.PATH,HOME:S+'/home',NODE_OPTIONS:'--max-old-space-size=256',
 npm_config_ignore_scripts:'true',npm_config_userconfig:S+'/empty.npmrc',npm_config_globalconfig:S+'/absent-global.npmrc',
 npm_config_update_notifier:'false',npm_config_fetch_retries:'0'};
const rows=[];
const payload=r=>{assert.notEqual(r.isError,true);assert.deepEqual(JSON.parse(r.content[0].text),r.structuredContent);return r.structuredContent;};
const useful=async client=>{const c=F.cases[0];assert.deepEqual(payload(await client.callTool({name:c.name,arguments:c.args})),c.expected);};
const refusal=async client=>{const b=await client.callTool({name:F.refusal.name,arguments:F.refusal.args});assert.equal(b.isError,true);assert.ok(!JSON.stringify(b).includes('root3124-synthetic-do-not-echo'));return b;};
const schema={type:'object',properties:{value:{type:'string',pattern:'^(a+)+$'}},required:['value'],additionalProperties:false};
const hostile={name:'accept_output',arguments:{schema,schemaDigest:sha256(canonical(schema)),output:{value:'a'.repeat(128)+'!'}}};
for(const era of ['legacy','modern']) for(const mode of ['close','pending-close','recovery']) {
 const record={era,mode,command:'npm',args,cwd:S+'/consumer'};const finish=monitorOwnedProcesses();
 const transport=new StdioClientTransport({command:'npm',args,cwd:S+'/consumer',env,stderr:'pipe'});
 let stderr='';transport.stderr.on('data',b=>stderr+=b);
 const client=new Client({name:'root5180-bare-npm',version:'1'},{versionNegotiation:{mode:era==='legacy'?'legacy':{pin:'2026-07-28'}},...(era==='legacy'?{supportedProtocolVersions:['2025-06-18']}:{})});
 try {
  await client.connect(transport,{timeout:5000});record.negotiated=client.getNegotiatedProtocolVersion();
  assert.deepEqual((await client.listTools()).tools.map(x=>x.name).sort(),F.inventoryNames);
  await useful(client);record.useful=true;record.refusal=await refusal(client);
  if(mode==='pending-close') {
   const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),150);const started=performance.now();
   try{await assert.rejects(client.callTool(hostile,{signal:ctl.signal,timeout:5000}));}finally{clearTimeout(t);}
   await useful(client);record.cancelAndRecoveryMs=Math.round(performance.now()-started);assert.ok(record.cancelAndRecoveryMs<1000);
   const pending=client.callTool(hostile).then(()=> 'answered',()=> 'disconnected');
   await new Promise(r=>setTimeout(r,150));const start=performance.now();await client.close();
   record.pending=await pending;record.closeMs=Math.round(performance.now()-start);assert.equal(record.pending,'disconnected');assert.ok(record.closeMs<1000);
  }
  record.ok=true;
 } catch(e) {record.error=String(e);process.exitCode=1;}
 finally {
  await client.close();await transport.close();record.lifecycle=await finish();record.stderr=stderr;rows.push(record);
  writeFileSync(O+'SDK-CASES.json',JSON.stringify({rows},null,2)+'\n');
 }
 console.log(JSON.stringify({era,mode,ok:record.ok,lifecycle:record.lifecycle,...(record.error?{error:record.error}:{})}));
}
