import { z } from 'zod';
import { parseCsv } from './catalog-import.ts';
import { ensure } from './errors.ts';

export const crmStages = [
  'IDENTIFIED', 'VALIDATED', 'CONTACTED', 'CONVERSING', 'QUALIFIED',
  'PROPOSAL', 'PILOT', 'ACTIVATED', 'DISCARDED',
] as const;
export type CrmStage = typeof crmStages[number];

export const normalize = (value: string) => value.normalize('NFKD')
  .replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');

const optionalText = (max = 150) => z.string().trim().max(max).default('');
const phone = optionalText(40).transform((value, ctx) => {
  if (!value) return '';
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length >= 9) digits = '595' + digits.slice(1);
  if (!/^[+\d().\s-]+$/.test(value) || digits.length < 7 || digits.length > 15) {
    ctx.addIssue({code: 'custom', message: 'Teléfono inválido.'});
    return z.NEVER;
  }
  return digits;
});

function webUrl(value: string): URL {
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : 'https://' + value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.')) {
    throw new Error('URL inválida.');
  }
  return url;
}

const website = optionalText(300).transform((value, ctx) => {
  if (!value) return '';
  try {
    const url = webUrl(value);
    return url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/+$/, '');
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Sitio web inválido.' });
    return z.NEVER;
  }
});

function social(platform: 'facebook' | 'instagram') {
  return optionalText(300).transform((value, ctx) => {
    if (!value) return '';
    const handle = /^@?[\w.-]+$/.test(value) && !value.toLowerCase().endsWith('.com');
    const canonical = 'https://' + platform + '.com/';
    try {
      const url = webUrl(handle ? canonical + value.replace(/^@/, '') : value);
      const host = url.hostname.toLowerCase();
      const allowed = platform === 'facebook' ? ['facebook.com', 'fb.com'] : ['instagram.com'];
      if (!allowed.some(domain => host === domain || host.endsWith('.' + domain))) throw new Error();
      if (platform === 'facebook' && url.pathname === '/profile.php') {
        const id = url.searchParams.get('id');
        if (id && /^\d+$/.test(id)) return canonical + 'profile.php?id=' + id;
        throw new Error();
      }
      const key = url.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
      if (!key || /^(share|reel|p|stories|watch|login|groups)(\/|$)/.test(key)) throw new Error();
      return canonical + key;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Perfil de ' + platform + ' inválido.' });
      return z.NEVER;
    }
  });
}

const channels = {
  facebook: social('facebook'), instagram: social('instagram'), phone,
  email: optionalText(254).refine(value => !value || z.email().safeParse(value).success, 'Correo inválido.').transform(value => value.toLowerCase()),
};
export const crmCommand = z.object({ commandId: z.uuid() });
const version = z.number().int().positive();
export const prospectFields = z.object({
  name: z.string().trim().min(1, 'Ingresá el nombre comercial.').max(200),
  sector: optionalText(), city: optionalText(), department: optionalText(), source: optionalText(),
  campaign: optionalText(), website, ...channels,
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  notes: optionalText(3000), ownerId: z.uuid().optional(),
});
export type ProspectFields = z.output<typeof prospectFields>;

const channelKeys = { PHONE: 'phone', EMAIL: 'email', FACEBOOK: 'facebook', INSTAGRAM: 'instagram' } as const;
export const crmSchemas = {
  create: prospectFields.extend(crmCommand.shape).strict(),
  update: prospectFields.extend({ ...crmCommand.shape, expectedVersion: version }).strict(),
  contact: z.object({
    ...crmCommand.shape, name: z.string().trim().min(1).max(200), jobTitle: optionalText(), ...channels,
    preferredChannel: z.enum(['', 'PHONE', 'EMAIL', 'FACEBOOK', 'INSTAGRAM']).default(''),
    noContact: z.boolean().default(false), expectedVersion: version.optional(),
  }).strict().superRefine((contact, ctx) => {
    if (contact.preferredChannel && !contact[channelKeys[contact.preferredChannel]]) {
      ctx.addIssue({code: 'custom', path: ['preferredChannel'], message: 'Completá el dato del canal preferido.'});
    }
  }),
  stage: crmCommand.extend({
    expectedVersion: version, stage: z.enum(crmStages), reason: z.string().trim().min(1).max(500),
  }).strict(),
  activity: crmCommand.extend({
    kind: z.enum(['CALL', 'MEETING', 'MESSAGE', 'NOTE']), contactId: z.uuid().optional(),
    detail: z.string().trim().min(1).max(3000),
  }).strict(),
  task: crmCommand.extend({
    title: z.string().trim().min(1).max(300), dueAt: z.iso.datetime({offset: true}),
    ownerId: z.uuid().optional(),
  }).strict(),
  done: crmCommand.strict(),
  csv: z.object({ csv: z.string().min(1).max(2_000_000) }).strict(),
  import: crmCommand.extend({ csv: z.string().min(1).max(2_000_000), previewId: z.hash('sha256') }).strict(),
  list: z.object({
    q: optionalText(120), source: optionalText(), campaign: optionalText(), sector: optionalText(),
    city: optionalText(), department: optionalText(), tag: optionalText(60),
    stage: z.enum(crmStages).optional(), ownerId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  }).strict(),
  timeline: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  }).strict(),
  taskList: z.object({
    state: z.enum(['OPEN', 'OVERDUE', 'DONE']).default('OPEN'), ownerId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  }).strict(),
};

const headerMap = {
  nombre: 'name', empresa: 'name', name: 'name', 'nombre comercial': 'name',
  rubro: 'sector', sector: 'sector', ciudad: 'city', city: 'city', departamento: 'department',
  department: 'department', origen: 'source', fuente: 'source', source: 'source', campana: 'campaign',
  campaign: 'campaign', facebook: 'facebook', instagram: 'instagram', web: 'website', website: 'website',
  telefono: 'phone', phone: 'phone', email: 'email', correo: 'email', etiquetas: 'tags', tags: 'tags',
  notas: 'notes', notes: 'notes', responsable: 'ownerId',
} as const;

export type CrmImportIssue = { row: number; field: string; message: string };
export type CrmImportRow = { row: number; data: ProspectFields };

export function parseCrmCsv(csv: string) {
  ensure(Buffer.byteLength(csv, 'utf8') <= 2_000_000, 'VALIDATION_ERROR', 'El CSV supera los 2 MB.', 413);
  const parsed = parseCsv(csv, 'empresas', true);
  const errors: CrmImportIssue[] = parsed.errors.map(error => ({...error, field: error.field ?? 'csv'}));
  const rows: CrmImportRow[] = [];
  if (!parsed.rows.length) return { rows, errors, total: 0 };
  const [header, ...body] = parsed.rows;
  const invalidRows = new Set(errors.map(error => error.row));
  if (invalidRows.has(header.row)) return { rows, errors, total: body.length };
  const keys = header.cells.map(cell => headerMap[normalize(String(cell.raw)) as keyof typeof headerMap]);
  if (!keys.includes('name') || new Set(keys).size !== keys.length || keys.some(key => !key)) {
    return { rows, errors: [{row: header.row, field: 'encabezados', message: 'Incluí nombre. Usá encabezados reconocidos y sin repetir.'}], total: body.length };
  }
  for (const record of body) {
    if (invalidRows.has(record.row)) continue;
    if (record.cells.length > keys.length) {
      errors.push({row: record.row, field: 'columnas', message: 'La fila tiene más columnas que los encabezados.'});
      continue;
    }
    const input = Object.fromEntries(keys.map((key, index) => [key, String(record.cells[index]?.raw ?? '').trim()]));
    if (!input.ownerId) delete input.ownerId;
    const result = prospectFields.safeParse({...input, tags: input.tags?.split('|').map(tag => tag.trim()).filter(Boolean)});
    if (result.success) rows.push({row: record.row, data: result.data});
    else for (const issue of result.error.issues) errors.push({row: record.row, field: String(issue.path[0] ?? 'fila'), message: issue.message});
  }
  return { rows, errors, total: body.length };
}

export function companyKeys(company: ProspectFields) {
  const keys = (['facebook', 'instagram', 'website', 'phone', 'email'] as const)
    .filter(kind => company[kind]).map(kind => ({ kind: kind as string, value: company[kind] }));
  const folded = normalize(company.name);
  const name = folded.replace(/[^\p{L}\p{N}]+/gu, '') || folded;
  keys.push({ kind: 'business', value: [name, normalize(company.city), normalize(company.department)].join('|') });
  return keys;
}
