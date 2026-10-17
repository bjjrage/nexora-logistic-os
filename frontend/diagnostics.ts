export function reportClientError(kind:'UI_ERROR'|'UNHANDLED_REJECTION'|'API_ERROR',component:string,requestId?:string,position?:{file:string;line:number;column:number}){
 // Send identifiers, never form values, URLs with query strings, exception messages or tokens.
 void fetch('/api/diagnostics/events',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Requested-With':'logistics-os'},body:JSON.stringify({kind,component,...(requestId?{requestId}:{}),...(position?{position}:{})}),signal:AbortSignal.timeout(5000)}).catch(()=>{});
}
export function sourcePosition(stack?:string){const match=stack?.match(/\/assets\/(index-[a-zA-Z0-9_-]+\.js):(\d+):(\d+)/);return match?{file:match[1],line:Number(match[2]),column:Number(match[3])}:undefined;}
