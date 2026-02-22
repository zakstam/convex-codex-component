import { useState, useId, type ReactNode } from "react";

type Props = {
  /** Section heading text */
  title: string;
  /** Whether to start expanded (default: false) */
  defaultOpen?: boolean;
  /** Content to show when expanded */
  children: ReactNode;
  /** Optional badge/status indicator shown next to the title */
  badge?: ReactNode;
};

export function SettingsSection({
  title,
  defaultOpen = false,
  children,
  badge,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const regionId = useId();

  return (
    <div className="settings-section">
      <button
        className="settings-section-header"
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span
          className="settings-section-chevron"
          data-open={open}
          aria-hidden="true"
        >
          &#x25B8;
        </span>
        <span className="settings-section-title">{title}</span>
        {badge != null && (
          <span className="settings-section-badge">{badge}</span>
        )}
      </button>
      <div
        id={regionId}
        className="settings-section-content"
        data-open={open}
        role="region"
        aria-labelledby={undefined}
      >
        <div className="settings-section-content-inner">
          <div>{children}</div>
        </div>
      </div>
    </div>
  );
}
