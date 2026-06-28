import Link from "next/link";
import Navbar from "./components/Navbar";
import { supabase } from "@/lib/supabase";

type Product = {
  id: string;
  title: string;
  description: string;
  price: number;
  image_url: string | null;
  category: string;
  active: boolean;
};

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

export default async function Home() {
  const { data: products, error } = await supabase
    .from("products")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
  }

  return (
    <>
      <Navbar />

      <main className="min-h-screen bg-slate-50">
        <section className="mx-auto max-w-7xl px-6 py-16">
          <div className="mb-14 text-center">
            <h1 className="text-5xl font-bold">
              AI Systems for Dental Clinics
            </h1>

            <p className="mx-auto mt-6 max-w-3xl text-lg text-slate-600">
              Grow your dental clinic using intelligent AI automation
              built specifically for modern practices.
            </p>
          </div>

          {products && products.length > 0 ? (
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {products.map((product: Product) => (
                <div
                  key={product.id}
                  className="overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
                >
                  <img
                    src={
                      product.image_url ||
                      "https://placehold.co/600x400?text=Dental+Flow"
                    }
                    alt={product.title}
                    className="h-56 w-full object-cover"
                  />

                  <div className="p-6">
                    <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700">
                      {product.category}
                    </span>

                    <h2 className="mt-4 text-2xl font-bold">
                      {product.title}
                    </h2>

                    <p className="mt-3 text-slate-600">
                      {product.description}
                    </p>

                    <div className="mt-6 flex items-center justify-between">
                      <h3 className="text-3xl font-bold text-blue-600">
                        KES {product.price.toLocaleString()}
                      </h3>

                      <Link
                        href={`/products/${slugify(product.title)}`}
                        className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700"
                      >
                        View →
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed bg-white p-16 text-center">
              <h2 className="text-2xl font-semibold">
                No AI systems available.
              </h2>

              <p className="mt-3 text-slate-500">
                Add products in Supabase and they'll appear here automatically.
              </p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}