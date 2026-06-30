"use client";

import { motion, HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/cn";
import React from "react";

export interface GlassButtonProps extends HTMLMotionProps<"button"> {
  variant?: "solid" | "ghost" | "glass";
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
  className?: string;
}

export function GlassButton({
  variant = "solid",
  size = "md",
  children,
  className,
  ...props
}: GlassButtonProps) {
  const variants = {
    solid: "bg-neutral-900 text-white hover:bg-neutral-800 border border-transparent shadow-lg shadow-neutral-900/20",
    ghost: "bg-transparent text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100/50",
    glass: "bg-white/10 backdrop-blur-md border border-white/20 text-neutral-900 shadow-xl shadow-black/5 hover:bg-white/20",
  };

  const sizes = {
    sm: "px-4 py-2 text-xs",
    md: "px-6 py-3 text-sm",
    lg: "px-8 py-4 text-base",
  };

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.95 }}
      className={cn(
        "relative rounded-full font-medium transition-colors duration-300 flex items-center justify-center gap-2",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </motion.button>
  );
}
