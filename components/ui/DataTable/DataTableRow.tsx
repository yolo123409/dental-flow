import { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

export default function DataTableRow({
  children,
}: Props) {
  return (
    <tr className="border-t border-sea-glass transition-colors hover:bg-porcelain">
      {children}
    </tr>
  );
}
