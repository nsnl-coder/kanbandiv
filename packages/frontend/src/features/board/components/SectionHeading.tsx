import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  children: ReactNode;
}

export function SectionHeading({ icon: Icon, children }: Props) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground/80">
      <Icon className="h-4 w-4 text-muted" aria-hidden />
      {children}
    </h3>
  );
}
