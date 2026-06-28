"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

type Product = {
  id: string;
  title: string;
  description: string;
  price: number;
  image_url: string | null;
  download_url: string | null;
  category: string;
};

type Purchase = {
  product_id: string;
  products: Product[];
};

export default function Dashboard() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [purchases, setPurchases] = useState<Purchase[]>([]);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/auth/login");
      return;
    }

    setEmail(user.email || "");

    const { data, error } = await supabase
      .from("purchases")
      .select(`
        product_id,
        products (
          id,
          title,
          description,
          price,
          image_url,
          download_url,
          category
        )
      `)
      .eq("user_id", user.id);

    if (error) {
      console.error(error);
    } else {
      setPurchases((data || []) as Purchase[]);
    }

    setLoading(false);
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/auth/login");
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-7xl px-8 py-12">
        <div className="mb-10 flex items-center justify-between">
          <div>
            <h1 className="text-5xl font-bold">
              My Dashboard
            </h1>

            <p className="mt-2 text-slate-600">
              {email}
            </p>
          </div>

          <button
            onClick={logout}
            className="rounded-xl bg-red-600 px-6 py-3 font-semibold text-white hover:bg-red-700"
          >
            Logout
          </button>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow">
          <h2 className="mb-8 text-3xl font-bold">
            My AI Systems
          </h2>

          {loading ? (
            <p>Loading...</p>
          ) : purchases.length === 0 ? (
            <div className="rounded-xl border border-dashed p-12 text-center">
              <h3 className="text-2xl font-semibold">
                No purchased systems yet
              </h3>

              <p className="mt-3 text-slate-500">
                Once your payment is approved, your AI systems will appear here.
              </p>
            </div>
          ) : (
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {purchases.map((purchase) => {
                const product = purchase.products?.[0];

                if (!product) return null;

                return (
                  <div
                    key={purchase.product_id}
                    className="overflow-hidden rounded-2xl border bg-white shadow transition hover:shadow-lg"
                  >
                    <img
                      src={
                        product.image_url ||
                        "https://placehold.co/600x400?text=Dental+Flow"
                      }
                      alt={product.title}
                      className="h-52 w-full object-cover"
                    />

                    <div className="p-6">
                      <span className="rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-700">
                        {product.category}
                      </span>

                      <h3 className="mt-4 text-2xl font-bold">
                        {product.title}
                      </h3>

                      <p className="mt-3 text-slate-600">
                        {product.description}
                      </p>

                      {product.download_url ? (
                        <a
                          href={product.download_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-6 block rounded-xl bg-blue-600 py-3 text-center font-semibold text-white hover:bg-blue-700"
                        >
                          Download
                        </a>
                      ) : (
                        <button
                          disabled
                          className="mt-6 w-full rounded-xl bg-slate-300 py-3 font-semibold text-slate-600"
                        >
                          Download Coming Soon
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}