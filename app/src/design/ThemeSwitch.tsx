import { Moon, Sun } from "@phosphor-icons/react";
import { Switch } from "./primitives";
import type { ThemeId } from "../types";

/**
 * Day / Night, in one place.
 *
 * The same markup used to be written out three times — the reader topbar, the
 * library topbar, and the shared reader — which is how the three copies had
 * drifted into using different aria labels and different icon weights for the
 * same control. The `groupLabel` still varies per surface because a screen
 * reader announcing "Scene theme" inside the library is wrong, and because it
 * keys the travelling thumb's layout identity: two switches on screen at once
 * must not share a thumb.
 */
export function ThemeSwitch({
  theme,
  onChange,
  groupLabel,
  disabled,
}: {
  theme: ThemeId;
  onChange: (theme: ThemeId) => void;
  groupLabel: string;
  disabled?: boolean;
}) {
  return (
    <Switch
      className="theme-switch"
      groupLabel={groupLabel}
      value={theme}
      onChange={onChange}
      disabled={disabled}
      options={[
        // The word is wrapped so a phone can drop it and keep the icon. A bare
        // text node cannot be hidden by a selector, and hiding the whole label
        // would take the icon with it.
        { value: "paper-atelier", ariaLabel: "Day theme", label: <><Sun size={17} /> <span>Day</span></> },
        { value: "midnight-desk", ariaLabel: "Night theme", label: <><Moon size={17} /> <span>Night</span></> },
      ]}
    />
  );
}
