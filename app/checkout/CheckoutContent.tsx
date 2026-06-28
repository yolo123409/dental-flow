"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Product = {
  id: string;
  title: string;
  description: string;
  price: number;
};

export default function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const productId = searchParams.get("product");

  const [product, setProduct] = useState<Product | null>(null);

  const [transactionCode, setTransactionCode] = useState("");

  const [paymentMethod, setPaymentMethod] = useState("M-Pesa");

  const [loading, setLoading] = useState(false);

  const [success, setSuccess] = useState(false);

  useEffect(() => {
    initialise();
  }, []);

  async function initialise() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/auth/login");
      return;
    }

    if (!productId) return;

    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .single();

    if (error) {
      console.error(error);
      return;
    }

    setProduct(data);
  }

  async function submitOrder() {
    if (!product) {
      alert("Product not found.");
      return;
    }

    if (!transactionCode.trim()) {
      alert("Please enter your transaction code.");
      return;
    }

    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/auth/login");
      return;
    }

    const { error } = await supabase.from("orders").insert({
      user_id: user.id,
      customer_email: user.email,
      product_id: product.id,
      amount: product.price,
      payment_method: paymentMethod,
      payment_status: "Pending",
      transaction_code: transactionCode,
      approved: false,
    });

    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    setSuccess(true);
  }

  if (success) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="max-w-xl rounded-2xl bg-white p-10 text-center shadow-xl">

          <h1 className="text-4xl font-bold text-green-600">
            Payment Submitted
          </h1>

          <p className="mt-6 text-slate-600">
            Your payment has been submitted successfully.
          </p>

          <p className="mt-3 text-slate-600">
            Once approved by the admin,
            your AI system will automatically
            appear inside your dashboard.
          </p>

          <Link
            href="/dashboard"
            className="mt-8 inline-block rounded-xl bg-blue-600 px-8 py-4 font-semibold text-white hover:bg-blue-700"
          >
            Go to Dashboard
          </Link>

        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100">

      <div className="mx-auto max-w-3xl px-6 py-20">

        <Link
          href="/"
          className="text-blue-600 hover:underline"
        >
          ← Back
        </Link>

        <div className="mt-8 rounded-2xl bg-white p-10 shadow-xl">

          <h1 className="text-4xl font-bold">
            Checkout
          </h1>

                    {product ? (
            <div className="mt-8 rounded-xl border bg-slate-50 p-6">

              <h2 className="text-2xl font-bold">
                {product.title}
              </h2>

              <p className="mt-2 text-slate-600">
                {product.description}
              </p>

              <p className="mt-6 text-3xl font-bold text-blue-600">
                KES {product.price.toLocaleString()}
              </p>

            </div>
          ) : (
            <div className="mt-8 rounded-xl border bg-slate-50 p-6 text-center">
              <p className="text-slate-500">
                Loading product...
              </p>
            </div>
          )}

          <div className="mt-8 rounded-xl border bg-slate-50 p-6">

            <h2 className="text-2xl font-bold">
              Payment Instructions
            </h2>

            <div className="mt-6">

              <p className="font-semibold">
                M-Pesa Paybill
              </p>

              <p className="mt-1 text-3xl font-bold">
                123456
              </p>

            </div>

            <div className="mt-6">

              <p className="font-semibold">
                Account Reference
              </p>

              <p className="mt-1">
                Dental Flow
              </p>

            </div>

          </div>

          <div className="mt-8">

            <label className="font-semibold">
              Payment Method
            </label>

            <select
              className="mt-2 w-full rounded-xl border p-3"
              value={paymentMethod}
              onChange={(e) =>
                setPaymentMethod(e.target.value)
              }
            >
              <option>M-Pesa</option>
              <option>Bank Transfer</option>
            </select>

          </div>

          <div className="mt-8">

            <label className="font-semibold">
              Transaction Code
            </label>

            <input
              className="mt-2 w-full rounded-xl border p-3"
              placeholder="e.g. SGK8P4L2Q"
              value={transactionCode}
              onChange={(e) =>
                setTransactionCode(e.target.value)
              }
            />

          </div>

          <button
            onClick={submitOrder}
            disabled={loading}
            className="mt-10 w-full rounded-xl bg-blue-600 py-4 text-lg font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            {loading
              ? "Submitting..."
              : "Submit Payment"}
          </button>

        </div>

      </div>

    </main>
  );
}