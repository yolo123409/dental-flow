"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";

import {
  searchEverything,
  SearchResult,
} from "@/services/search";

export default function GlobalSearch() {
  const pathname = usePathname();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  // GlobalSearch lives in the persistent admin Topbar, not inside any
  // individual page, so it never unmounts on navigation - its query/
  // results state would otherwise survive from the old route onto the
  // new one. Close (and fully reset) on every pathname change so it
  // never overlays whatever page just loaded, no matter how navigation
  // was triggered (result click, back/forward, another nav link, etc).
  useEffect(() => {
    setQuery("");
    setResults([]);
  }, [pathname]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setResults([]);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setResults([]);
        inputRef.current?.blur();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  function handleSelectResult() {
    // Navigation itself is handled by the Link - this just makes sure
    // the dropdown/query are gone immediately rather than waiting on the
    // pathname-change effect, which only fires once the new route has
    // actually loaded and would otherwise leave the dropdown briefly
    // overlaying the destination page.
    setQuery("");
    setResults([]);
    inputRef.current?.blur();
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full max-w-md"
    >

      <Search
        size={18}
        className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
      />

      <input
        ref={inputRef}
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
              onClick={handleSelectResult}
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