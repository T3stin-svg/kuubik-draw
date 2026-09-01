import type { ReactNode } from "react";

export type WorkspacePreset = "drafting" | "focus" | "review";

export function CadShell({ workspace, children }: { workspace: WorkspacePreset; children: ReactNode }) {
  return (
    <main
      className="app-shell"
      data-workspace={workspace}
      data-scope-profile="autocad-familiar-clean"
      data-product-profile="kuubik-draw-lite-v1"
      data-scope-size="20"
    >
      {children}
    </main>
  );
}

export function DrawingViewport({ paper, children }: { paper: boolean; children: ReactNode }) {
  return <section className={`drawing-area ${paper ? "paper-mode" : "model-mode"}`} data-mode={paper ? "paper" : "model"}>{children}</section>;
}
