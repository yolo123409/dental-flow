"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import {
  searchEverything,
  SearchResult,
} from "@/services/search";

export default function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timeout = setTimeout(async () => {
      const data = await searchEverything(query);
      setResults(data);
    }, 300);

    return () => clearTimeout(timeout);
  }, [query]);

  return (
    <div className="relative w-full max-w-md">

      <Search
        size={18}
        className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
      />

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search patients or dentists..."
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 outline-none transition focus:border-blue-500 focus:bg-white"
      />

      {results.length > 0 && (
        <div className="absolute mt-2 w-full overflow-hidden rounded-2xl border bg-white shadow-xl z-50">

          {results.map((result) => (
            <Link
              key={`${result.type}-${result.id}`}
              href={result.href}
              className="block border-b px-5 py-4 hover:bg-slate-50"
            >
              <p className="font-semibold">
                {result.title}
              </p>

              <p className="text-sm text-slate-500">
                {result.subtitle}
              </p>
            </Link>
          ))}

        </div>
      )}

    </div>
  );
}