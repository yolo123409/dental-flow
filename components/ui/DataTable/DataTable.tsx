import { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

export default function DataTable({ children }: Props) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full border-collapse text-sm">
        {children}
      </table>
    </div>
  );
}
