import Card from "@/components/ui/Card";
import {
  ArrowDownRight,
  ArrowUpRight,
} from "lucide-react";

interface ReportStatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: number;
}

export default function ReportStatCard({
  title,
  value,
  subtitle,
  trend,
}: ReportStatCardProps) {
  const positive = trend !== undefined && trend >= 0;

  return (
    <Card className="relative overflow-hidden p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">
            {title}
          </p>

          <h2 className="mt-3 text-3xl font-bold text-gray-900">
            {value}
          </h2>

          {subtitle && (
            <p className="mt-2 text-sm text-gray-500">
              {subtitle}
            </p>
          )}
        </div>

        {trend !== undefined && (
          <div
            className={`flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold ${
              positive
                ? "bg-green-100 text-green-700"
                : "bg-red-100 text-red-700"
            }`}
          >
            {positive ? (
              <ArrowUpRight size={16} />
            ) : (
              <ArrowDownRight size={16} />
            )}

            {Math.abs(trend)}%
          </div>
        )}
      </div>

      <div className="absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r from-blue-500 to-cyan-500" />
    </Card>
  );
}