import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Oiko",
    short_name: "Oiko",
    description: "Personal finance meets personal intelligence. Get paid from anywhere, plan every bit, and let your own AI agent help, on limits you set.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: "#F4F5F7",
    theme_color: "#3D5AFE",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
