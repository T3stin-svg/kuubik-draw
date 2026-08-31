import { CadIcon } from "../icons/CadIcon.js";

export function DocumentTabs({ documentName }: { documentName: string }) {
  return (
    <nav className="document-tabs" aria-label="Joonise vahelehed" data-visual-zone="document-tabs">
      <button type="button" className="document-menu" aria-label="Jooniste menüü" data-document-tab="menu"><CadIcon name="menu" /></button>
      <button type="button" className="start-tab" data-document-tab="start" disabled>Start</button>
      <button type="button" className="drawing-tab active" data-document-tab="drawing" aria-current="page">{documentName}<CadIcon name="close" /></button>
      <button type="button" className="new-drawing-tab" aria-label="Uus joonis" data-document-tab="new" disabled><CadIcon name="add" /></button>
    </nav>
  );
}
