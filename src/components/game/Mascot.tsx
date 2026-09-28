/** Sevimli diş karakteri (satır içi SVG, ek istek yok). */
export function Mascot({ size = 150, cheer = false }: { size?: number; cheer?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Gülen diş karakteri" className="anim-float">
      <ellipse cx="60" cy="112" rx="34" ry="5" fill="rgba(0,0,0,0.18)" />
      <path
        d="M60 12c-14-9-38-2-38 24 0 16 8 22 9 40 1 16 12 20 15 6 2-9 12-9 14 0 3 14 14 10 15-6 1-18 9-24 9-40 0-26-24-33-24-24z"
        fill="#fffdf6"
        stroke="#cfc5ac"
        strokeWidth="3"
        transform="translate(0,-2)"
      />
      <path d="M36 30c2-8 9-12 15-12" stroke="#fff" strokeWidth="6" strokeLinecap="round" fill="none" opacity="0.9" />
      <circle cx="48" cy="52" r="5" fill="#1c1038" />
      <circle cx="72" cy="52" r="5" fill="#1c1038" />
      <circle cx="49.5" cy="50.5" r="1.7" fill="#fff" />
      <circle cx="73.5" cy="50.5" r="1.7" fill="#fff" />
      <circle cx="40" cy="64" r="5" fill="#ff8fa3" opacity="0.7" />
      <circle cx="80" cy="64" r="5" fill="#ff8fa3" opacity="0.7" />
      {cheer ? (
        <path d="M48 64q12 14 24 0z" fill="#5a1a2e" stroke="#1c1038" strokeWidth="3" strokeLinejoin="round" />
      ) : (
        <path d="M48 64q12 12 24 0" stroke="#1c1038" strokeWidth="4" fill="none" strokeLinecap="round" />
      )}
      <g fill="#f5b800">
        <path d="M100 26l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" />
        <path d="M16 74l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
      </g>
    </svg>
  );
}
