import type { MouseEventHandler, ReactNode } from "react";
import { CadIcon, type CadIconName } from "../icons/CadIcon.js";
import { isInReioScope, UNSCOPED_COMMAND_MESSAGE } from "./reio-scope.js";

interface RibbonToolProps {
  rowId: string;
  label: string;
  icon: CadIconName;
  large?: boolean;
  pressed?: boolean;
  available?: boolean;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  children?: ReactNode;
}

export function RibbonTool({ rowId, label, icon, large = false, pressed = false, available = false, disabled: stateDisabled = false, onClick }: RibbonToolProps) {
  const selected = isInReioScope(rowId);
  const disabled = !selected || !available || stateDisabled;
  const reason = !selected ? UNSCOPED_COMMAND_MESSAGE : !available ? "Valitud sinu töövoogu · funktsiooniliides pole veel ühendatud" : stateDisabled ? "Käsk pole praeguses olekus saadaval" : "Valitud sinu töövoogu";
  return (
    <button
      type="button"
      className={`ribbon-tool${large ? " ribbon-tool-large" : ""}${selected ? " is-scope-selected" : " is-scope-unselected"}`}
      aria-label={`Ribbon ${label}${available ? " command" : " unavailable"}`}
      aria-pressed={available ? pressed : undefined}
      data-feature-row={rowId}
      data-scope-selected={selected ? "true" : "false"}
      title={`${label} · ${reason}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="ribbon-glyph"><CadIcon name={icon} /></span><span>{label}</span>
    </button>
  );
}
