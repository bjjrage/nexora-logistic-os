import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authorize, hash, type Actor, type Role } from './auth.ts';
import { camel } from './db.ts';
import type { Database, Row, SqlValue } from './database.ts';
import { Logistics } from './domain.ts';
import { DomainError, ensure } from './errors.ts';
import {
  companyKeys, crmSchemas, crmStages, normalize, parseCrmCsv, type CrmImportIssue, type ProspectFields,
} from './crm-contract.ts';

export const crmRoles: Role[] = ['ADMIN', 'OPERATIONS'];
type Filters = z.output<typeof crmSchemas.list>;
type Pagination = z.output<typeof crmSchemas.timeline>;
type Identified = { id: string; data: ProspectFields; ownerId: string };

const now = () => new Date().toISOString();
const equality = {
  source: 'p.source', campaign: 'p.campaign', sector: 'p.sector', city: 'p.city',
  department: 'p.department', stage: 'p.stage', ownerId: 'p.owner_id',
} as const;
const companyColumns = [
  'name', 'sector', 'city', 'department', 'source', 'campaign', 'facebook', 'instagram', 'website', 'phone', 'email',
] as const;
const companyData = [...companyColumns, 'owner_id', 'tags', 'notes', 'search_text'];
const pagination = (rows: Row[], count: Row | undefined, query: Pagination) => ({
  rows: rows.map(camel), total: Number(count?.total ?? 0), limit: query.limit, offset: query.offset,
});

function filtered(orgId: string, filters: Filters) {
  const clauses = ['p.org_id=?'];
  const values: SqlValue[] = [orgId];
  for (const [key, column] of Object.entries(equality) as [keyof typeof equality, string][]) {
    if (!filters[key]) continue;
    clauses.push(column + '=?');
    values.push(filters[key]!);
  }
  const escape = (value: string) => value.replace(/[!%_]/g, '!$&');
  if (filters.q) {
    clauses.push("p.search_text LIKE ? ESCAPE '!'");
    values.push('%' + escape(normalize(filters.q)) + '%');
  }
  if (filters.tag) {
    clauses.push("p.tags LIKE ? ESCAPE '!'");
    values.push('%' + escape(JSON.stringify(filters.tag.trim())) + '%');
  }
  return { where: clauses.join(' AND '), values };
}

function describe(row: Row) {
  const signals = [
    { field: 'sector', points: 15, present: Boolean(row.sector) },
    { field: 'location', points: 15, present: Boolean(row.city && row.department) },
    { field: 'digital', points: 25, present: Boolean(row.instagram || row.facebook || row.website) },
    { field: 'channel', points: 25, present: Boolean(row.phone || row.email) },
    { field: 'source', points: 20, present: Boolean(row.source || row.campaign) },
  ];
  return {
    ...camel(row), id: String(row.id), tags: JSON.parse(row.tags) as string[],
    score: signals.reduce((total, signal) => total + (signal.present ? signal.points : 0), 0),
    signals, recordType: 'PROSPECT',
  };
}

function companyValues({data, ownerId}: Identified): SqlValue[] {
  const tags = [...new Map(data.tags.map(tag => [normalize(tag), tag])).values()];
  return [
    ...companyColumns.map(column => data[column]), ownerId, JSON.stringify(tags), data.notes,
    normalize([...companyColumns.map(column => data[column]), ...tags].join(' ')),
  ];
}

export class Prospecting {
  private db: Database;
  private commands: Logistics;

  constructor(db: Database) {
    this.db = db;
    this.commands = new Logistics(db);
  }

  private read<T>(actor: Actor, work: () => Promise<T>) {
    authorize(actor, crmRoles);
    return this.db.transaction(work, { crmOrgId: actor.orgId, readOnly: true });
  }

  private write<T extends Row>(actor: Actor, operation: string, body: Row, work: () => Promise<T>) {
    authorize(actor, crmRoles);
    return this.db.transaction(
      () => this.commands.command(actor, 'crm.' + operation, body, crmRoles, work) as Promise<T>,
      { crmOrgId: actor.orgId },
    );
  }

  private async staff(orgId: string) {
    return await this.db.all(
      "SELECT id,name FROM users WHERE org_id=? AND enabled=1 AND role IN ('ADMIN','OPERATIONS') ORDER BY name,id", orgId,
    );
  }

  private async owner(actor: Actor, id = actor.id) {
    ensure((await this.staff(actor.orgId)).some(person => person.id === id), 'VALIDATION_ERROR', 'Elegí un responsable comercial activo de tu empresa.', 400);
    return id;
  }

  private async prospect(actor: Actor, id: string) {
    const row = await this.db.one('SELECT * FROM crm_prospects WHERE org_id=? AND id=?', actor.orgId, id);
    ensure(row, 'NOT_FOUND', 'Prospecto no encontrado.', 404);
    return row;
  }

  list(actor: Actor, query: Filters) {
    return this.read(actor, async () => {
      const {where, values} = filtered(actor.orgId, query);
      const rows = await this.db.all(
        'SELECT p.*,u.name AS owner_name FROM crm_prospects p JOIN users u ON u.id=p.owner_id AND u.org_id=p.org_id WHERE ' +
        where + ' ORDER BY p.updated_at DESC,p.id LIMIT ? OFFSET ?', ...values, query.limit, query.offset,
      );
      const count = await this.db.one('SELECT COUNT(*) AS total FROM crm_prospects p WHERE ' + where, ...values);
      return {...pagination(rows, count, query), rows: rows.map(describe)};
    });
  }

  dashboard(actor: Actor, query: Filters) {
    return this.read(actor, async () => {
      const {where, values} = filtered(actor.orgId, query);
      const stages = await this.db.all('SELECT p.stage,COUNT(*) AS total FROM crm_prospects p WHERE ' + where + ' GROUP BY p.stage', ...values);
      const reached = await this.db.all(
        "SELECT h.to_stage AS stage,COUNT(DISTINCT h.prospect_id) AS total FROM crm_transitions h " +
        "JOIN crm_prospects p ON p.org_id=h.org_id AND p.id=h.prospect_id WHERE " + where +
        " AND h.to_stage IN ('CONVERSING','PILOT','ACTIVATED') GROUP BY h.to_stage", ...values,
      );
      const tasks = await this.db.one(
        'SELECT COUNT(*) AS total FROM crm_tasks t JOIN crm_prospects p ON p.org_id=t.org_id AND p.id=t.prospect_id ' +
        'WHERE ' + where + ' AND t.completed_at IS NULL AND t.due_at<?', ...values, now(),
      );
      return {
        total: stages.reduce((sum, stage) => sum + Number(stage.total), 0),
        stages: crmStages.map(stage => ({stage, total: Number(stages.find(row => row.stage === stage)?.total ?? 0)})),
        reached: Object.fromEntries(reached.map(row => [row.stage, Number(row.total)])),
        overdue: Number(tasks?.total ?? 0),
      };
    });
  }

  options(actor: Actor) {
    return this.read(actor, async () => {
      const rows = await this.db.all(
        "SELECT DISTINCT campaign,source FROM crm_prospects WHERE org_id=? AND (campaign<>'' OR source<>'')", actor.orgId,
      );
      const sorted = (key: 'campaign' | 'source') => [...new Set<string>(rows.map(row => row[key]).filter(Boolean))]
        .sort((first, second) => first.localeCompare(second, 'es'));
      return {owners: await this.staff(actor.orgId), campaigns: sorted('campaign'), sources: sorted('source')};
    });
  }

  detail(actor: Actor, id: string) {
    return this.read(actor, async () => {
      const prospect = describe(await this.prospect(actor, id));
      const contacts = await this.db.all(
        'SELECT * FROM crm_contacts WHERE org_id=? AND prospect_id=? ORDER BY name,id', actor.orgId, id,
      );
      return {prospect, contacts: contacts.map(contact => ({...camel(contact), noContact: Boolean(contact.no_contact)}))};
    });
  }

  timeline(actor: Actor, id: string, query: Pagination) {
    return this.read(actor, async () => {
      await this.prospect(actor, id);
      const union =
        "SELECT h.id,h.occurred_at,u.name AS actor_name,'STAGE' AS kind,h.reason AS detail,h.from_stage,h.to_stage,NULL AS contact_name " +
        'FROM crm_transitions h JOIN users u ON u.id=h.actor_id WHERE h.org_id=? AND h.prospect_id=? ' +
        'UNION ALL SELECT a.id,a.occurred_at,u.name,a.kind,a.detail,NULL,NULL,c.name ' +
        'FROM crm_activities a JOIN users u ON u.id=a.actor_id LEFT JOIN crm_contacts c ' +
        'ON c.org_id=a.org_id AND c.prospect_id=a.prospect_id AND c.id=a.contact_id WHERE a.org_id=? AND a.prospect_id=?';
      const values = [actor.orgId, id, actor.orgId, id];
      const rows = await this.db.all(
        'SELECT * FROM (' + union + ') t ORDER BY occurred_at DESC,id LIMIT ? OFFSET ?', ...values, query.limit, query.offset,
      );
      const count = await this.db.one('SELECT COUNT(*) AS total FROM (' + union + ') t', ...values);
      return pagination(rows, count, query);
    });
  }

  tasks(actor: Actor, query: z.output<typeof crmSchemas.taskList>, id?: string) {
    return this.read(actor, async () => {
      if (id) await this.prospect(actor, id);
      const timestamp = now();
      const criteria = ['t.org_id=?', query.state === 'DONE' ? 't.completed_at IS NOT NULL' : 't.completed_at IS NULL'];
      const values: SqlValue[] = [actor.orgId];
      if (query.state === 'OVERDUE') { criteria.push('t.due_at<?'); values.push(timestamp); }
      if (query.ownerId) { criteria.push('t.owner_id=?'); values.push(query.ownerId); }
      if (id) { criteria.push('t.prospect_id=?'); values.push(id); }
      const where = criteria.join(' AND ');
      const rows = await this.db.all(
        'SELECT t.*,p.name AS prospect_name,u.name AS owner_name FROM crm_tasks t ' +
        'JOIN crm_prospects p ON p.org_id=t.org_id AND p.id=t.prospect_id ' +
        'JOIN users u ON u.org_id=t.org_id AND u.id=t.owner_id WHERE ' + where +
        ' ORDER BY t.due_at,t.id LIMIT ? OFFSET ?', ...values, query.limit, query.offset,
      );
      const count = await this.db.one('SELECT COUNT(*) AS total FROM crm_tasks t WHERE ' + where, ...values);
      return {...pagination(rows, count, query),
        rows: rows.map(row => ({...camel(row), overdue: !row.completed_at && row.due_at < timestamp}))};
    });
  }

  private async matches(orgId: string, keys: ReturnType<typeof companyKeys>) {
    const matches = new Map<string, string>();
    const unique = [...new Map(keys.map(key => [key.kind + ':' + key.value, key])).values()];
    for (let start = 0; start < unique.length; start += 200) {
      const group = unique.slice(start, start + 200);
      const sql = 'SELECT kind,value,prospect_id FROM crm_identifiers WHERE org_id=? AND (kind,value) IN (VALUES ' +
        group.map(() => '(?,?)').join(',') + ')';
      for (const row of await this.db.all(sql, orgId, ...group.flatMap(key => [key.kind, key.value]))) {
        matches.set(row.kind + ':' + row.value, row.prospect_id);
      }
    }
    return matches;
  }

  private async checkDuplicate(actor: Actor, data: ProspectFields, ownId?: string) {
    const matches = await this.matches(actor.orgId, companyKeys(data));
    const existing = [...new Set(matches.values())].filter(id => ownId !== id);
    if (existing.length) {
      throw new DomainError('CRM_DUPLICATE', 'Hay prospectos con los mismos identificadores. Revisá el registro existente.', 409, {prospectIds: existing});
    }
  }

  private async insert(table: string, columns: string[], rows: SqlValue[][]) {
    for (let index = 0; index < rows.length; index += 100) {
      const batch = rows.slice(index, index + 100);
      const placeholders = '(' + columns.map(() => '?').join(',') + ')';
      await this.db.run('INSERT INTO ' + table + ' (' + columns.join(',') + ') VALUES ' +
        batch.map(() => placeholders).join(','), ...batch.flat());
    }
  }

  private async insertProspects(actor: Actor, companies: Identified[], reason: string) {
    const timestamp = now();
    await this.insert('crm_prospects', ['org_id','id', ...companyData, 'created_at','updated_at'],
      companies.map(company => [actor.orgId, company.id, ...companyValues(company), timestamp, timestamp]));
    await this.insert('crm_identifiers', ['org_id','prospect_id','kind','value'],
      companies.flatMap(company => companyKeys(company.data).map(key => [actor.orgId, company.id, key.kind, key.value])));
    await this.insert('crm_transitions', ['org_id','prospect_id','id','to_stage','reason','actor_id','occurred_at'],
      companies.map(company => [actor.orgId, company.id, randomUUID(), 'IDENTIFIED', reason, actor.id, timestamp]));
  }

  create(actor: Actor, body: z.output<typeof crmSchemas.create>) {
    return this.write(actor, 'prospect.create', body, async () => {
      const id = randomUUID();
      await this.checkDuplicate(actor, body);
      await this.insertProspects(actor, [{id, data: body, ownerId: await this.owner(actor, body.ownerId)}], 'Alta de prospecto');
      return {id};
    });
  }

  update(actor: Actor, id: string, body: z.output<typeof crmSchemas.update>) {
    return this.write(actor, 'prospect.update.' + id, body, async () => {
      const current = await this.prospect(actor, id);
      ensure(current.version === body.expectedVersion, 'VERSION_CONFLICT', 'El prospecto cambió. Actualizá la ficha.');
      const ownerId = body.ownerId && body.ownerId !== current.owner_id ? await this.owner(actor, body.ownerId) : current.owner_id;
      await this.checkDuplicate(actor, body, id);
      await this.db.run('UPDATE crm_prospects SET ' + companyData.map(name => name + '=?').join(',') +
        ',updated_at=?,version=version+1 WHERE org_id=? AND id=?',
        ...companyValues({id, data: body, ownerId}), now(), actor.orgId, id);
      await this.db.run('DELETE FROM crm_identifiers WHERE org_id=? AND prospect_id=?', actor.orgId, id);
      await this.insert('crm_identifiers', ['org_id','prospect_id','kind','value'],
        companyKeys(body).map(key => [actor.orgId, id, key.kind, key.value]));
      return {id};
    });
  }

  transition(actor: Actor, id: string, body: z.output<typeof crmSchemas.stage>) {
    return this.write(actor, 'stage.' + id, body, async () => {
      const current = await this.prospect(actor, id);
      ensure(current.version === body.expectedVersion, 'VERSION_CONFLICT', 'El prospecto cambió. Actualizá la ficha.');
      const currentIndex = crmStages.indexOf(current.stage);
      const targetIndex = crmStages.indexOf(body.stage);
      const allowed = current.stage === 'DISCARDED' ? body.stage === 'IDENTIFIED' :
        body.stage !== current.stage && (body.stage === 'DISCARDED' || Math.abs(targetIndex - currentIndex) === 1);
      ensure(allowed, 'INVALID_TRANSITION', 'Mové el prospecto una etapa o registrá su descarte.');
      const timestamp = now();
      await this.db.run('UPDATE crm_prospects SET stage=?,version=version+1,updated_at=? WHERE org_id=? AND id=?',
        body.stage, timestamp, actor.orgId, id);
      await this.insert('crm_transitions', ['org_id','prospect_id','id','from_stage','to_stage','reason','actor_id','occurred_at'], [
        [actor.orgId, id, randomUUID(), current.stage, body.stage, body.reason, actor.id, timestamp],
      ]);
      return {id, state: body.stage};
    });
  }

  saveContact(actor: Actor, id: string, body: z.output<typeof crmSchemas.contact>, contactId?: string) {
    return this.write(actor, 'contact.' + id + '.' + (contactId ?? 'create'), body, async () => {
      await this.prospect(actor, id);
      const values = [body.name, body.jobTitle, body.phone || null, body.email || null, body.facebook,
        body.instagram, body.preferredChannel, Number(body.noContact)] as const;
      const contact = contactId ?? randomUUID();
      if (contactId) {
        const current = await this.db.one('SELECT version FROM crm_contacts WHERE org_id=? AND prospect_id=? AND id=?',
          actor.orgId, id, contact);
        ensure(current, 'NOT_FOUND', 'Contacto no encontrado.', 404);
        ensure(current.version === body.expectedVersion, 'VERSION_CONFLICT', 'El contacto cambió. Actualizá la ficha.');
        await this.db.run(
          'UPDATE crm_contacts SET name=?,job_title=?,phone=?,email=?,facebook=?,instagram=?,preferred_channel=?,no_contact=?,version=version+1 ' +
          'WHERE org_id=? AND prospect_id=? AND id=?', ...values, actor.orgId, id, contact,
        );
      } else {
        await this.db.run(
          'INSERT INTO crm_contacts (org_id,prospect_id,id,name,job_title,phone,email,facebook,instagram,preferred_channel,no_contact) ' +
          'VALUES (?,?,?,?,?,?,?,?,?,?,?)', actor.orgId, id, contact, ...values,
        );
      }
      return {id: contact, state: body.noContact ? 'DO_NOT_CONTACT' : 'CONTACT_ALLOWED'};
    });
  }

  private async appendActivity(actor: Actor, id: string, kind: string, detail: string, contactId: string | null, taskId: string | null) {
    const activityId = randomUUID();
    await this.db.run(
      'INSERT INTO crm_activities (org_id,prospect_id,id,contact_id,task_id,actor_id,kind,detail,occurred_at) VALUES (?,?,?,?,?,?,?,?,?)',
      actor.orgId, id, activityId, contactId, taskId, actor.id, kind, detail, now(),
    );
    return activityId;
  }

  activity(actor: Actor, id: string, body: z.output<typeof crmSchemas.activity>) {
    return this.write(actor, 'activity.' + id, body, async () => {
      await this.prospect(actor, id);
      if (body.contactId) {
        const contact = await this.db.one('SELECT no_contact FROM crm_contacts WHERE org_id=? AND prospect_id=? AND id=?',
          actor.orgId, id, body.contactId);
        ensure(contact, 'NOT_FOUND', 'Contacto no encontrado.', 404);
        ensure(!contact.no_contact || body.kind === 'NOTE', 'CRM_DO_NOT_CONTACT', 'El contacto está marcado como no contactar.');
      } else {
        ensure(body.kind === 'NOTE', 'VALIDATION_ERROR', 'Elegí el contacto de la interacción.', 400);
      }
      return {id: await this.appendActivity(actor, id, body.kind, body.detail, body.contactId ?? null, null)};
    });
  }

  createTask(actor: Actor, id: string, body: z.output<typeof crmSchemas.task>, followUp?: {contactId:string; runId:string}) {
    return this.write(actor, 'task.create.' + id, {...body, ...followUp}, async () => {
      await this.prospect(actor, id);
      if (followUp) {
        const contact = await this.db.one('SELECT no_contact FROM crm_contacts WHERE org_id=? AND prospect_id=? AND id=?',
          actor.orgId, id, followUp.contactId);
        ensure(contact && !contact.no_contact, 'CRM_DO_NOT_CONTACT', 'El contacto está marcado como no contactar.');
      }
      const taskId = randomUUID();
      await this.db.run(
        'INSERT INTO crm_tasks (org_id,prospect_id,id,owner_id,title,due_at) VALUES (?,?,?,?,?,?)',
        actor.orgId, id, taskId, await this.owner(actor, body.ownerId), body.title, new Date(body.dueAt).toISOString(),
      );
      await this.appendActivity(actor, id, 'TASK_CREATED', body.title, followUp?.contactId ?? null, taskId);
      return {id: taskId};
    });
  }

  completeTask(actor: Actor, taskId: string, body: z.output<typeof crmSchemas.done>) {
    return this.write(actor, 'task.complete.' + taskId, body, async () => {
      const task = await this.db.one('SELECT prospect_id,title,completed_at FROM crm_tasks WHERE org_id=? AND id=?',
        actor.orgId, taskId);
      ensure(task, 'NOT_FOUND', 'Tarea no encontrada.', 404);
      if (!task.completed_at) {
        await this.db.run('UPDATE crm_tasks SET completed_at=? WHERE org_id=? AND prospect_id=? AND id=?',
          now(), actor.orgId, task.prospect_id, taskId);
        await this.appendActivity(actor, task.prospect_id, 'TASK_COMPLETED', task.title, null, taskId);
      }
      return {id: taskId, state: 'DONE'};
    });
  }

  private async inspectImport(actor: Actor, csv: string) {
    const {rows, errors, total} = parseCrmCsv(csv);
    const accepted: typeof rows = [];
    const duplicates: CrmImportIssue[] = [];
    const existing = await this.matches(actor.orgId, rows.flatMap(row => companyKeys(row.data)));
    const allowedOwners = new Set((await this.staff(actor.orgId)).map(person => person.id));
    const found = new Map<string, number>();
    for (const row of rows) {
      if (row.data.ownerId && !allowedOwners.has(row.data.ownerId)) {
        errors.push({row: row.row, field: 'responsable', message: 'El responsable debe ser personal comercial activo de tu empresa.'});
        continue;
      }
      const keys = companyKeys(row.data);
      const conflict = keys.find(key => existing.has(key.kind + ':' + key.value) || found.has(key.kind + ':' + key.value));
      if (conflict) {
        const prior = found.get(conflict.kind + ':' + conflict.value);
        duplicates.push({row: row.row, field: conflict.kind, message: prior ? 'Coincide con la fila ' + prior + '.' : 'Ya existe un prospecto con este identificador.'});
        continue;
      }
      keys.forEach(key => found.set(key.kind + ':' + key.value, row.row));
      accepted.push(row);
    }
    const previewId = hash(JSON.stringify([hash(csv), actor.orgId, actor.id, accepted.map(row => row.row), errors, duplicates]));
    return { previewId, accepted, duplicates, errors, total };
  }

  preview(actor: Actor, csv: string) {
    return this.read(actor, async () => {
      const {accepted, ...summary} = await this.inspectImport(actor, csv);
      return {...summary, valid: accepted.length, sample: accepted.slice(0, 25).map(row => ({
        row: row.row, name: row.data.name, sector: row.data.sector, city: row.data.city,
      }))};
    });
  }

  import(actor: Actor, body: z.output<typeof crmSchemas.import>, source?: {reference: string; authorization: string}) {
    const digest = hash(body.csv);
    return this.write(actor, source ? 'research.import' : 'import', {commandId: body.commandId, digest, previewId: body.previewId, ...source}, async () => {
      const {accepted, errors, duplicates, previewId} = await this.inspectImport(actor, body.csv);
      ensure(previewId === body.previewId, 'VERSION_CONFLICT', 'La importación cambió. Volvé a revisar la vista previa.');
      ensure(accepted.length > 0, 'VALIDATION_ERROR', 'No hay filas válidas para importar.', 400);
      const prospects = accepted.map(row => ({
        id: randomUUID(), data: row.data, ownerId: row.data.ownerId ?? actor.id,
      }));
      await this.insertProspects(actor, prospects, source ? 'Investigación CSV autorizada' : 'Importación CSV');
      if (source) {
        const date = now();
        await this.insert('crm_research_sources',
          ['org_id','prospect_id','batch_id','source_row','source_ref','authorization_basis','csv_sha256','captured_by','captured_at'],
          prospects.map((p, i) => [actor.orgId,p.id,body.commandId,accepted[i].row,source.reference,source.authorization,digest,actor.id,date]));
      }
      return {imported: accepted.length, errors: new Set(errors.map(error => error.row)).size, duplicates: duplicates.length};
    });
  }
}
