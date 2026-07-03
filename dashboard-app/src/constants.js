// Pipeline status metadata (label, accent color, background tint) keyed by status id.
export const STATUS = {
  new:         { label: "New",         color: "#38BDF8", bg: "#38BDF810" },
  processing:  { label: "Processing",  color: "#FBBF24", bg: "#FBBF2410" },
  parsed:      { label: "Parsed",      color: "#A78BFA", bg: "#A78BFA10" },
  ready:       { label: "Ready",       color: "#34D399", bg: "#34D39910" },
  distributed: { label: "Distributed", color: "#F472B6", bg: "#F472B610" },
  awaiting:    { label: "Awaiting",    color: "#FB923C", bg: "#FB923C10" },
  completed:   { label: "Done",        color: "#4ADE80", bg: "#4ADE8010" },
  error:       { label: "Error",       color: "#F87171", bg: "#F8717110" },
};
