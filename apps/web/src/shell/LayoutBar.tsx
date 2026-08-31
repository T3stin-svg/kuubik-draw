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
  const moveFocus = (button: HTMLButtonElement, direction: -1 | 1 | "first" | "last") => {
    const tablist = button.closest('[role="tablist"]');
    const tabs = [...(tablist?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
    const current = tabs.indexOf(button);
    const next = direction === "first" ? 0 : direction === "last" ? tabs.length - 1 : (current + direction + tabs.length) % tabs.length;
    const target = tabs[next];
    if (!target) return;
    target.focus();
    const id = target.dataset.layoutId;
    if (id) onActivate(id);
  };
  return (
    <section className="layoutbar" aria-label="Model ja Layout vahelehed" data-visual-zone="layout-status">
      <div className="layout-tabs" role="tablist" aria-label="Model ja paberiruum">
        {layouts.map((layout) => {
          const active = layout.id === activeLayoutId;
          return <button
            key={layout.id}
            type="button"
            role="tab"
            className={active ? "layout-tab active" : "layout-tab"}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            data-layout-id={layout.id}
            onClick={() => onActivate(layout.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") { event.preventDefault(); moveFocus(event.currentTarget, -1); }
              else if (event.key === "ArrowRight") { event.preventDefault(); moveFocus(event.currentTarget, 1); }
              else if (event.key === "Home") { event.preventDefault(); moveFocus(event.currentTarget, "first"); }
              else if (event.key === "End") { event.preventDefault(); moveFocus(event.currentTarget, "last"); }
            }}
          >{layout.name}</button>;
        })}
      </div>
      <button type="button" className="layout-action layout-add" aria-label="Lisa paigutus" onClick={onCreate}><CadIcon name="add" /></button>
      {children}
      <span className="layout-space">{activeSpace}</span>
    </section>
  );
}
