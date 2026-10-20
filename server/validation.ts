import { z } from 'zod';
const text=z.string().trim().min(1).max(500);
const id=z.uuid();
const command={commandId:id};
const version={...command,expectedVersion:z.number().int().positive()};
const positive=z.number().int().positive().max(1_000_000_000);
const datetime=z.string().datetime({offset:true}).transform(value=>new Date(value).toISOString());
const password=z.string().min(6).max(128);
const username=z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9_.@-]+$/);
export const schemas={
  setup:z.object({organizationName:text,timezone:text,username,password}),
  login:z.object({username,password:z.string().min(1).max(128)}),
  client:z.object({...command,name:text,legalName:z.string().trim().max(500).optional(),taxId:z.string().trim().max(80).optional(),contactName:z.string().trim().max(200).optional(),phone:z.string().trim().max(80).optional(),email:z.union([z.literal(''),z.email().max(254)]).optional(),address:z.string().trim().max(500).optional(),city:z.string().trim().max(160).optional(),notes:z.string().trim().max(2000).optional()}),
  driver:z.object({...command,name:text,username,password}),
  user:z.object({...command,name:text,username,password,role:z.enum(['ADMIN','OPERATIONS','DEPOT'])}),
  vehicle:z.object({...command,plate:text,capacityWeightGrams:positive,capacityVolumeCm3:positive,odometer:z.number().int().nonnegative()}),
  shipment:z.object({...command,clientId:id,reference:text,originText:text,destinationText:text,recipientName:text,recipientPhone:z.string().trim().max(80).default(''),parcelCount:z.number().int().min(1).max(200),weightGrams:positive.nullable(),volumeCm3:positive.nullable(),proofPolicy:z.enum(['RECEIVER','RECEIVER_PHOTO'])}),
  receipt:z.object({...command,shipmentId:id,codes:z.array(text).min(1).max(200),location:text}),
  route:z.object({...command,name:text,driverId:id,vehicleId:id,startAt:datetime,endAt:datetime}),
  assign:z.object({...version,parcelIds:z.array(id).min(1).max(200),pickup:z.boolean().default(false)}),
  order:z.object({...version,stopIds:z.array(id).min(1).max(400)}),
  version:z.object(version),
  load:z.object({...version,code:text}),
  pickup:z.object({...version,codes:z.array(text).min(1).max(200)}),
  attempt:z.object({...version,deliveredParcelIds:z.array(id).max(200),failedParcelIds:z.array(id).max(200),receiverName:z.string().trim().max(500).default(''),evidenceIds:z.array(id).max(200).default([]),reasonCode:z.enum(['','ABSENT','REFUSED','ADDRESS_ISSUE','DAMAGED','OTHER']).default(''),nextAction:z.string().trim().max(1000).default('')}),
  command:z.object(command),
  returnReceive:z.object({...command,location:text,evidenceId:id.optional()}),
  returnSender:z.object({...command,receiverName:text,evidenceId:id}),
  inspection:z.object({...command,odometer:z.number().int().nonnegative(),fuelPercent:z.number().int().min(0).max(100),items:z.array(z.object({label:text,severity:z.enum(['OK','MINOR','CRITICAL']),note:z.string().trim().max(1000).default('')})).min(1).max(50)}),
  document:z.object({...command,name:text,expiresAt:datetime,blocksDispatch:z.boolean()}),
  renewDocument:z.object({...command,expiresAt:datetime}),
  resolve:z.object({...command,evidenceId:id,note:text}),
  maintenance:z.object({...command,description:text,dueAt:datetime.nullable().default(null),dueOdometer:z.number().int().nonnegative().nullable().default(null)}),
  evidence:z.object({...command,parcelId:id.nullable().optional(),filename:z.string().trim().min(1).max(180),mimeType:z.enum(['image/jpeg','image/png','image/webp']),dataBase64:z.string().min(1).max(7_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/)}),
};
