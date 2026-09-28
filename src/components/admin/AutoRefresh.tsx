"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [on, router, seconds]);
  return (
    <label className="no-print inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-semibold">
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="h-5 w-5" />
      {seconds} sn&apos;de bir yenile
    </label>
  );
}
