"use client";

import { ShieldAlert } from "lucide-react";

import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

export default function AccessDenied() {
  return (
    <div className="flex justify-center py-20">
      <Card className="max-w-xl text-center">

        <div className="flex justify-center">
          <div className="rounded-full bg-red-100 p-5">
            <ShieldAlert
              size={48}
              className="text-red-600"
            />
          </div>
        </div>

        <h1 className="mt-6 text-3xl font-bold">
          Access Denied
        </h1>

        <p className="mt-3 text-slate-500">
          You don't have permission to
          access this page.
        </p>

        <Button
          className="mt-8"
          onClick={() => history.back()}
        >
          Go Back
        </Button>

      </Card>
    </div>
  );
}