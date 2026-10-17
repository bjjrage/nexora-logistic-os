import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import type {Request,Response,NextFunction} from 'express';

export const requestContext=new AsyncLocalStorage<{requestId:string;userId?:string;orgId?:string}>();
export class Diagnostics {
 readonly recent:Record<string,unknown>[]=[];
 private sink:(entry:Record<string,unknown>)=>void;
 constructor(sink:(entry:Record<string,unknown>)=>void=entry=>console.log(JSON.stringify(entry))){this.sink=sink;}
 emit(event:string,fields:Record<string,unknown>={}){
  const entry={at:new Date().toISOString(),event,release:process.env.RELEASE_SHA??'local',...requestContext.getStore(),...fields};
  if(event!=='http'){this.recent.push(entry);if(this.recent.length>100)this.recent.shift();}
  this.sink(entry);return entry;
 }
 middleware=(req:Request,res:Response,next:NextFunction)=>{
  const supplied=req.headers['x-request-id'];
  const requestId=typeof supplied==='string'&&/^[a-f0-9-]{36}$/i.test(supplied)?supplied:randomUUID();
  res.set('X-Request-Id',requestId);
  const start=performance.now();
  requestContext.run({requestId},()=>{
   res.once('finish',()=>{if(process.env.NODE_ENV==='production'||process.env.LOG_HTTP==='true'||res.statusCode>=500)this.emit('http',{method:req.method,route:req.route?.path??'unmatched',status:res.statusCode,durationMs:Math.round(performance.now()-start)});});
   next();
  });
 };
 error(error:unknown,req:Request){
  // Never log messages, query strings or bodies: provider/DB errors can contain personal data and credentials.
  const frames=error instanceof Error?error.stack?.split('\n').slice(1).flatMap(line=>{const match=line.match(/[/\\](server|tests|node_modules)[/\\]([a-zA-Z0-9_./\\-]+):(\d+):(\d+)\)?$/);return match?[`${match[1]}/${match[2].replaceAll('\\','/')}:${match[3]}:${match[4]}`]:[];}).slice(0,12):[];
  return this.emit('server.error',{route:req.route?.path??'unmatched',method:req.method,errorType:error instanceof Error?error.name:'UnknownError',frames});
 }
}

export class WindowLimiter {
 private entries=new Map<string,{count:number;until:number}>();
 private max:number;private windowMs:number;private capacity:number;
 constructor(max:number,windowMs:number,capacity=10000){this.max=max;this.windowMs=windowMs;this.capacity=capacity;}
 allow(key:string,at=Date.now()){
  if(this.entries.size>=this.capacity){for(const [id,entry]of this.entries)if(entry.until<=at)this.entries.delete(id);}
  let entry=this.entries.get(key);
  if(!entry||entry.until<=at){if(!entry&&this.entries.size>=this.capacity)return false;entry={count:0,until:at+this.windowMs};this.entries.set(key,entry);}
  return ++entry.count<=this.max;
 }
}
