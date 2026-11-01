import {test as base,expect} from '@playwright/test';
import {startE2EServer} from './e2e-server.ts';

export const test=base.extend<{e2eServer:void}>({
 e2eServer:[async({},use)=>{
  const server=await startE2EServer();
  try{await use();}finally{await server.close();}
 },{auto:true}],
});

export {expect};
