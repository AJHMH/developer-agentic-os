export function Constellation() {
  const dots = Array.from({ length: 72 }, (_, index) => {
    const angle = index * 137.5;
    const radius = 24 + (index % 18) * 10;
    const x = 350 + Math.cos((angle * Math.PI) / 180) * radius;
    const y = 318 + Math.sin((angle * Math.PI) / 180) * radius * 0.86;
    return { x, y, hot: index % 11 === 0 };
  });

  return (
    <svg
      className="constellation"
      viewBox="0 0 700 620"
      role="img"
      aria-label="Workspace constellation map"
    >
      {dots.slice(0, 46).map((dot, index) => {
        const target = dots[(index * 7 + 9) % dots.length];
        return (
          <line
            key={`line-${index}`}
            x1={dot.x.toFixed(1)}
            y1={dot.y.toFixed(1)}
            x2={target.x.toFixed(1)}
            y2={target.y.toFixed(1)}
            stroke="rgba(232,216,188,0.11)"
            strokeWidth="1"
          />
        );
      })}
      {dots.map((dot, index) => (
        <circle
          key={`dot-${index}`}
          cx={dot.x.toFixed(1)}
          cy={dot.y.toFixed(1)}
          r={dot.hot ? 2.2 : 1.3}
          fill={dot.hot ? "#ff6a1b" : "rgba(243,238,229,0.58)"}
        />
      ))}
    </svg>
  );
}
