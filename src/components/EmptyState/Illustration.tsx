type Variant = 'chat' | 'contacts' | 'search' | 'lock' | 'call' | 'offline' | 'saved';

/** Original black-line sticker artwork with restrained yellow, pink and mint accents. */
export function Illustration({ variant = 'chat', size = 148 }: { variant?: Variant; size?: number }) {
  const common = { stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 160 130" width={size} height={(size * 130) / 160} className="stamp" aria-hidden focusable="false">
      <g transform="rotate(-3 80 65)">
        {variant === 'chat' && (
          <>
            <path d="M24 34c0-8 6-14 14-14h68c8 0 14 6 14 14v36c0 8-6 14-14 14H66l-18 14v-14h-10c-8 0-14-6-14-14Z" fill="var(--c-yellow)" {...common} />
            <path d="M46 48h48M46 61h32" {...common} />
            <path d="M113 57c13 1 22 9 22 20 0 12-9 19-20 19h-5v10l-12-10" fill="var(--surface)" {...common} />
            <circle cx="39" cy="96" r="8" fill="var(--c-pink)" {...common} />
            <path d="M128 24l4 8 8 3-8 3-4 9-3-9-8-3 8-3Z" fill="var(--c-mint)" {...common} />
          </>
        )}
        {variant === 'contacts' && (
          <>
            <circle cx="57" cy="42" r="21" fill="var(--c-pink)" {...common} />
            <path d="M24 98c0-18 15-30 33-30s33 12 33 30" fill="var(--c-yellow)" {...common} />
            <circle cx="108" cy="54" r="17" fill="var(--c-mint)" {...common} />
            <path d="M83 100c2-14 12-24 26-24 15 0 25 10 27 24" fill="var(--surface)" {...common} />
            <path d="M43 41l6 6 11-12" {...common} />
            <path d="M129 91l5 8" {...common} />
          </>
        )}
        {variant === 'search' && (
          <>
            <circle cx="67" cy="55" r="31" fill="var(--c-yellow)" {...common} />
            <path d="M90 79l24 24" {...common} />
            <path d="M51 51h32M51 63h21" {...common} />
            <path d="M31 22l5 10 10 4-10 3-5 11-4-11-10-3 10-4Z" fill="var(--c-pink)" {...common} />
          </>
        )}
        {variant === 'lock' && (
          <>
            <rect x="43" y="54" width="74" height="54" rx="15" fill="var(--c-mint)" {...common} />
            <path d="M59 54V42a21 21 0 0 1 42 0v12" {...common} />
            <circle cx="80" cy="79" r="6" fill="currentColor" />
            <path d="M80 85v10" {...common} />
            <path d="M130 36l4 8 9 3-9 4-4 8-3-8-9-4 9-3Z" fill="var(--c-yellow)" {...common} />
          </>
        )}
        {variant === 'call' && (
          <>
            <path d="M39 34c6-6 15-5 20 1l9 11c4 6 3 13-2 18l-5 5c6 11 15 19 26 25l5-6c5-5 12-6 18-2l11 9c6 5 7 14 1 20-7 8-19 12-30 8-25-10-46-31-56-56-4-12 0-23 3-29Z" fill="var(--c-yellow)" {...common} />
            <path d="M103 26c14 5 25 16 30 30" {...common} />
            <path d="M105 40c8 3 15 10 18 18" {...common} />
            <circle cx="28" cy="98" r="9" fill="var(--c-pink)" {...common} />
          </>
        )}
        {variant === 'offline' && (
          <>
            <path d="M26 83c14-13 33-20 54-20 20 0 39 7 53 20" {...common} />
            <path d="M48 99c9-8 20-12 32-12s23 4 32 12" {...common} />
            <circle cx="80" cy="110" r="5" fill="var(--c-mint)" {...common} />
            <path d="M49 38l62 62" stroke="var(--error)" strokeWidth="5" strokeLinecap="round" />
            <circle cx="80" cy="60" r="45" fill="none" stroke="var(--c-yellow)" strokeWidth="7" strokeDasharray="4 12" opacity=".55" />
          </>
        )}
        {variant === 'saved' && (
          <>
            <path d="M44 30h72v74l-36-22-36 22Z" fill="var(--c-yellow)" {...common} />
            <path d="M63 53h34M63 66h24" {...common} />
            <path d="M126 82c9 0 15 6 15 14s-7 13-16 13c-4 0-8-1-11-3l-8 4 2-9c-3-3-4-7-4-11 0-8 8-13 17-13Z" fill="var(--c-pink)" {...common} />
          </>
        )}
      </g>
    </svg>
  );
}
