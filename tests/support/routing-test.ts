import {test as base,expect} from '@playwright/test';
import {startRoutingTestServer} from './routing-server.ts';

export const test=base.extend<{routingServer:Awaited<ReturnType<typeof startRoutingTestServer>>}>({
 routingServer:[async({},use)=>{
  const server=await startRoutingTestServer(3047);
  try{await use(server);}finally{await server.close();}
 },{auto:true}],
});

export {expect};
