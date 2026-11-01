import { z } from 'zod';

const sourcePositionSchema = z.object({
  file: z.string().regex(/^index-[a-zA-Z0-9_-]{1,100}\.js$/),
  line: z.number().int().min(1).max(10_000_000),
  column: z.number().int().min(1).max(1_000_000),
}).strict();

export const clientErrorSchema = z.object({
  kind: z.enum(['UI_ERROR', 'UNHANDLED_REJECTION', 'API_ERROR']),
  component: z.string().regex(/^[a-zA-Z0-9_.-]{1,80}$/),
  requestId: z.uuid().optional(),
  position: sourcePositionSchema.optional(),
}).strict();

export type ClientErrorPayload = z.infer<typeof clientErrorSchema>;

export function sourcePosition(stack?: string) {
  const match = stack?.match(/\/assets\/(index-[a-zA-Z0-9_-]{1,100}\.js):(\d+):(\d+)/);
  if (!match) return undefined;
  const line = Number(match[2]), column = Number(match[3]);
  const candidate = { file: match[1], line, column };
  return sourcePositionSchema.safeParse(candidate).success ? candidate : undefined;
}

export function createClientErrorPayload(
  kind: ClientErrorPayload['kind'],
  component: string,
  requestId?: string,
  position?: ClientErrorPayload['position'],
): ClientErrorPayload {
  return clientErrorSchema.parse({ kind, component, ...(requestId ? { requestId } : {}), ...(position ? { position } : {}) });
}
