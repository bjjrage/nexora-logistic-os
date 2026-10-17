import {spawn} from 'node:child_process';
const files=['tests/postgres.integration.ts','tests/postgres.traccar.ts','tests/postgres.company.ts','tests/postgres.client-profiles.ts','tests/live-portal.integration.ts','tests/postgres.rls.ts','tests/postgres.pagination.ts'];
const child=spawn(process.execPath,['--env-file=.local/staging/test.env','--test','--test-concurrency=1',...files],{stdio:'inherit',windowsHide:true});child.on('exit',code=>process.exitCode=code??1);child.on('error',()=>process.exitCode=1);
