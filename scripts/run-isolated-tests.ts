import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
const isolated=parseEnv(readFileSync('.local/staging/test.env','utf8'));
for(const key of ['DATABASE_URL','PG_TEST_ADMIN_URL']){
 const url=new URL(isolated[key]??'');
 if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/nexora_test')throw new Error('Las pruebas requieren la base local nexora_test.');
}
const files=['tests/postgres.integration.ts','tests/postgres.traccar.ts','tests/postgres.company.ts','tests/postgres.client-profiles.ts','tests/live-portal.integration.ts','tests/postgres.rls.ts','tests/postgres.pagination.ts','tests/postgres.audit-fixes.ts'];
const child=spawn(process.execPath,['--test','--test-concurrency=1',...files],{env:{...process.env,...isolated},stdio:'inherit',windowsHide:true});child.on('exit',code=>process.exitCode=code??1);child.on('error',()=>process.exitCode=1);
