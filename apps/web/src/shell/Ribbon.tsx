import type { ReactNode } from "react";

export function Ribbon({ children }: { children: ReactNode }) {
  return <section className="ribbon" aria-label="Joonestustööriistad" data-visual-zone="ribbon">{children}</section>;
}
