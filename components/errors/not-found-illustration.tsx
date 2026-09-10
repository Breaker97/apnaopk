"use client";

import { cn } from "@/lib/utils";

interface NotFoundIllustrationProps {
  className?: string;
  variant?: "default" | "admin" | "vendor" | "store";
}

export function NotFoundIllustration({
  className,
  variant = "default",
}: NotFoundIllustrationProps) {
  const accentColor = {
    default: "var(--primary)",
    admin: "var(--primary)",
    vendor: "var(--chart-2)",
    store: "var(--primary)",
  }[variant];

  return (
    <div className={cn("relative", className)}>
      <svg
        viewBox="0 0 400 300"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-auto"
        aria-hidden="true"
      >
        {/* Background circles with pulse animation */}
        <circle
          cx="200"
          cy="150"
          r="120"
          className="fill-muted/30 animate-pulse"
          style={{ animationDuration: "3s" }}
        />
        <circle
          cx="200"
          cy="150"
          r="90"
          className="fill-muted/50 animate-pulse"
          style={{ animationDuration: "2.5s", animationDelay: "0.5s" }}
        />

        {/* 404 Text with floating animation */}
        <g className="animate-bounce" style={{ animationDuration: "3s" }}>
          <text
            x="200"
            y="165"
            textAnchor="middle"
            className="fill-foreground/10 text-[120px] font-bold"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            404
          </text>
        </g>

        {/* Magnifying glass with search motion */}
        <g
          className="origin-center"
          style={{
            animation: "searchMotion 4s ease-in-out infinite",
          }}
        >
          {/* Glass circle */}
          <circle
            cx="180"
            cy="130"
            r="45"
            stroke={accentColor}
            strokeWidth="6"
            fill="none"
            className="opacity-80"
          />
          {/* Inner glass reflection */}
          <ellipse
            cx="165"
            cy="118"
            rx="15"
            ry="10"
            fill="currentColor"
            className="fill-background/60"
            transform="rotate(-30 165 118)"
          />
          {/* Handle */}
          <line
            x1="215"
            y1="165"
            x2="250"
            y2="200"
            stroke={accentColor}
            strokeWidth="8"
            strokeLinecap="round"
            className="opacity-80"
          />
        </g>

        {/* Question marks floating around */}
        <g className="animate-pulse" style={{ animationDuration: "2s" }}>
          <text
            x="100"
            y="100"
            className="fill-muted-foreground/40 text-2xl"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            ?
          </text>
        </g>
        <g
          className="animate-pulse"
          style={{ animationDuration: "2.5s", animationDelay: "0.3s" }}
        >
          <text
            x="300"
            y="90"
            className="fill-muted-foreground/30 text-3xl"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            ?
          </text>
        </g>
        <g
          className="animate-pulse"
          style={{ animationDuration: "2.2s", animationDelay: "0.7s" }}
        >
          <text
            x="320"
            y="180"
            className="fill-muted-foreground/35 text-xl"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            ?
          </text>
        </g>
        <g
          className="animate-pulse"
          style={{ animationDuration: "1.8s", animationDelay: "0.5s" }}
        >
          <text
            x="80"
            y="190"
            className="fill-muted-foreground/25 text-2xl"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            ?
          </text>
        </g>

        {/* Decorative dots */}
        <circle cx="120" cy="230" r="4" className="fill-muted-foreground/20" />
        <circle cx="280" cy="240" r="3" className="fill-muted-foreground/15" />
        <circle cx="330" cy="120" r="5" className="fill-muted-foreground/20" />
        <circle cx="70" cy="140" r="3" className="fill-muted-foreground/15" />

        {/* Broken link chain */}
        <g className="opacity-60">
          {/* Left chain link */}
          <rect
            x="140"
            y="220"
            width="30"
            height="16"
            rx="8"
            stroke="currentColor"
            strokeWidth="3"
            fill="none"
            className="stroke-muted-foreground/50"
          />
          {/* Right chain link - broken away */}
          <rect
            x="230"
            y="220"
            width="30"
            height="16"
            rx="8"
            stroke="currentColor"
            strokeWidth="3"
            fill="none"
            className="stroke-muted-foreground/50"
            transform="rotate(15 245 228)"
          />
          {/* Broken pieces */}
          <line
            x1="175"
            y1="228"
            x2="195"
            y2="228"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="4 4"
            className="stroke-muted-foreground/30"
          />
        </g>
      </svg>

      {/* Global keyframes, not styled-jsx: that runtime cost 20 KB on every
          storefront page for one animation, and the name is unique. */}
      <style>{`
        @keyframes searchMotion {
          0%,
          100% {
            transform: translate(0, 0) rotate(0deg);
          }
          25% {
            transform: translate(5px, -3px) rotate(5deg);
          }
          50% {
            transform: translate(-3px, 2px) rotate(-3deg);
          }
          75% {
            transform: translate(3px, 3px) rotate(2deg);
          }
        }
      `}</style>
    </div>
  );
}
