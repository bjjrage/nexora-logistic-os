import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/e2e',fullyParallel:false,workers:1,retries:0,timeout:60000,
 use:{baseURL:'http://127.0.0.1:3039',trace:'retain-on-failure',screenshot:'only-on-failure',actionTimeout:15000},
 reporter:[['list']],webServer:{command:'node scripts/e2e-server.ts',url:'http://127.0.0.1:3039/api/session',reuseExistingServer:false,env:{NODE_ENV:'test'},timeout:30000}});
