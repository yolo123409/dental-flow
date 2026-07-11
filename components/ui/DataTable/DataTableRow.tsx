import { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

export default function DataTableRow({
  children,
}: Props) {
  return (
    <tr className="border-t border-slate-100 transition hover:bg-slate-50">
      {children}
    </tr>
  );
}