// Claude-mascot-style pink blob with a playful 3-frame writing loop.
// Frame 1: wink + raises a tiny pencil.
// Frame 2: scribbles furiously (pencil zigzags, motion marks, mouth open).
// Frame 3: flourishes the finished sheet, sparkle + smile.
// No green anywhere — pink + heading + amber only. ~54×27.
export function WriterMascot({ className = "" }: { className?: string }) {
  return (
    <div className={`writer-mascot ${className}`} aria-label="writer mascot" role="img">
      <svg
        viewBox="0 0 18 9"
        width={54}
        height={27}
        shapeRendering="crispEdges"
      >
        {/* ─────────── Persistent pink blob (8w × 7h at x=1..8, y=1..7) ─────────── */}
        {/* Rounded top */}
        <rect x={2} y={1} width={6} height={1} className="wm-pink" />
        {/* Head widen */}
        <rect x={1} y={2} width={8} height={1} className="wm-pink" />
        {/* Eye row — pink sides, black eyes, pink middle */}
        <rect x={1} y={3} width={2} height={1} className="wm-pink" />
        <rect x={3} y={3} width={1} height={1} className="wm-dark" />
        <rect x={4} y={3} width={2} height={1} className="wm-pink" />
        <rect x={6} y={3} width={1} height={1} className="wm-dark" />
        <rect x={7} y={3} width={2} height={1} className="wm-pink" />
        {/* Body rows */}
        <rect x={1} y={4} width={8} height={1} className="wm-pink" />
        <rect x={1} y={5} width={8} height={1} className="wm-pink" />
        {/* Tentacle-root row */}
        <rect x={1} y={6} width={1} height={1} className="wm-pink" />
        <rect x={3} y={6} width={2} height={1} className="wm-pink" />
        <rect x={6} y={6} width={1} height={1} className="wm-pink" />
        <rect x={8} y={6} width={1} height={1} className="wm-pink" />
        {/* Tentacle tips */}
        <rect x={1} y={7} width={1} height={1} className="wm-pink" />
        <rect x={4} y={7} width={1} height={1} className="wm-pink" />
        <rect x={8} y={7} width={1} height={1} className="wm-pink" />

        {/* ============ Frame 1: wink + raise pencil ============ */}
        <g className="wm-frame wm-f1">
          {/* Wink: cover left eye with pink, then draw a closed-eye line above */}
          <rect x={3} y={3} width={1} height={1} className="wm-pink" />
          <rect x={2} y={2} width={3} height={1} className="wm-dark" />
          {/* Raised right tentacle */}
          <rect x={9} y={3} width={1} height={1} className="wm-pink" />
          <rect x={9} y={2} width={1} height={1} className="wm-pink" />
          {/* Pencil held tip-down (ready to write) */}
          <rect x={10} y={1} width={1} height={1} className="wm-pink" />
          <rect x={10} y={2} width={1} height={1} className="wm-light" />
          <rect x={10} y={3} width={1} height={1} className="wm-dark" />
          {/* Thinking sparkle blinks */}
          <g className="wm-blink">
            <rect x={12} y={0} width={1} height={1} className="wm-light" />
            <rect x={14} y={2} width={1} height={1} className="wm-light" />
          </g>
        </g>

        {/* ============ Frame 2: scribble scribble ============ */}
        <g className="wm-frame wm-f2">
          {/* Concentrated open mouth */}
          <rect x={4} y={4} width={2} height={1} className="wm-dark" />
          {/* Extended tentacle carrying pencil */}
          <rect x={9} y={4} width={1} height={1} className="wm-pink" />
          <rect x={10} y={4} width={1} height={1} className="wm-pink" />
          {/* Diagonal pencil scratching */}
          <g className="wm-shake">
            <rect x={13} y={2} width={1} height={1} className="wm-pink" />
            <rect x={12} y={3} width={1} height={1} className="wm-light" />
            <rect x={11} y={4} width={1} height={1} className="wm-dark" />
          </g>
          {/* Scribble squiggles (flicker via wm-type-lines) */}
          <g className="wm-type-lines">
            <rect x={12} y={5} width={1} height={1} className="wm-dark" />
            <rect x={13} y={5} width={1} height={1} className="wm-dark" />
            <rect x={14} y={4} width={1} height={1} className="wm-dark" />
            <rect x={15} y={5} width={1} height={1} className="wm-dark" />
            <rect x={16} y={4} width={1} height={1} className="wm-dark" />
          </g>
          {/* Paper strip emerging (half-sheet) */}
          <rect x={11} y={6} width={6} height={1} className="wm-dark" />
          <rect x={11} y={7} width={6} height={1} className="wm-light" />
          <rect x={11} y={7} width={1} height={1} className="wm-dark" />
          <rect x={16} y={7} width={1} height={1} className="wm-dark" />
          {/* Sweat drop */}
          <g className="wm-blink">
            <rect x={2} y={0} width={1} height={1} className="wm-light" />
          </g>
        </g>

        {/* ============ Frame 3: flourish the finished page ============ */}
        <g className="wm-frame wm-f3">
          {/* Smile: little mouth curl */}
          <rect x={4} y={4} width={1} height={1} className="wm-dark" />
          <rect x={5} y={4} width={1} height={1} className="wm-dark" />
          {/* Tentacle lifting paper up */}
          <rect x={9} y={3} width={1} height={1} className="wm-pink" />
          <rect x={9} y={4} width={1} height={1} className="wm-pink" />
          <rect x={10} y={3} width={1} height={1} className="wm-pink" />
          {/* Paper held high */}
          <rect x={11} y={0} width={6} height={6} className="wm-light" />
          <rect x={11} y={0} width={1} height={6} className="wm-dark" />
          <rect x={16} y={0} width={1} height={6} className="wm-dark" />
          <rect x={11} y={0} width={6} height={1} className="wm-dark" />
          <rect x={11} y={5} width={6} height={1} className="wm-dark" />
          {/* Text lines on paper */}
          <rect x={12} y={1} width={4} height={1} className="wm-dark" />
          <rect x={12} y={2} width={3} height={1} className="wm-dark" />
          <rect x={12} y={3} width={4} height={1} className="wm-dark" />
          <rect x={12} y={4} width={2} height={1} className="wm-dark" />
          {/* Celebration sparkles */}
          <g className="wm-sparkle">
            <rect x={14} y={7} width={1} height={1} className="wm-light" />
            <rect x={17} y={2} width={1} height={1} className="wm-light" />
            <rect x={0} y={2} width={1} height={1} className="wm-light" />
          </g>
        </g>
      </svg>
    </div>
  );
}
