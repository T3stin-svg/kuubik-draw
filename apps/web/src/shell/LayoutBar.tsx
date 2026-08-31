import type { ReactNode } from "react";
import { CadIcon } from "../icons/CadIcon.js";

interface LayoutBarProps {
  layouts: readonly { id: string; name: string }[];
  activeLayoutId: string;
  activeSpace: string;
  onActivate: (id: string) => void;
  onCreate: () => void;
  children: ReactNode;
}

export function LayoutBar({ layouts, activeLayoutId, activeSpace, onActivate, onCreate, children }: LayoutBarProps) {
  return (
    <section className="layoutbar" aria-label="Model ja Layout vahelehed" data-visual-zone="layout-status">
      {layouts.map((layout) => (
        <button key={layout.id} type="button" className={layout.id === activeLayoutId ? "layout-tab active" : "layout-tab"} aria-pressed={layout.id === activeLayoutId} onClick={() => onActivate(layout.id)}>{layout.name}</button>
      ))}
      <button type="button" className="layout-action layout-add" aria-label="Lisa paigutus" onClick={onCreate}><CadIcon name="add" /></button>
      {children}
      <span className="layout-space">{activeSpace}</span>
    </section>
  );
}
