import { ReactNode } from "react";

import Reveal from "@/components/marketing/Reveal";

interface Props {
  id?: string;
  eyebrow: string;
  title: string;
  description: string;
  reverse?: boolean;
  visual: ReactNode;
}

export default function FeatureRow({
  id,
  eyebrow,
  title,
  description,
  reverse = false,
  visual,
}: Props) {
  return (
    <div
      id={id}
      className="mx-auto grid max-w-6xl scroll-mt-24 items-center gap-12 px-6 py-16 lg:grid-cols-2 lg:gap-20 lg:py-20"
    >
      <Reveal
        direction={reverse ? "right" : "left"}
        className={reverse ? "lg:order-2" : ""}
      >
        <span className="text-sm font-semibold uppercase tracking-wide text-eucalyptus">
          {eyebrow}
        </span>

        <h3 className="mt-3 font-display text-3xl font-bold leading-tight text-graphite text-balance sm:text-4xl">
          {title}
        </h3>

        <p className="mt-4 max-w-md text-base leading-7 text-mineral text-pretty">
          {description}
        </p>
      </Reveal>

      <Reveal
        direction={reverse ? "left" : "right"}
        delay={0.1}
        className={reverse ? "lg:order-1" : ""}
      >
        {visual}
      </Reveal>
    </div>
  );
}
