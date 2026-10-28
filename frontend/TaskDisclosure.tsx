import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

/** Secondary tasks stay closed until the operator asks to perform them. */
export default function TaskDisclosure({ label, children,open,onToggle }: { label: string; children: ReactNode;open?:boolean;onToggle?:(open:boolean)=>void }) {
  return <details className="task-disclosure" open={open} onToggle={event=>onToggle?.(event.currentTarget.open)}><summary><span>{label}</span><ChevronRight aria-hidden="true" /></summary><div className="task-disclosure-body">{children}</div></details>;
}
