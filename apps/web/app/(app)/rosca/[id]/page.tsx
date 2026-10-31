import { Suspense } from "react";
import { PageSkeleton } from "@/components/app/States";
import { RoscaScreen } from "../RoscaScreens";

export default function Page() {
  return <Suspense fallback={<div className="oi-col"><PageSkeleton rows={3} /></div>}><RoscaScreen /></Suspense>;
}
