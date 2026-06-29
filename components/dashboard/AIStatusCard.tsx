"use client";

import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { Bot } from "lucide-react";

export default function AIStatusCard() {
  return (
    <Card title="AI Receptionist">
      <div className="space-y-5">

        <div className="flex items-center justify-between">

          <div className="flex items-center gap-3">

            <div className="rounded-xl bg-blue-100 p-3 text-blue-600">
              <Bot size={22} />
            </div>

            <div>
              <h3 className="font-semibold">
                DentalFlow AI
              </h3>

              <p className="text-sm text-slate-500">
                Online
              </p>
            </div>

          </div>

          <Badge color="green">
            Active
          </Badge>

        </div>

        <div className="grid grid-cols-2 gap-4">

          <div className="rounded-xl bg-slate-50 p-4">

            <p className="text-sm text-slate-500">
              Conversations
            </p>

            <h2 className="mt-1 text-2xl font-bold">
              127
            </h2>

          </div>

          <div className="rounded-xl bg-slate-50 p-4">

            <p className="text-sm text-slate-500">
              Success Rate
            </p>

            <h2 className="mt-1 text-2xl font-bold">
              98%
            </h2>

          </div>

        </div>

      </div>
    </Card>
  );
}