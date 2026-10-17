export type ApiProblem=Error&{code?:string;details?:unknown;status?:number};

export async function api<T>(path:string,init?:RequestInit,options:{timeoutMs?:number;fetcher?:typeof fetch}={}):Promise<T>{
 const controller=new AbortController(),fetcher=options.fetcher??fetch;
 let timedOut=false,timer:ReturnType<typeof setTimeout>|undefined;
 const cancel=()=>controller.abort(init?.signal?.reason);
 if(init?.signal?.aborted)cancel();else init?.signal?.addEventListener('abort',cancel,{once:true});
 const timeoutError=()=>Object.assign(new Error(init?.method&&!['GET','HEAD'].includes(init.method.toUpperCase())
  ?'El servidor demoró demasiado en responder. El guardado puede haberse completado: actualizá la lista antes de reintentar.'
  :'La consulta tardó demasiado. Volvé a actualizar la información.'),{code:'REQUEST_TIMEOUT'});
 try{
  const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{timedOut=true;controller.abort();reject(timeoutError());},options.timeoutMs??30000);});
  const request=(async()=>{
   const response=await fetcher(path,{credentials:'same-origin',...init,signal:controller.signal});
   const body=await response.json().catch(()=>null);
   if(!response.ok){const error=new Error(body?.error?.message||'No se pudo completar la solicitud.') as ApiProblem;error.code=body?.error?.code;error.details=body?.error?.details;error.status=response.status;throw error;}
   if(body===null)throw Object.assign(new Error('El servidor devolvió una respuesta incompleta. Actualizá la información.'),{code:'INVALID_RESPONSE'});
   return body as T;
  })();
  return await Promise.race([request,deadline]);
 }catch(error){if(timedOut)throw timeoutError();throw error;}
 finally{clearTimeout(timer);init?.signal?.removeEventListener('abort',cancel);}
}
