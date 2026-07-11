"use client";

import { useCallback, useState } from "react";

import { toast } from "sonner";

import { supabase } from "@/lib/supabase";

type Props = {
  onSuccess: () => void;
};

export default function ProductForm({
  onSuccess,
}: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");

  const [image, setImage] =
    useState<File | null>(null);

  const [file, setFile] =
    useState<File | null>(null);

  const [loading, setLoading] =
    useState(false);

  const uploadImage = useCallback(async () => {
    if (!image) return null;

    const filename = `${Date.now()}-${image.name}`;

    const { error } = await supabase.storage
      .from("product-images")
      .upload(filename, image);

    if (error) throw error;

    const {
      data: { publicUrl },
    } = supabase.storage
      .from("product-images")
      .getPublicUrl(filename);

    return publicUrl;
  }, [image]);

  const uploadFile = useCallback(async () => {
    if (!file) return null;

    const filename = `${Date.now()}-${file.name}`;

    const { error } = await supabase.storage
      .from("product-files")
      .upload(filename, file);

    if (error) throw error;

    return filename;
  }, [file]);

  async function createProduct() {
    if (!title || !description || !price) {
      toast.error(
        "Please complete all required fields."
      );
      return;
    }

    try {
      setLoading(true);

      const imageUrl = await uploadImage();
      const downloadPath = await uploadFile();

      const { error } = await supabase
        .from("products")
        .insert({
          title,
          description,
          category,
          price: Number(price),
          image_url: imageUrl,
          download_url: downloadPath,
          active: true,
        });

      if (error) throw error;

      setTitle("");
      setDescription("");
      setCategory("");
      setPrice("");
      setImage(null);
      setFile(null);

      onSuccess();

      toast.success(
        "Product created successfully."
      );
    } catch (error: unknown) {
      console.error(error);

      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error(
          "Unable to create product."
        );
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white p-8 shadow">

      <h2 className="mb-6 text-3xl font-bold">
        Add Product
      </h2>

      <div className="grid gap-4">

        <input
          className="rounded-lg border p-3"
          placeholder="Title"
          value={title}
          onChange={(e) =>
            setTitle(e.target.value)
          }
        />

        <textarea
          className="rounded-lg border p-3"
          placeholder="Description"
          value={description}
          onChange={(e) =>
            setDescription(e.target.value)
          }
        />

        <input
          className="rounded-lg border p-3"
          placeholder="Category"
          value={category}
          onChange={(e) =>
            setCategory(e.target.value)
          }
        />

        <input
          className="rounded-lg border p-3"
          type="number"
          placeholder="Price"
          value={price}
          onChange={(e) =>
            setPrice(e.target.value)
          }
        />

        <div>

          <label className="font-semibold">
            Product Image
          </label>

          <input
            type="file"
            accept="image/*"
            className="mt-2"
            onChange={(e) =>
              setImage(
                e.target.files?.[0] ?? null
              )
            }
          />

        </div>

        <div>

          <label className="font-semibold">
            Digital Product
          </label>

          <input
            type="file"
            className="mt-2"
            onChange={(e) =>
              setFile(
                e.target.files?.[0] ?? null
              )
            }
          />

        </div>

        <button
          onClick={createProduct}
          disabled={loading}
          className="rounded-xl bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading
            ? "Uploading..."
            : "Create Product"}
        </button>

      </div>

    </div>
  );
}