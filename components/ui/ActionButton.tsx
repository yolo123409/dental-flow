"use client";

import { ReactNode } from "react";
import Button from "./Button";

interface Props {
  children: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
}

export default function ActionButton({
  children,
  icon,
  onClick,
}: Props) {
  return (
    <Button onClick={onClick}>

      <div className="flex items-center gap-2">

        {icon}

        <span>{children}</span>

      </div>

    </Button>
  );
}