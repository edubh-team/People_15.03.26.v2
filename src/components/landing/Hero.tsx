"use client";

import { motion } from "framer-motion";
import { GlassButton } from "@/components/ui/GlassButton";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

export function Hero() {
  return (
    <section className="relative min-h-[90vh] flex flex-col items-center justify-center overflow-hidden pt-20">
      {/* Background Gradient Mesh */}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-100/40 via-white to-white" />
      
      {/* Animated Orb/Glow */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 2, ease: "easeOut" }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-indigo-300/20 rounded-full blur-[120px] -z-10"
      />

      <div className="container mx-auto px-4 flex flex-col items-center text-center z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="mb-6"
        >
          <span className="px-4 py-1.5 rounded-full bg-white/50 backdrop-blur-sm border border-neutral-200 text-neutral-600 text-xs font-medium tracking-wide uppercase">
            v2.0 Now Available
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="text-6xl md:text-8xl font-semibold tracking-tighter text-neutral-900 mb-8 max-w-4xl"
        >
          Intelligence, <br className="hidden md:block" />
          <span className="text-transparent bg-clip-text bg-gradient-to-br from-neutral-900 to-neutral-500">
            Distributed.
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="text-lg md:text-xl text-neutral-500 max-w-2xl mb-12 leading-relaxed"
        >
          The all-in-one workspace for modern sales teams. 
          Lead management, attendance tracking, and military-grade encryption.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.8 }}
          className="flex flex-col sm:flex-row gap-4 items-center"
        >
          <Link href="/sign-in">
            <GlassButton size="lg" className="px-8 py-4 text-base">
              Get Started
              <ArrowRight className="w-4 h-4" />
            </GlassButton>
          </Link>
          <GlassButton variant="ghost" size="lg" className="px-8 py-4 text-base">
            View Demo
          </GlassButton>
        </motion.div>

        {/* Abstract Dashboard Visual */}
        <motion.div
          initial={{ opacity: 0, y: 100, rotateX: 20 }}
          animate={{ opacity: 1, y: 0, rotateX: 10 }}
          transition={{ duration: 1.2, delay: 1, type: "spring" }}
          className="mt-20 w-full max-w-5xl aspect-[16/9] bg-white rounded-t-3xl shadow-2xl border border-neutral-200 overflow-hidden relative group perspective-1000"
          style={{ transformStyle: "preserve-3d", transform: "perspective(1000px) rotateX(10deg)" }}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
             {/* Mockup Content Placeholder */}
             <div className="text-neutral-300 font-medium text-lg tracking-widest uppercase">
                Dashboard Preview
             </div>
             {/* Decorative Grid */}
             <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />
          </div>
          
          {/* Glass Overlay on Mockup */}
          <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-white/80 to-transparent" />
        </motion.div>
      </div>
    </section>
  );
}
