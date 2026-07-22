import { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

export default function DataTable({ children }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border border-sea-glass bg-enamel">
      <table className="w-full border-collapse text-sm">
        {children}
      </table>
    </div>
  );
}
