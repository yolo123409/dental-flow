import { supabase } from "@/lib/supabase";
import Link from "next/link";

type Product = {
  id: string;
  title: string;
  description: string;
  price: number;
  image_url: string | null;
  category: string;
};

type Props = {
  params: Promise<{
    slug: string;
  }>;
};

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;

  const { data: products } = await supabase
    .from("products")
    .select("*");

  const product = products?.find(
    (p) => slugify(p.title) === slug
  ) as Product | undefined;

  if (!product) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <h1 className="text-4xl font-bold">
          Product Not Found
        </h1>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-6 py-16">

        <Link
          href="/"
          className="text-blue-600 hover:underline"
        >
          ← Back
        </Link>

        <div className="mt-12 grid gap-12 lg:grid-cols-2">

          <img
            src={
              product.image_url ??
              "https://placehold.co/800x600?text=Dental+Flow"
            }
            alt={product.title}
            className="rounded-2xl border"
          />

          <div>

            <span className="rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-700">
              {product.category}
            </span>

            <h1 className="mt-6 text-5xl font-bold">
              {product.title}
            </h1>

            <p className="mt-8 text-lg text-slate-600">
              {product.description}
            </p>

            <h2 className="mt-10 text-5xl font-bold text-blue-600">
              KES {product.price.toLocaleString()}
            </h2>

            <Link
              href={`/checkout?product=${product.id}`}
              className="mt-10 inline-block rounded-xl bg-green-600 px-8 py-4 font-semibold text-white hover:bg-green-700"
            >
              Buy Now
            </Link>

          </div>

        </div>

      </div>
    </main>
  );
}