import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

/** Secondary tasks stay closed until the operator asks to perform them. */
export default function TaskDisclosure({ label, children }: { label: string; children: ReactNode }) {
  return <details className="task-disclosure"><summary><span>{label}</span><ChevronRight aria-hidden="true" /></summary><div className="task-disclosure-body">{children}</div></details>;
}
