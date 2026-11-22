import { Router, type Express, type Request } from 'express';
import { z } from 'zod';
import { authorize, type Actor } from './auth.ts';
import type { Database } from './database.ts';
import { crmSchemas } from './crm-contract.ts';
import { crmRoles, Prospecting } from './crm.ts';

export function installProspectingRoutes(app: Express, db: Database, auth: (request: Request) => Promise<Actor>) {
  const router = Router();
  const crm = new Prospecting(db);
  const id = (request: Request) => z.uuid().parse(request.params.id);
  const actor = (response: { locals: Record<string, unknown> }) => response.locals.crmActor as Actor;

  router.use(async (request, response, next) => {
    const user = await auth(request);
    authorize(user, crmRoles);
    response.locals.crmActor = user;
    next();
  });

  router.get('/prospects', async (req, res) => res.json(await crm.list(actor(res), crmSchemas.list.parse(req.query))));
  router.get('/dashboard', async (req, res) => res.json(await crm.dashboard(actor(res), crmSchemas.list.parse(req.query))));
  router.get('/options', async (_req, res) => res.json(await crm.options(actor(res))));
  router.get('/tasks', async (req, res) => res.json(await crm.tasks(actor(res), crmSchemas.taskList.parse(req.query))));
  router.get('/prospects/:id', async (req, res) => res.json(await crm.detail(actor(res), id(req))));
  router.get('/prospects/:id/timeline', async (req, res) =>
    res.json(await crm.timeline(actor(res), id(req), crmSchemas.timeline.parse(req.query))));
  router.get('/prospects/:id/tasks', async (req, res) =>
    res.json(await crm.tasks(actor(res), crmSchemas.taskList.parse(req.query), id(req))));

  router.post('/prospects', async (req, res) =>
    res.status(201).json(await crm.create(actor(res), crmSchemas.create.parse(req.body))));
  router.put('/prospects/:id', async (req, res) =>
    res.json(await crm.update(actor(res), id(req), crmSchemas.update.parse(req.body))));
  router.post('/prospects/:id/stage', async (req, res) =>
    res.json(await crm.transition(actor(res), id(req), crmSchemas.stage.parse(req.body))));
  router.post('/prospects/:id/contacts', async (req, res) =>
    res.status(201).json(await crm.saveContact(actor(res), id(req), crmSchemas.contact.parse(req.body))));
  router.put('/prospects/:id/contacts/:contactId', async (req, res) =>
    res.json(await crm.saveContact(actor(res), id(req), crmSchemas.contact.parse(req.body), z.uuid().parse(req.params.contactId))));
  router.post('/prospects/:id/activities', async (req, res) =>
    res.status(201).json(await crm.activity(actor(res), id(req), crmSchemas.activity.parse(req.body))));
  router.post('/prospects/:id/tasks', async (req, res) =>
    res.status(201).json(await crm.createTask(actor(res), id(req), crmSchemas.task.parse(req.body))));
  router.post('/tasks/:id/complete', async (req, res) =>
    res.json(await crm.completeTask(actor(res), id(req), crmSchemas.done.parse(req.body))));
  router.post('/import/preview', async (req, res) =>
    res.json(await crm.preview(actor(res), crmSchemas.csv.parse(req.body).csv)));
  router.post('/import', async (req, res) =>
    res.status(201).json(await crm.import(actor(res), crmSchemas.import.parse(req.body))));

  app.use('/api/crm', router);
}
