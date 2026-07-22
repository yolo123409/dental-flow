import { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

export default function DataTableHeader({
  children,
}: Props) {
  return (
    <thead className="bg-porcelain">
      <tr>{children}</tr>
    </thead>
  );
}
