const tabs = [
  ["home", "Home", "home"], ["insert", "Insert", "insert"], ["annotate", "Annotate", "annotate"], ["parametric", "Parametric", "parametric"],
  ["view", "View", "view"], ["manage", "Manage", "manage"], ["output", "Output", "output"], ["add-ins", "Add-ins", "addins"],
  ["collaborate", "Collaborate", "collaborate"], ["express-tools", "Express Tools", "express"], ["featured-apps", "Featured Apps", "featured"], ["prodlib", "ProdLib", "prodlib"],
] as const;

export function RibbonTabs() {
  return (
    <nav className="ribbon-tabs" aria-label="Ribbon vahelehed" data-visual-zone="ribbon-tabs">
      {tabs.map(([id, label, className], index) => <button key={id} type="button" className={`${index === 0 ? "active " : ""}tab-${className}`} aria-current={index === 0 ? "page" : undefined} data-ribbon-tab={id} disabled={index !== 0}>{label}</button>)}
    </nav>
  );
}
