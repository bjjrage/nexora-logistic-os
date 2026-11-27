import {hash} from './auth.ts';
import type {HistoricalRow, parseProcurementWorkbook} from './procurement-workbook.ts';

export const dimensions = ['month','category','costCenter','supplier','paymentMethod','documentType','historicalStatus'] as const;
export type Dimension = typeof dimensions[number];
export const registryDimensions = ['supplier','category','costCenter','historicalStatus'] as const;
export type Source = ReturnType<typeof parseProcurementWorkbook>['summary'];
export type SourceRow = { normalized: HistoricalRow; state: 'PENDING'|'PROMOTED'|'SKIPPED'; issues: Array<{code:string}>;operationId?:string };
type Named = { id: string; name: string };
type StoredParty = Named & { ruc: string | null; active: number };
type Budget = { category_id: string; month: string; amount_pyg: number | string | null };
const rucPattern = /^\d{1,15}(?:-\d)?$/;
const normalize = (value: string) => value.trim().normalize('NFC').toLowerCase();
const ordered = (items: string[]) => items.sort((a,b)=>a.localeCompare(b,'es') || a.localeCompare(b,'en'));
const nonempty = (values: Array<string | null>) => values.filter((value): value is string => Boolean(value?.trim()));
const uniqueNames = (values: string[]) => Array.from(new Map(ordered(values.map(x=>x.trim())).map(x=>[normalize(x),x])).values());

export function sourceValue(row: HistoricalRow, dimension: Dimension) {
  return dimension === 'month' ? row.date?.slice(0,7) ?? null : row[dimension];
}

export function sourceKey(value: string | null) {
  return value === null ? 'N' : 'V:' + value;
}

export function sourceIncluded(row: HistoricalRow, dimension?: Dimension) {
  return !row.payment && (dimension === 'historicalStatus' || normalize(row.historicalStatus ?? '') !== 'anulado');
}

export const sourceScopes = ['included','paid','pending'] as const;
export type SourceScope = typeof sourceScopes[number];

export function matchesSourceScope(row: HistoricalRow, scope: SourceScope) {
  if (!sourceIncluded(row)) return false;
  const status = normalize(row.historicalStatus ?? '');
  return scope === 'included' || (scope === 'paid' ? status === 'pagado' : status === 'pendiente');
}

const inPeriod = (row: HistoricalRow, from: string, before: string) =>
  Boolean(row.date && row.date >= from && row.date < before && sourceIncluded(row));

export function summarizeSource(summary: Source, rows: SourceRow[]) {
  const groups = Object.fromEntries(dimensions.map(dimension => {
    const totals = new Map<string, {key:string; label:string|null; count:number; totalPyg:number;vatPyg:number;netPyg:number;missingBreakdown:number}>();
    for (const {normalized} of rows) {
      if (!sourceIncluded(normalized,dimension)) continue;
      const label = sourceValue(normalized,dimension), key = sourceKey(label);
      const group = totals.get(key) ?? {key,label,count:0,totalPyg:0,vatPyg:0,netPyg:0,missingBreakdown:0};
      group.count++;
      group.totalPyg += normalized.totalPyg ?? 0;
      if (normalized.totalPyg!==null && normalized.taxPyg!==null && normalized.netPyg!==null &&
          normalized.totalPyg-normalized.taxPyg===normalized.netPyg) {
        group.vatPyg+=normalized.taxPyg;
        group.netPyg+=normalized.netPyg;
      } else group.missingBreakdown++;
      totals.set(key,group);
    }
    return [dimension,[...totals.values()].sort((a,b) => dimension === 'month'
      ? (a.label ?? '~').localeCompare(b.label ?? '~') : b.totalPyg-a.totalPyg || (a.label ?? '').localeCompare(b.label ?? '','es'))];
  }));
  const controls = summary.controls.map(control => {
    const calculatedPyg = rows.reduce((total,{normalized}) => total +
      (inPeriod(normalized,control.from,control.before) ? normalized.totalPyg ?? 0 : 0),0);
    return {...control,calculatedPyg,differencePyg:calculatedPyg-control.amountPyg};
  });
  const setupParameters = summary.parameters;
  const month = setupParameters?.budgetMonth ?? null;
  const configured = new Map((setupParameters?.budgets ?? []).map(x=>[normalize(x.category),x.amountPyg]));
  const categories = new Map<string,string|null>();
  for (const name of nonempty([...(setupParameters?.budgets.map(x=>x.category) ?? []),...rows.map(r=>r.normalized.category)])) {
    if (!categories.has(normalize(name))) categories.set(normalize(name),name);
  }
  const [year, monthsElapsed] = month?.split('-').map(Number) ?? [];
  const budgetPeriod = month
    ? {from:`${year}-01-01`,before:monthsElapsed===12?`${year+1}-01-01`:`${year}-${String(monthsElapsed+1).padStart(2,'0')}-01`}
    : null;
  const execution = new Map<string,{monthPyg:number;accumulatedPyg:number}>();
  if (month && budgetPeriod) for (const {normalized} of rows) {
    if (!inPeriod(normalized,budgetPeriod.from,budgetPeriod.before)) continue;
    const key = normalize(normalized.category ?? '');
    const real = execution.get(key) ?? {monthPyg:0,accumulatedPyg:0};
    const amount = normalized.totalPyg ?? 0;
    if (normalized.date?.startsWith(month)) real.monthPyg += amount;
    real.accumulatedPyg += amount;
    execution.set(key,real);
  }
  if (execution.has('')) categories.set('',null);
  const budgets = month ? [...categories].map(([categoryKey,category])=>{
    const budgetPyg = configured.get(categoryKey) ?? null;
    const real = execution.get(categoryKey);
    const realPyg = real?.monthPyg ?? 0, realAccumulatedPyg = real?.accumulatedPyg ?? 0;
    const accumulated = budgetPyg===null ? null : budgetPyg * monthsElapsed;
    const budgetAccumulatedPyg = Number.isSafeInteger(accumulated) ? accumulated : null;
    return {
      category,key:sourceKey(category),budgetPyg,realPyg,differencePyg:(budgetPyg ?? 0)-realPyg,
      executionRatio:budgetPyg ? realPyg/budgetPyg : null,
      budgetAccumulatedPyg,realAccumulatedPyg,
      differenceAccumulatedPyg:accumulated!==null&&budgetAccumulatedPyg===null ? null : (budgetAccumulatedPyg ?? 0)-realAccumulatedPyg,
      executionAccumulatedRatio:budgetAccumulatedPyg ? realAccumulatedPyg/budgetAccumulatedPyg : null,
    };
  }) : [];
  const totals = {
    count:0, totalPyg:0, vatPyg:0, netPyg:0, incompleteBreakdown:0,
    paidPyg:0, pendingPyg:0, paidCount:0, pendingCount:0,
  };
  for (const {normalized: row} of rows) {
    if (!matchesSourceScope(row,'included')) continue;
    totals.count++;
    totals.totalPyg += row.totalPyg ?? 0;
    if (row.totalPyg !== null && row.taxPyg !== null && row.netPyg !== null && row.totalPyg-row.taxPyg===row.netPyg) {
      totals.vatPyg += row.taxPyg;
      totals.netPyg += row.netPyg;
    } else totals.incompleteBreakdown++;
    if (matchesSourceScope(row,'paid')) {
      totals.paidPyg += row.totalPyg ?? 0;
      totals.paidCount++;
    }
    if (matchesSourceScope(row,'pending')) {
      totals.pendingPyg += row.totalPyg ?? 0;
      totals.pendingCount++;
    }
  }
  const states = {PENDING:0,PROMOTED:0,SKIPPED:0};
  for(const row of rows) states[row.state]++;
  return { totals, groups, controls, budgetMonth:month, budgetPeriod, budgets, states, formulaRows:summary.ignoredFormulaRows,
    issues: Object.fromEntries(['POSSIBLE_EXAMPLE','POSSIBLE_DUPLICATE','MISSING_SUPPLIER','UNRESOLVED_DATE'].map(code=>[
      code, rows.filter(row=>row.issues.some(issue=>issue.code===code)).length,
    ])) };
}

const usableRows = (rows: SourceRow[]) =>
  rows.filter(row=>!row.normalized.payment && row.state !== 'SKIPPED' && !row.issues.some(issue=>issue.code==='POSSIBLE_EXAMPLE'));

export function sourceSuppliers(rows: SourceRow[], existing: StoredParty[]) {
  const candidates = new Map<string,{name:string; rucs:Set<string>}>();
  for (const {normalized:row} of usableRows(rows)) if (row.supplier) {
    const key = normalize(row.supplier), entry = candidates.get(key) ?? {name:row.supplier,rucs:new Set<string>()};
    if (row.taxId) entry.rucs.add(row.taxId);
    candidates.set(key,entry);
  }
  const parties: Array<{name:string;ruc:string|null}> = [];
  const conflicts: Array<{name:string; reason:string}> = [];
  const claimed = new Set(existing.flatMap(party=>party.ruc ?? []));
  for (const {name,rucs} of [...candidates.values()].sort((a,b)=>a.name.localeCompare(b.name,'es'))) {
    const ruc = [...rucs][0] ?? null;
    const named = existing.filter(party=>normalize(party.name)===normalize(name));
    if (rucs.size>1 || ruc && !rucPattern.test(ruc) || name.length>200 ||
      named.length>1 || ruc && named.some(party=>party.ruc && party.ruc!==ruc)) {
      conflicts.push({name,reason:'Identidad o RUC para revisar'});
      continue;
    }
    const linked = (ruc ? existing.find(party=>party.ruc===ruc) : undefined) ?? named[0];
    if (linked && !Number(linked.active)) {
      conflicts.push({name,reason:'El proveedor del OS está inactivo'});
      continue;
    }
    if (!named.length && (!ruc || !claimed.has(ruc))) {
      parties.push({name,ruc});
      if (ruc) claimed.add(ruc);
    }
  }
  return {parties,conflicts};
}

export function setupPlan(summary: Source, rows: SourceRow[], existing: {
  parties: StoredParty[]; categories: Named[]; centers: Named[]; budgets: Budget[];
}) {
  const lists = summary.parameters?.lists;
  const usable = usableRows(rows);
  const fromParameter = (key: string) => (lists?.[key] ?? []).filter((item): item is string=>typeof item==='string');
  const setupNames = (key: string, field: 'category'|'costCenter', current: Named[]) => {
    const configured = new Set(current.map(item=>normalize(item.name)));
    return uniqueNames(nonempty([...fromParameter(key), ...usable.map(row=>row.normalized[field])]))
      .filter(name=>!configured.has(normalize(name))).filter(name=>name.length<=120);
  };
  const categories = setupNames('categories','category',existing.categories);
  const centers = setupNames('costCenters','costCenter',existing.centers);
  const {parties,conflicts} = sourceSuppliers(rows,existing.parties);
  const month = summary.parameters?.budgetMonth;
  const byName = new Map(existing.categories.map(category=>[normalize(category.name),category.id]));
  const configured = new Set(existing.budgets.filter(x=>x.amount_pyg!==null).map(x=>x.category_id));
  const pendingBudgets = new Map<string,{category:string;month:string;amountPyg:number}>();
  const conflictedBudgets = new Set<string>();
  if (month) for (const value of summary.parameters?.budgets ?? []) {
    const key = normalize(value.category);
    if (value.amountPyg === null || value.category.length > 120 || configured.has(byName.get(key) ?? '')) continue;
    const old = pendingBudgets.get(key);
    if (old && old.amountPyg !== value.amountPyg) conflictedBudgets.add(key);
    else pendingBudgets.set(key,{category:value.category,month,amountPyg:value.amountPyg});
  }
  const budgets = [...pendingBudgets].filter(([key])=>!conflictedBudgets.has(key)).map(([,value])=>value);
  const paymentMethods = uniqueNames(fromParameter('paymentMethods')).filter(value=>value.length<=60);
  const plan = {categories,centers,parties,budgets,paymentMethods,conflicts};
  return {...plan,digest:hash(JSON.stringify(plan))};
}
