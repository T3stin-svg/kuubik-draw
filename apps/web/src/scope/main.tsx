import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ScopeSelector } from "./Selector";
import "./scope.css";

const root = document.getElementById("scope-root");
if (!root) throw new Error("Scope selector root is missing.");

createRoot(root).render(
  <StrictMode>
    <ScopeSelector />
  </StrictMode>,
);
