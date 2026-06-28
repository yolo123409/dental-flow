"use client";

import { supabase } from "@/lib/supabase";

type Product = {
  id: string;
  title: string;
  description: string;
  category: string;
  price: number;
  image_url: string | null;
  download_url: string |null;
  active: boolean;
};

type Props = {
  products: Product[];
  refresh: () => void;
};

export default function ProductTable({
  products,
  refresh,
}: Props) {

  async function deleteProduct(id: string) {
    const confirmed = confirm(
      "Delete this product?"
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", id);

    if (error) {
      alert(error.message);
      return;
    }

    refresh();
  }

  async function toggleProduct(product: Product) {
    const { error } = await supabase
      .from("products")
      .update({
        active: !product.active,
      })
      .eq("id", product.id);

    if (error) {
      alert(error.message);
      return;
    }

    refresh();
  }

  return (
    <div className="mt-10 rounded-2xl bg-white shadow">

      <table className="w-full">

        <thead>

          <tr className="border-b bg-slate-50">

            <th className="p-5 text-left">
              Image
            </th>

            <th className="text-left">
              Product
            </th>

            <th className="text-left">
              Category
            </th>

            <th className="text-left">
              Price
            </th>

            <th className="text-left">
              Status
            </th>

            <th className="text-left">
              Download
            </th>

            <th className="text-left">
              Actions
            </th>

          </tr>

        </thead>

        <tbody>

          {products.map((product) => (

            <tr
              key={product.id}
              className="border-b hover:bg-slate-50"
            >

              <td className="p-4">

                {product.image_url ? (

                  <img
                    src={product.image_url}
                    alt={product.title}
                    className="h-16 w-16 rounded-lg object-cover"
                  />

                ) : (

                  <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-200 text-xs">
                    No Image
                  </div>

                )}

              </td>

              <td>

                <p className="font-semibold">
                  {product.title}
                </p>

                <p className="text-sm text-slate-500">
                  {product.description}
                </p>

              </td>

              <td>
                {product.category}
              </td>

              <td>
                KES {product.price.toLocaleString()}
              </td>

              <td>

                <span
                  className={
                    product.active
                      ? "font-semibold text-green-600"
                      : "font-semibold text-red-600"
                  }
                >
                  {product.active
                    ? "Active"
                    : "Inactive"}
                </span>

              </td>

              <td>

                {product.download_url ? (
                  <span className="text-green-600">
                    Uploaded
                  </span>
                ) : (
                  <span className="text-red-600">
                    Missing
                  </span>
                )}

              </td>

              <td className="space-x-2">

                <button
                  onClick={() =>
                    toggleProduct(product)
                  }
                  className="rounded-lg bg-yellow-500 px-3 py-2 text-white hover:bg-yellow-600"
                >
                  Toggle
                </button>

                <button
                  onClick={() =>
                    deleteProduct(product.id)
                  }
                  className="rounded-lg bg-red-600 px-3 py-2 text-white hover:bg-red-700"
                >
                  Delete
                </button>

              </td>

            </tr>

          ))}

        </tbody>

      </table>

    </div>
  );
}