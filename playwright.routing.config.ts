import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/e2e',testMatch:['routing.spec.ts','routing-lifecycle.spec.ts'],fullyParallel:false,workers:1,retries:0,timeout:60000,
 use:{baseURL:'http://127.0.0.1:3047',timezoneId:'UTC',trace:'retain-on-failure',screenshot:'only-on-failure'},
 reporter:[['list']]});
