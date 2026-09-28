"use client";
import { useEffect, useRef, useState } from "react";

interface Props {
  src: string;
  size?: number;
  className?: string;
}

/** Logo dosyası yoksa (henüz eklenmediyse) yazılı rozet gösterir; sayfa bozulmaz. */
export function LionsLogo({ src, size = 44, className }: Props) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) {
    return (
      <span
        role="img"
        aria-label="118-Y Lions"
        className={`inline-flex items-center justify-center rounded-full bg-purple font-extrabold text-gold ${className ?? ""}`}
        style={{ width: size, height: size, fontSize: size * 0.28 }}
      >
        118-Y
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src}
      alt="118-Y Lions logosu"
      width={size}
      height={size}
      className={className}
      style={{ width: "auto", height: size, objectFit: "contain" }}
      onError={() => setFailed(true)}
    />
  );
}
