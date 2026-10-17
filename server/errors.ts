export class DomainError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(code: string, message: string, status = 409, details?: unknown) { super(message); this.code=code; this.status=status; this.details=details; }
}
export function ensure(condition: unknown, code: string, message: string, status = 409): asserts condition {
  if (!condition) throw new DomainError(code, message, status);
}
