"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

const links = [
  { href: "#features", label: "Features" },
  { href: "#security", label: "Security" },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <header
      className={`sticky top-0 z-50 transition-colors duration-300 ${
        scrolled
          ? "border-b border-sea-glass bg-enamel/85 backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="font-display text-xl font-bold text-eucalyptus"
        >
          Dental Flow
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-semibold text-graphite/80 transition-colors hover:text-eucalyptus"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            href="/auth/login"
            className="inline-flex min-h-10 items-center rounded-lg px-4 py-2.5 text-sm font-semibold text-graphite transition-colors hover:bg-sea-glass/60"
          >
            Log In
          </Link>

          <Link
            href="/auth/signup"
            className="inline-flex min-h-10 items-center rounded-lg bg-eucalyptus px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-deep-eucalyptus hover:shadow-md"
          >
            Get Started
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-graphite md:hidden"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      <div
        id="mobile-menu"
        className={`overflow-hidden border-t border-sea-glass bg-enamel transition-[max-height] duration-300 ease-out md:hidden ${
          menuOpen ? "max-h-80" : "max-h-0 border-t-0"
        }`}
      >
        <nav
          className="flex flex-col gap-1 px-6 py-4"
          aria-label="Mobile"
        >
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="min-h-11 rounded-lg px-3 py-3 text-base font-semibold text-graphite hover:bg-porcelain"
            >
              {link.label}
            </a>
          ))}

          <div className="mt-2 flex flex-col gap-2 border-t border-sea-glass pt-4">
            <Link
              href="/auth/login"
              onClick={() => setMenuOpen(false)}
              className="min-h-11 rounded-lg border border-sea-glass px-4 py-3 text-center text-base font-semibold text-graphite"
            >
              Log In
            </Link>

            <Link
              href="/auth/signup"
              onClick={() => setMenuOpen(false)}
              className="min-h-11 rounded-lg bg-eucalyptus px-4 py-3 text-center text-base font-semibold text-white"
            >
              Get Started
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
