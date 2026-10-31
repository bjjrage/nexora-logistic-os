import type {Database,Row} from './database.ts';
import type {Actor} from './auth.ts';
import {signature} from './dispatch-append.ts';
export const batchOrderIds=(proposal:Row):string[]=>[...new Set<string>((proposal.proposedRoutes??[]).flatMap((r:Row)=>r.stops.map((s:Row)=>s.orderId)))];
export const batchScopeSignature=(orders:Row[],ids:string[])=>signature(orders.filter(o=>ids.includes(o.id)));
export const holdsBatchOrders=(batch:Row)=>batch.status==='PENDING'||batch.persistentBatch&&['EXPIRED','CHANGED'].includes(batch.status);
export function batchConflict(proposal:Row,batches:Row[],exclude?:string){
 const ids=batchOrderIds(proposal),start=Date.parse(proposal.schedule.startAt),end=Date.parse(proposal.schedule.endAt);
 return batches.find(b=>b.id!==exclude&&holdsBatchOrders(b)&&(batchOrderIds(b).some(id=>ids.includes(id))||b.status==='PENDING'&&Date.parse(b.schedule.startAt)<end&&Date.parse(b.schedule.endAt)>start&&b.proposedRoutes.some((r:Row)=>proposal.proposedRoutes.some((s:Row)=>s.vehicleId===r.vehicleId||s.driverId===r.driverId))));
}
/** Immutable command records retain every batch, including expired and replaced proposals. */
export async function dispatchBatches(db:Database,actor:Actor,orders:Row[]){
 const entries=await db.all("SELECT i.operation,i.response,i.actor_id,a.created_at,u.name AS creator FROM idempotency i JOIN audit a ON a.org_id=i.org_id AND a.command_id=i.command_id LEFT JOIN users u ON u.id=i.actor_id AND u.org_id=i.org_id WHERE i.org_id=? AND i.operation IN('routing.organizeReserved','routing.approveReserved','routing.discardReserved') ORDER BY a.created_at,a.rowid",actor.orgId);
 const approved=new Map<string,Row>(),discarded=new Set<string>(),replaced=new Map<string,string>(),sources:Row[]=[];
 for(const row of entries){const result=JSON.parse(row.response);if(row.operation==='routing.approveReserved')approved.set(result.proposalCommandId,result);else if(row.operation==='routing.discardReserved')discarded.add(result.proposalCommandId);else if(result.proposedRoutes?.length){sources.push({...result,createdAt:row.created_at,creator:row.creator,actorId:row.actor_id});if(result.replacesProposalId)replaced.set(result.replacesProposalId,result.id);}}
 const batches:Row[]=[];
 for(const [index,source] of sources.entries()){
  const ids=batchOrderIds(source),approval=approved.get(source.id),replacement=replaced.get(source.id),available=ids.filter(id=>orders.some(o=>o.id===id));
  let status=approval?'APPROVED':discarded.has(source.id)?'DISCARDED':replacement?'REPLACED':Date.parse(source.validUntil)<=Date.now()?'EXPIRED':available.length!==ids.length||source.selectedOrderSignature&&source.selectedOrderSignature!==batchScopeSignature(orders,ids)?'CHANGED':'PENDING';
  batches.push({...source,batchNumber:index+1,status,canManage:source.actorId===actor.id||actor.role==='ADMIN',availableOrderIds:available,approvedRoutes:approval?.routes??[],replacedBy:replacement??null,conflictWith:null});
 }
 const priority=(batch:Row):number=>{const parent=batches.find(b=>b.id===batch.replacesProposalId);return parent?priority(parent):batch.batchNumber;};
 const accepted:Row[]=[];for(const batch of [...batches].sort((a,b)=>priority(a)-priority(b)||a.batchNumber-b.batchNumber)){if(!holdsBatchOrders(batch))continue;const conflict=batchConflict(batch,accepted);if(conflict){batch.status='CONFLICT';batch.conflictWith=conflict.batchNumber;}else accepted.push(batch);}
 return batches;
}
