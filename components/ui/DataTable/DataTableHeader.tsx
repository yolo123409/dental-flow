import { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

export default function DataTableHeader({
  children,
}: Props) {
  return (
    <thead className="bg-slate-50">
      <tr>{children}</tr>
    </thead>
  );
}