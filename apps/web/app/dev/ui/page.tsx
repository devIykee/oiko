import type { Metadata } from "next";
import { Gallery } from "./Gallery";

export const metadata: Metadata = { title: "UI gallery", robots: { index: false } };
export default function Page() {
  return <Gallery />;
}
