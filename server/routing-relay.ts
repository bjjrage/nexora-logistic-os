import type {Request} from 'express';
import {authorize,type Actor} from './auth.ts';
import {DomainError,ensure} from './errors.ts';
/** Local OS shares the operational DB/session store but cannot resolve Railway private DNS. */
export async function relayRouting(req:Pick<Request,'headers'|'method'|'body'>,actor:Actor,kind:string,path:'/context'|'/search'|'/preview'|'/suggest'|'/organize',destination=process.env.ROUTING_REMOTE_OS_URL,fetcher:typeof fetch=fetch){
 if(!destination)return undefined;
 authorize(actor,['ADMIN','OPERATIONS']);
 ensure(kind==='postgres'&&process.env.NODE_ENV!=='production','ROUTING_CONFIGURATION','El enlace remoto de mapas es exclusivo del OS local con PostgreSQL.',503);
 const url=new URL(destination);ensure(url.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/','ROUTING_CONFIGURATION','El enlace remoto requiere el origen HTTPS del OS.',503);
 const cookie=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>/^logistics_session=[a-f0-9]{64}$/.test(x));
 ensure(cookie,'UNAUTHORIZED','Iniciá sesión nuevamente para usar los mapas.',401);
 const response=await fetcher(new URL('/api/routing'+path,url),{method:req.method,headers:{Cookie:cookie,Origin:url.origin,'X-Requested-With':'logistics-os','Content-Type':'application/json'},body:req.method==='GET'?undefined:JSON.stringify(req.body),signal:AbortSignal.timeout(path==='/organize'?120000:60000),redirect:'error'});
 const result=await response.json();
 if(!response.ok)throw new DomainError(result.error?.code??'ROUTING_UNAVAILABLE',result.error?.message??'El servidor de mapas no respondió.',response.status);
 return result;
}
