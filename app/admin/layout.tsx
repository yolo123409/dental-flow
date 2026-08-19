import { ReactNode } from "react";

import AdminLayout from "@/components/admin/AdminLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { OrganizationProvider } from "@/contexts/OrganizationContext";

export default function Layout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ProtectedRoute>
      <OrganizationProvider>
        <AdminLayout>
          {children}
        </AdminLayout>
      </OrganizationProvider>
    </ProtectedRoute>
  );
}