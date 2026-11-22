import { useEffect, useRef, useState } from 'react';
import { api, type ApiProblem } from '../api';

export const stages = {
  IDENTIFIED: 'Identificado', VALIDATED: 'Validado', CONTACTED: 'Contactado', CONVERSING: 'Conversando',
  QUALIFIED: 'Calificado', PROPOSAL: 'Propuesta', PILOT: 'Piloto', ACTIVATED: 'Activado', DISCARDED: 'Descartado',
} as const;

export const activityNames: Record<string, string> = {
  CALL: 'Llamada', MEETING: 'Reunión', MESSAGE: 'Mensaje', NOTE: 'Nota',
  TASK_CREATED: 'Tarea creada', TASK_COMPLETED: 'Tarea completada', STAGE: 'Cambio de etapa',
};

export type Stage = keyof typeof stages;
export type Owner = {id: string; name: string};
export type CompanyInput = Record<string, string | string[] | number | undefined>;
export type Page<T> = {rows: T[]; total: number; limit: number; offset: number};
export type Options = {owners: Owner[]; campaigns: string[]; sources: string[]};
export type Prospect = {
  id: string; name: string; stage: Stage; version: number; ownerId: string; ownerName?: string;
  sector: string; city: string; department: string; source: string; campaign: string;
  phone: string; email: string; facebook: string; instagram: string; website: string;
  tags: string[]; notes: string; score: number;
};
export type Contact = {
  id: string; version: number; name: string; jobTitle: string; phone: string | null; email: string | null;
  facebook: string; instagram: string; preferredChannel: string; noContact: boolean;
};
export type Task = {
  id: string; prospectId: string; prospectName: string; title: string;
  dueAt: string; ownerName: string; completedAt: string | null; overdue: boolean;
};
export type TimelineEntry = {
  id: string; actorName: string; kind: string; detail: string; occurredAt: string;
  fromStage: Stage | null; toStage: Stage | null; contactName: string | null;
};
export type Detail = {prospect: Prospect; contacts: Contact[]};
export type Dashboard = {
  total: number; overdue: number; stages: {stage: Stage; total: number}[];
  reached: Partial<Record<Stage, number>>;
};
export type Filters = {
  q: string; stage: Stage | ''; ownerId: string; campaign: string; source: string;
  city: string; department: string; sector: string; tag: string;
};
export const initialFilters: Filters = {
  q: '', stage: '', ownerId: '', campaign: '', source: '', city: '', department: '', sector: '', tag: '',
};

export function crmPath(path: string, filters: Record<string, string | number> = {}) {
  const entries = Object.entries(filters).filter(([, value]) => value !== '');
  const query = new URLSearchParams(entries.map(([key, value]) => [key, String(value)]));
  return '/api/crm' + path + (query.size ? '?' + query : '');
}

export function useCrmQuery<T>(path: string | null, revision: number) {
  const [state, setState] = useState<{path: string; revision: number; data?: T; error?: string}>();
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    void api<T>(path, {signal: controller.signal}).then(data => {
      if (!controller.signal.aborted) setState({path, revision, data});
    }, (caught: Error) => {
      if (!controller.signal.aborted) setState({path, revision, error: caught.message});
    });
    return () => controller.abort();
  }, [path, revision]);
  return state?.path === path && state.revision === revision ? state : undefined;
}

export type RunAction = (
  path: string, body: object, method?: 'POST' | 'PUT', commandId?: string,
) => Promise<{id?: string; imported?: number} | undefined>;

export function useCrmAction(onSuccess: () => void) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const retry = useRef<{key: string; command: string} | undefined>(undefined);
  const running = useRef(false);

  const run: RunAction = async (path, data, method = 'POST', commandId) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    const key = JSON.stringify([path, data, method]);
    const command = commandId ?? (retry.current?.key === key ? retry.current.command : crypto.randomUUID());
    retry.current = {key, command};
    try {
      const result = await api<{id?: string; imported?: number}>(crmPath(path), {
        method, headers: {'Content-Type': 'application/json', 'X-Requested-With': 'logistics-os'},
        body: JSON.stringify({...data, commandId: command}),
      });
      retry.current = undefined;
      onSuccess();
      return result;
    } catch (caught) {
      const failure = caught as ApiProblem;
      if (failure.status && failure.status < 500) retry.current = undefined;
      setError(failure.message);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return {run, busy, error, clearError: () => setError('')};
}

export const formatDate = (value: string) => new Intl.DateTimeFormat('es-PY', {
  dateStyle: 'short', timeStyle: 'short',
}).format(new Date(value));

export const fieldValue = (form: FormData, field: string) => String(form.get(field) ?? '').trim();
