import type {ComponentPropsWithoutRef,ReactNode} from 'react';
import {ArrowUpRight} from 'lucide-react';

type Props=Omit<ComponentPropsWithoutRef<'button'>,'children'|'className'> & {
  label:string;
  value:ReactNode;
  caption:string;
};

export default function StatCard({label,value,caption,...buttonProps}:Props) {
  return <button {...buttonProps} type="button" className="stat-card"><span>{label}</span><strong>{value}</strong><small>{caption}<ArrowUpRight aria-hidden="true"/></small></button>;
}
