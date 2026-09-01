import type { ReactNode } from "react";
import { REIO_SCOPE_ID, REIO_SCOPE_SIZE, REIO_SCOPE_SOURCE } from "./reio-scope.js";

export type WorkspacePreset = "drafting" | "focus" | "review";

export function CadShell({ workspace, children }: { workspace: WorkspacePreset; children: ReactNode }) {
  return (
    <main
      className="app-shell"
      data-workspace={workspace}
      data-scope-profile={REIO_SCOPE_SOURCE.visualProfile}
      data-product-profile={REIO_SCOPE_ID}
      data-scope-size={REIO_SCOPE_SIZE}
    >
      {children}
    </main>
  );
}

export function DrawingViewport({ paper, children }: { paper: boolean; children: ReactNode }) {
  return <section className={`drawing-area ${paper ? "paper-mode" : "model-mode"}`} data-mode={paper ? "paper" : "model"}>{children}</section>;
}
