/** Glyph geometry from assets/linkcode.icon/Assets/foreground.svg, in stagger order. */
const GLYPH_RECTS = [
  { x: 39, y: 64.9924, width: 27.3358, height: 54.6716 },
  { x: 66.3359, y: 119.664, width: 28.9925, height: 27.3358 },
  { x: 95.3281, y: 64.9924, width: 27.3358, height: 54.6716 },
  { x: 122.664, y: 119.664, width: 27.3358, height: 27.3358 },
];
const ACCENT_RECT = { x: 122.664, y: 37.6567, width: 27.3358, height: 27.3358 };
const CORNER_RADIUS = 9.9403;
const BEAT_SECONDS = 1.6;
const STAGGER_SECONDS = 0.15;

/**
 * The LinkCode mark as a self-animating inline SVG: the glyph bars breathe in a stagger and the
 * accent dot answers last. SMIL keeps it dependency-free and self-contained; the glyph renders in
 * `currentColor` so it follows the theme, while the accent keeps the brand red.
 */
export function AnimatedMark({
  size = 96,
  className,
}: {
  size?: number;
  className?: string;
}): React.ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 180 180"
      fill="none"
      role="img"
      aria-label="LinkCode"
      className={className}
    >
      {GLYPH_RECTS.map((rect, index) => (
        <rect key={`${rect.x}-${rect.y}`} {...rect} rx={CORNER_RADIUS} fill="currentColor">
          <animate
            attributeName="opacity"
            values="0.25;1;0.25"
            dur={`${BEAT_SECONDS}s`}
            begin={`${index * STAGGER_SECONDS}s`}
            repeatCount="indefinite"
          />
        </rect>
      ))}
      <rect {...ACCENT_RECT} rx={CORNER_RADIUS} fill="#FF0000">
        <animate
          attributeName="opacity"
          values="0.25;1;0.25"
          dur={`${BEAT_SECONDS}s`}
          begin={`${GLYPH_RECTS.length * STAGGER_SECONDS}s`}
          repeatCount="indefinite"
        />
      </rect>
    </svg>
  );
}
