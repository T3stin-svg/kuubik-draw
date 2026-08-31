import type { ReactElement, SVGProps } from "react";

export type CadIconName =
  | "app" | "new" | "open" | "save" | "export" | "undo" | "redo" | "print" | "settings"
  | "view" | "share" | "menu" | "close" | "add" | "remove" | "refresh" | "pin" | "float" | "autohide"
  | "line" | "polyline" | "rectangle" | "circle" | "arc" | "hatch" | "ellipse"
  | "move" | "copy" | "rotate" | "mirror" | "trim" | "offset" | "stretch" | "scale" | "fillet"
  | "text" | "dimension" | "leader" | "table" | "layer" | "lock" | "current" | "match"
  | "block" | "edit" | "attribute" | "group" | "ungroup" | "measure" | "count" | "paste"
  | "visible" | "hidden" | "freeze" | "unfreeze" | "plot" | "unplot"
  | "chevronUp" | "chevronDown" | "chevronLeft" | "chevronRight";

const paths: Record<CadIconName, ReactElement> = {
  app: <><path d="M4 3h9l7 7-7 7H4z" /><path d="M9 7v6m0-3h6" /></>,
  new: <><path d="M6 3h9l3 3v15H6z" /><path d="M15 3v4h4M9 14h6m-3-3v6" /></>,
  open: <><path d="M3 8h7l2 2h9l-3 9H5z" /><path d="M5 8V5h6l2 2h5v3" /></>,
  save: <><path d="M5 3h13l3 3v15H3V3z" /><path d="M7 3v6h10V3M7 14h10v7" /></>,
  export: <><path d="M5 5v14h14v-5" /><path d="M11 13 21 3m-7 0h7v7" /></>,
  undo: <><path d="m9 7-5 5 5 5" /><path d="M5 12h8a6 6 0 0 1 6 6" /></>,
  redo: <><path d="m15 7 5 5-5 5" /><path d="M19 12h-8a6 6 0 0 0-6 6" /></>,
  print: <><path d="M7 8V3h10v5M7 17H4V9h16v8h-3" /><path d="M7 14h10v7H7z" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1" /></>,
  view: <><path d="M3 12s3.4-5 9-5 9 5 9 5-3.4 5-9 5-9-5-9-5Z" /><circle cx="12" cy="12" r="2.5" /></>,
  share: <><circle cx="6" cy="12" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="m8 11 8-4m-8 6 8 4" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  add: <path d="M12 4v16M4 12h16" />,
  remove: <path d="M4 12h16" />,
  refresh: <><path d="M20 7v5h-5" /><path d="M19 12a7 7 0 1 1-2-5" /></>,
  pin: <><path d="m8 4 8 8m-6-6 6-2 4 4-2 6" /><path d="m12 12-7 7" /></>,
  float: <><rect x="4" y="5" width="13" height="12" rx="1" /><path d="M8 9h12v11H8" /></>,
  autohide: <><path d="M5 4h14v16H5z" /><path d="M9 4v16m5-11 3 3-3 3" /></>,
  line: <path d="M4 20 20 4" />,
  polyline: <path d="M3 18 8 8l5 5 8-9" />,
  rectangle: <rect x="4" y="5" width="16" height="14" />,
  circle: <circle cx="12" cy="12" r="8" />,
  arc: <path d="M4 18A14 14 0 0 1 19 5" />,
  hatch: <><rect x="4" y="4" width="16" height="16" /><path d="m5 12 7-7m-7 14L19 5m-7 14 7-7" /></>,
  ellipse: <ellipse cx="12" cy="12" rx="9" ry="6" />,
  move: <><path d="M12 2v20M2 12h20" /><path d="m12 2-3 3m3-3 3 3m7 7-3-3m3 3-3 3M12 22l-3-3m3 3 3-3M2 12l3-3m-3 3 3 3" /></>,
  copy: <><rect x="4" y="4" width="11" height="11" /><rect x="9" y="9" width="11" height="11" /></>,
  rotate: <><path d="M19 9V4h-5" /><path d="M19 5a8 8 0 1 0 1 10" /></>,
  mirror: <><path d="M12 3v18" strokeDasharray="2 2" /><path d="m4 18 5-11v11zm16 0L15 7v11z" /></>,
  trim: <><path d="M5 4v16M19 4 5 18" /><path d="m15 15 5 5" /></>,
  offset: <><path d="M4 8c5-5 11-5 16 0M4 16c5-5 11-5 16 0" /></>,
  stretch: <><rect x="4" y="5" width="8" height="14" /><path d="M12 12h8m-3-3 3 3-3 3" /></>,
  scale: <><path d="M5 19 19 5M5 12v7h7m0-14h7v7" /></>,
  fillet: <path d="M4 20V10a6 6 0 0 1 6-6h10" />,
  text: <><path d="M5 5h14M12 5v14M8 19h8" /></>,
  dimension: <><path d="M4 7v10m16-10v10M5 12h14" /><path d="m8 9-3 3 3 3m8-6 3 3-3 3" /></>,
  leader: <><path d="m4 19 5-5h11V5" /><path d="m4 19 2-5 3 3z" /></>,
  table: <><rect x="4" y="5" width="16" height="14" /><path d="M4 10h16M4 15h16M10 5v14m5-14v14" /></>,
  layer: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m4 12 8 5 8-5m-16 4 8 5 8-5" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="1" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  current: <><circle cx="12" cy="12" r="8" /><path d="m8 12 3 3 5-6" /></>,
  match: <><path d="M6 5h7v7H6zM11 12h7v7h-7z" /><path d="M17 4 5 20" /></>,
  block: <><path d="m12 3 8 5-8 5-8-5z" /><path d="m4 8v8l8 5 8-5V8M12 13v8" /></>,
  edit: <><path d="m4 20 4-1 11-11-3-3L5 16z" /><path d="m14 7 3 3" /></>,
  attribute: <><path d="M6 4h12M9 2 7 22m8-20-2 20M4 9h14M3 16h14" /></>,
  group: <><circle cx="8" cy="8" r="4" /><circle cx="16" cy="8" r="4" /><path d="M4 20a6 6 0 0 1 8-5 6 6 0 0 1 8 5" /></>,
  ungroup: <><circle cx="7" cy="8" r="3" /><circle cx="17" cy="8" r="3" /><path d="M3 20a5 5 0 0 1 8-4m10 4a5 5 0 0 0-8-4" /></>,
  measure: <><path d="m4 17 13-13 3 3L7 20z" /><path d="m10 14-2-2m5-1-2-2m5-1-2-2" /></>,
  count: <><path d="M8 3 6 21m9-18-2 18M3 9h18M2 15h18" /></>,
  paste: <><path d="M8 5h8v3H8z" /><path d="M6 6H4v15h16V6h-2M8 12h8m-8 4h6" /></>,
  visible: <><path d="M3 12s3.4-5 9-5 9 5 9 5-3.4 5-9 5-9-5-9-5Z" /><circle cx="12" cy="12" r="2" /></>,
  hidden: <><path d="M3 12s3.4-5 9-5 9 5 9 5-3.4 5-9 5-9-5-9-5Z" /><path d="M4 4 20 20" /></>,
  freeze: <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9 5l3 2 3-2M9 19l3-2 3 2M5 10l.2 3.5L2 15m17-1-.2-3.5L22 9" />,
  unfreeze: <><circle cx="12" cy="12" r="5" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19m0-14-1.5 1.5m-11 11L5 19" /></>,
  plot: <><path d="M6 8V3h12v5M6 18H4V9h16v9h-2" /><path d="M7 14h10v7H7z" /></>,
  unplot: <><path d="M6 8V3h12v5M6 18H4V9h16v9h-2" /><path d="M7 14h10v7H7zM4 4l16 16" /></>,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
};

export function CadIcon({ name, ...props }: { name: CadIconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      {paths[name]}
    </svg>
  );
}
