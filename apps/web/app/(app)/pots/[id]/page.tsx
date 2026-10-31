import { Suspense } from "react";
import { PageSkeleton } from "@/components/app/States";
import { PotDetail } from "./PotDetail";

export default function Page() {
  return (
    <Suspense fallback={<div className="oi-col"><PageSkeleton balance rows={3} /></div>}>
      <PotDetail />
    </Suspense>
  );
}
