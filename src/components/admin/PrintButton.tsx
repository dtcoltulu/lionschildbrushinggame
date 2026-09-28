"use client";
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="no-print min-h-[44px] rounded-full bg-purple px-5 font-bold text-white">
      Yazdır / PDF olarak kaydet
    </button>
  );
}
