import * as React from "react";
import * as Icons from "lucide-react";

// Normalize arbitrary icon names from backend to lucide-react export keys
function normalizeIconName(name?: string): string | null {
  if (!name) return null;
  let n = String(name).trim();
  if (!n) return null;

  // Common alias cleanups
  n = n.replace(/icon$/i, ""); // e.g., SettingsIcon -> Settings

  // Replace non-alphanumerics with spaces, then PascalCase
  const parts = n
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  if (parts.length === 0) return null;
  return parts.join("");
}

export type LucideComponent = React.ComponentType<{ className?: string }>;

export function getLucideIcon(name?: string, fallback?: LucideComponent): LucideComponent {
  const norm = normalizeIconName(name) || undefined;
  const cand = (norm && (Icons as any)[norm]) as LucideComponent | undefined;
  if (cand) return cand;
  // Second chance: if name ends with a digit separated (e.g., BarChart-3), try removing separators only
  if (!cand && name) {
    const compact = name.replace(/[^a-zA-Z0-9]/g, "");
    const alt = (Icons as any)[compact] as LucideComponent | undefined;
    if (alt) return alt;
  }
  // Default fallback
  return (Icons as any).FileText as LucideComponent || (fallback || ((props: any) => React.createElement('span', props)));
}

// Convenience component
export const LucideIcon: React.FC<{ name?: string; className?: string; fallbackName?: string }>
  = ({ name, className, fallbackName }) => {
    const Comp = getLucideIcon(name, getLucideIcon(fallbackName));
    return <Comp className={className} />;
  };

export default LucideIcon;
