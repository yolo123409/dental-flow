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
      <th className="px-6 py-4 text-left text-sm font-semibold text-slate-600">
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