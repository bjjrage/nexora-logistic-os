import {defineConfig} from '@playwright/test';
process.env.ROUTING_E2E='true';
export default defineConfig({testDir:'./tests/e2e',testMatch:'routing.spec.ts',workers:1,retries:0,timeout:60000,
 use:{baseURL:'http://127.0.0.1:3047',timezoneId:'UTC',trace:'retain-on-failure',screenshot:'only-on-failure'},
 reporter:[['list']]});
