"use client";

import { motion } from "framer-motion";
import { Users, Shield, Video } from "lucide-react";

const features = [
  {
    title: "Smart Assignment",
    description: "Route leads instantly based on hierarchy and performance metrics.",
    icon: Users,
    colSpan: "col-span-1 md:col-span-1",
    delay: 0.2,
  },
  {
    title: "Zero Knowledge Security",
    description: "E2EE chat ensures we can't read your messages. Your data is yours alone.",
    icon: Shield,
    colSpan: "col-span-1 md:col-span-1",
    delay: 0.3,
  },
  {
    title: "One-Click Meet",
    description: "Auto-generated standups and seamless Google Meet integration.",
    icon: Video,
    colSpan: "col-span-1 md:col-span-1",
    delay: 0.4,
  },
];

export function FeatureGrid() {
  return (
    <section className="py-32 bg-white">
      <div className="container mx-auto px-4">
        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="mb-16 text-center"
        >
          <h2 className="text-4xl font-semibold tracking-tight text-neutral-900 mb-4">
            Designed for Speed. Built for Scale.
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {features.map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: feature.delay }}
              whileHover={{ scale: 1.02 }}
              className={`group p-8 rounded-3xl bg-gray-50 border border-gray-100 hover:shadow-xl hover:shadow-gray-200/50 transition-all duration-300 ${feature.colSpan}`}
            >
              <div className="h-12 w-12 rounded-2xl bg-white shadow-sm flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                <feature.icon className="w-6 h-6 text-neutral-900" />
              </div>
              <h3 className="text-xl font-semibold text-neutral-900 mb-3">
                {feature.title}
              </h3>
              <p className="text-neutral-500 leading-relaxed">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
