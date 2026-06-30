"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { GlassButton } from "@/components/ui/GlassButton";
import { Hero } from "@/components/landing/Hero";
import { FeatureGrid } from "@/components/landing/FeatureGrid";
import MainLogo from "@/assets/img/main.png";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-white selection:bg-neutral-900 selection:text-white">
      {/* Sticky Glass Header */}
      <motion.header
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.6, ease: "circOut" }}
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-white/70 backdrop-blur-xl border-b border-white/20 shadow-sm supports-[backdrop-filter]:bg-white/60"
      >
        <div className="flex items-center gap-2">
          <Image 
            src={MainLogo} 
            alt="People Logo" 
            width={32} 
            height={32} 
            className="h-8 w-8 rounded-lg object-contain"
          />
          <span className="font-semibold text-neutral-900 tracking-tight">People.</span>
        </div>

        <div className="flex items-center gap-4">
          <Link href="/sign-in">
            <GlassButton variant="ghost" size="sm" className="hidden sm:flex">
              Sign In
            </GlassButton>
          </Link>
          <Link href="/sign-in">
            <GlassButton variant="solid" size="sm">
              Get Started
            </GlassButton>
          </Link>
        </div>
      </motion.header>

      {/* Main Content */}
      <Hero />
      <FeatureGrid />
      
      {/* Simple Footer */}
      <footer className="py-8 border-t border-neutral-100 bg-white">
        <div className="container mx-auto px-4 text-center text-neutral-400 text-sm">
          <p>© {new Date().getFullYear()} People CRM. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}
