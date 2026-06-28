"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import ProductForm from "@/components/admin/ProductForm";
import ProductTable from "@/components/admin/ProductTable";

type Product = {
  id: string;
  title: string;
  description: string;
  category: string;
  price: number;
  image_url: string | null;
  download_url: string | null;
  active: boolean;
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    setLoading(true);

    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      alert(error.message);
      setLoading(false);
      return;
    }

    setProducts(data || []);
    setLoading(false);
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-7xl px-8 py-12">

        <div className="mb-10">
          <h1 className="text-5xl font-bold">
            Product Manager
          </h1>

          <p className="mt-3 text-slate-600">
            Manage all AI systems sold on Dental Flow.
          </p>
        </div>

        <ProductForm onSuccess={loadProducts} />

        {loading ? (
          <div className="mt-10 rounded-2xl bg-white p-10 text-center shadow">
            <p className="text-lg text-slate-600">
              Loading products...
            </p>
          </div>
        ) : (
          <ProductTable
            products={products}
            refresh={loadProducts}
          />
        )}

      </div>
    </main>
  );
}