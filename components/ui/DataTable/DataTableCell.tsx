import { ReactNode } from "react";

interface Props {
  children: ReactNode;
  header?: boolean;
}

export default function DataTableCell({
  children,
  header = false,
}: Props) {
  if (header) {
    return (
      <th className="px-6 py-4 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-mineral">
        {children}
      </th>
    );
  }

  return (
    <td className="px-6 py-5">
      {children}
    </td>
  );
}
