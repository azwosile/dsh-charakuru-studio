// Cross-project account ledger. Manual account/quote facts are never presented as provider-verified balances.
import fs from 'node:fs/promises';
import { studioHome } from '../host/studio-home.js';
import path from 'node:path';
import crypto from 'node:crypto';
const finite = n => Number.isFinite(n) && n >= 0;
export function createAccountBudget(root=studioHome('accounts')) {
  async function locked(accountId,work) {
    if(typeof accountId!=='string'||!accountId.trim()||accountId.length>200)throw new Error('Provide a non-secret account alias');
    await fs.mkdir(root,{recursive:true});const key=crypto.createHash('sha256').update(accountId).digest('hex'),file=path.join(root,key+'.json'),lock=file+'.lock';
    let handle;
    for(let attempt=0;attempt<50;attempt++){
      try{handle=await fs.open(lock,'wx');break;}catch(e){if(e.code!=='EEXIST')throw e;await new Promise(r=>setTimeout(r,20));}
    }
    if(!handle)throw new Error('Account ledger busy or stale lock: reconcile the owning process before retrying');
    const temp=file+'.tmp-'+crypto.randomUUID();
    try{
      await handle.writeFile(JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));let state;
      try{state=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
      const out=await work(state);
      if(out.next){await fs.writeFile(temp,JSON.stringify(out.next,null,2),{flag:'wx'});await fs.rename(temp,file);}
      return out.result;
    }finally{await handle.close();await fs.rm(lock,{force:true});await fs.rm(temp,{force:true});}
  }
  function totals(state) {
    const entries=Object.values(state.entries);const spent=entries.filter(e=>e.state==='settled').reduce((n,e)=>n+e.actualCost,0),held=entries.filter(e=>['reserved','submitted','uncertain'].includes(e.state)).reduce((n,e)=>n+e.quotedCost,0);
    return {spent,held,available:Math.max(0,state.limit-spent-held),overLimit:spent+held>state.limit,balanceSource:'manual_not_provider_verified'};
  }
  return {
    configure({accountId,channel,period,limit,unit='credits'}) {return locked(accountId,async state=>{
      if(!['tripo_studio','tripo_api','image_api','local'].includes(channel)||!/^\d{4}-\d{2}$/.test(period)||!finite(limit)||typeof unit!=='string'||unit.length>30)throw new Error('Invalid account channel, period, unit or limit');
      if(state&&(state.channel!==channel||state.unit!==unit))throw new Error('Use separate aliases for distinct channels/currencies');
      if(state&&state.period!==period&&totals(state).held>0)throw new Error('Unresolved operations must be reconciled before rolling the billing period');
      const next=state&&state.period===period?{...state,limit}:{version:1,accountId,channel,period,limit,unit,entries:{},createdAt:new Date().toISOString()};
      return {next,result:{...next,...totals(next)}};
    });},
    status(accountId) {return locked(accountId,async state=>{if(!state)throw new Error('Configure account ledger first');return {result:{...state,...totals(state)}};});},
    reserve({accountId,requestId,fingerprint,quotedCost,quoteExpiresAt,projectId}) {return locked(accountId,async state=>{
      if(!state)throw new Error('Configure account ledger first');if(!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)||!/^([a-f0-9]{64})$/.test(fingerprint)||!finite(quotedCost))throw new Error('Invalid request identity or quote');
      const previous=state.entries[requestId];
      if(previous){if(previous.fingerprint!==fingerprint||previous.quotedCost!==quotedCost)throw new Error('Idempotency identity conflicts with a different request');return {result:{entry:previous,duplicate:true,...totals(state)}};}
      if(!Number.isFinite(Date.parse(quoteExpiresAt))||Date.parse(quoteExpiresAt)<=Date.now())throw new Error('Quote expired; refresh explicit cost estimate');
      if(Object.keys(state.entries).length>=10000)throw new Error('Ledger needs archival before new submissions');
      if(quotedCost>totals(state).available||totals(state).overLimit)throw new Error('Account budget exceeded');
      const entry={requestId,fingerprint,projectId:String(projectId||''),quotedCost,state:'reserved',createdAt:new Date().toISOString(),quoteExpiresAt};state.entries[requestId]=entry;
      return {next:state,result:{entry,duplicate:false,...totals(state)}};
    });},
    transition({accountId,requestId,action,actualCost,providerTaskId,confirmedNotCharged=false}) {return locked(accountId,async state=>{
      const entry=state?.entries[requestId];if(!entry)throw new Error('Unknown account operation');
      if(action==='submit'){
        if(entry.state!=='reserved')throw new Error('Request already submitted or closed; do not resubmit');
        if(Date.parse(entry.quoteExpiresAt)<=Date.now())throw new Error('Quote expired before submission');entry.state='submitted';
      }else if(action==='uncertain'){
        if(!['submitted','uncertain'].includes(entry.state))throw new Error('Only a submitted request can become uncertain');entry.state='uncertain';
      }else if(action==='settle'){
        if(!finite(actualCost))throw new Error('Actual charge must be non-negative');
        if(entry.state==='settled'){if(entry.actualCost!==actualCost||entry.providerTaskId!==(providerTaskId||null))throw new Error('Conflicting settlement');return {result:{entry,duplicate:true,...totals(state)}};}
        if(!['submitted','uncertain'].includes(entry.state))throw new Error('Cannot settle an unsubmitted request');
        if(providerTaskId&&Object.values(state.entries).some(e=>e.requestId!==requestId&&e.providerTaskId===providerTaskId))throw new Error('Provider task already accounted for in another request');
        entry.state='settled';entry.actualCost=actualCost;entry.providerTaskId=providerTaskId||null;
      }else if(action==='cancel'){
        if(entry.state==='reserved')entry.state='cancelled';
        else if(['submitted','uncertain'].includes(entry.state)&&confirmedNotCharged)entry.state='cancelled';
        else throw new Error('Submitted cancellation is not proof of zero billing; keep funds held until reconciled');
      }else throw new Error('Unknown ledger transition');
      entry.updatedAt=new Date().toISOString();return {next:state,result:{entry,...totals(state)}};
    });}
  };
}
