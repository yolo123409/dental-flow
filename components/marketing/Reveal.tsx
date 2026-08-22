"use client";

import { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

type Direction = "up" | "left" | "right" | "none";

interface Props {
  children: ReactNode;
  direction?: Direction;
  delay?: number;
  className?: string;
  as?: "div" | "section";
}

const offsets: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: 28 },
  left: { x: -28, y: 0 },
  right: { x: 28, y: 0 },
  none: { x: 0, y: 0 },
};

/**
 * Thin client boundary around a scroll-triggered entrance. Server-rendered
 * section content is passed in as children, so only this wrapper (not the
 * content itself) needs to be a Client Component.
 */
export default function Reveal({
  children,
  direction = "up",
  delay = 0,
  className,
  as = "div",
}: Props) {
  const reduceMotion = useReducedMotion();
  const offset = offsets[direction];

  const Component = as === "section" ? motion.section : motion.div;

  return (
    <Component
      className={className}
      initial={
        reduceMotion
          ? { opacity: 0 }
          : { opacity: 0, x: offset.x, y: offset.y }
      }
      whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{
        duration: reduceMotion ? 0.4 : 0.7,
        delay: reduceMotion ? 0 : delay,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      {children}
    </Component>
  );
}
