import type { CSSProperties, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Primitives d'atelier du monteur.
 *
 * Densité et discrétion : un éditeur vidéo se lit du coin de l'œil pendant que
 * l'attention est sur l'image. Les contrôles sont donc petits (26-30 px), sans
 * ombre portée décorative, et n'utilisent la couleur que pour l'état actif.
 */

const PATHS: Record<string, ReactNode> = {
  play: <path d="M5 3.5v9l7.5-4.5z" />,
  pause: (
    <>
      <path d="M5 3.5h2.2v9H5zM8.8 3.5H11v9H8.8z" />
    </>
  ),
  prev: (
    <>
      <path d="M4 4v8M12 4 6.5 8 12 12z" />
    </>
  ),
  next: (
    <>
      <path d="M12 4v8M4 4l5.5 4L4 12z" />
    </>
  ),
  stepBack: <path d="M9 4 5 8l4 4M5 8h6" />,
  stepFwd: <path d="M7 4l4 4-4 4M13 8H7" />,
  scissors: (
    <>
      <circle cx="5" cy="5.5" r="1.6" />
      <circle cx="5" cy="10.5" r="1.6" />
      <path d="M6.4 6.4 13 11M6.4 9.6 13 5" />
    </>
  ),
  trash: <path d="M4 5.5h8M6.5 5.5V4h3v1.5M5.5 5.5l.5 6.5h4l.5-6.5" />,
  magnet: <path d="M5 3v5a3 3 0 0 0 6 0V3M5 6h2.5M9.5 6H11" />,
  zoomIn: (
    <>
      <circle cx="7.5" cy="7.5" r="3.6" />
      <path d="M10.5 10.5 13 13M6 7.5h3M7.5 6v3" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="7.5" cy="7.5" r="3.6" />
      <path d="M10.5 10.5 13 13M6 7.5h3" />
    </>
  ),
  fit: <path d="M3.5 6V3.5H6M10 3.5h2.5V6M12.5 10v2.5H10M6 12.5H3.5V10" />,
  undo: <path d="M6 5.5H9.5a2.75 2.75 0 0 1 0 5.5H5M6 5.5 3.5 8 6 10.5" />,
  redo: <path d="M10 5.5H6.5a2.75 2.75 0 0 0 0 5.5H11M10 5.5 12.5 8 10 10.5" />,
  plus: <path d="M8 4v8M4 8h8" />,
  minus: <path d="M4 8h8" />,
  eye: (
    <>
      <path d="M2.2 8S4.3 4.3 8 4.3 13.8 8 13.8 8 11.7 11.7 8 11.7 2.2 8 2.2 8Z" />
      <circle cx="8" cy="8" r="1.7" />
    </>
  ),
  eyeOff: (
    <path d="M3 3l10 10M6.2 6.4A2 2 0 0 0 8 10a2 2 0 0 0 1.6-.9M4.4 5C3 6.2 2.2 8 2.2 8S4.3 11.7 8 11.7c1 0 1.9-.2 2.7-.6M13 10.2c.8-.9 1.3-2.2 1.3-2.2S11.7 4.3 8 4.3c-.4 0-.8 0-1.2.1" />
  ),
  lock: <path d="M5.2 7.2V5.6a2.8 2.8 0 0 1 5.6 0v1.6M4.3 7.2h7.4v5.2H4.3z" />,
  volume: <path d="M4 6.2h2L9 3.8v8.4L6 9.8H4zM11 6a3 3 0 0 1 0 4M12.6 4.4a5.4 5.4 0 0 1 0 7.2" />,
  mute: <path d="M4 6.2h2L9 3.8v8.4L6 9.8H4zM11.5 6.5l3 3M14.5 6.5l-3 3" />,
  film: (
    <>
      <rect x="2.6" y="4" width="10.8" height="8" rx="1.2" />
      <path d="M5.4 4v8M10.6 4v8M2.6 8h10.8" />
    </>
  ),
  text: <path d="M3.6 4.6h8.8M8 4.6V12M6 12h4" />,
  music: (
    <>
      <path d="M6 11.2V4.4l6-1.2v6.4" />
      <circle cx="4.6" cy="11.4" r="1.5" />
      <circle cx="10.6" cy="10.2" r="1.5" />
    </>
  ),
  sparkles: (
    <path d="M8 2.6l1.1 2.6 2.6 1-2.6 1.1L8 9.9 6.9 7.3 4.3 6.2l2.6-1zM12 10l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4L10 12l1.4-.6z" />
  ),
  mask: (
    <>
      <rect x="2.6" y="4.6" width="10.8" height="6.8" rx="1" />
      <path d="M2.6 9.4c2.2-1.6 4-1.6 5.4 0 1.4 1.6 3 1.6 5.4 0" />
    </>
  ),
  transition: <path d="M2.5 8h5.5M6 5l3 3-3 3M13.5 8H9M12 5l-3 3 3 3" />,
  settings: (
    <>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 2.6v1.6M8 11.8v1.6M2.6 8h1.6M11.8 8h1.6M4.2 4.2l1.1 1.1M10.7 10.7l1.1 1.1M11.8 4.2l-1.1 1.1M5.3 10.7l-1.1 1.1" />
    </>
  ),
  download: <path d="M8 3.4v6.2M5 7l3 3 3-3M3.6 12.4h8.8" />,
  upload: <path d="M8 11.6V5.4M5 8l3-3 3 3M3.6 3.4h8.8" />,
  check: <path d="M4 8.4 6.8 11 12 5.4" />,
  close: <path d="M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8" />,
  wand: (
    <path d="M3.4 12.6 9.6 6.4M11 3l.7 1.8L13.5 5.5l-1.8.7L11 8l-.7-1.8L8.5 5.5l1.8-.7zM5 3l.5 1.2L6.7 4.7 5.5 5.2 5 6.4l-.5-1.2L3.3 4.7l1.2-.5z" />
  ),
  layers: (
    <path d="M8 2.8 13.4 5.5 8 8.2 2.6 5.5zM2.6 8.5 8 11.2l5.4-2.7M2.6 11.2 8 13.9l5.4-2.7" />
  ),
  scissorsSmall: <path d="M4 4l8 8M12 4l-8 8" />,
  arrowRight: <path d="M5 8h6M8.5 5.5 11 8l-2.5 2.5" />,
  info: (
    <>
      <circle cx="8" cy="8" r="5.4" />
      <path d="M8 7.2v3.4M8 5.4v.4" />
    </>
  ),
  crop: <path d="M4 2.6v9.4h9.4M2.6 4H4M11 12v2.6" />,
};

export function Icon({
  name,
  size = 15,
  className,
  style,
}: {
  name: keyof typeof PATHS | string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name] ?? PATHS.info}
    </svg>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  active,
  disabled,
  size = 15,
  variant = "ghost",
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  size?: number;
  variant?: "ghost" | "solid";
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onClick={onClick}
      className={`ed-icon-btn${active ? " is-on" : ""}${variant === "solid" ? " ed-btn" : ""}`}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

/** Curseur d'atelier : libellé, valeur formatée, remplissage du rail. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
  onCommit,
  hint,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
  onCommit?: () => void;
  hint?: string;
  disabled?: boolean;
}) {
  const percent = ((value - min) / (max - min || 1)) * 100;
  return (
    <label className="block" style={{ opacity: disabled ? 0.5 : 1 }}>
      <span className="ed-row">
        <span>{label}</span>
        <span className="ed-value">{format ? format(value) : String(value)}</span>
      </span>
      <input
        type="range"
        className="ed-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ ["--ed-fill" as string]: `${percent}%` }}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
      {hint ? <span className="ed-note">{hint}</span> : null}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="ed-row">
      <label htmlFor={id} className="flex flex-col" style={{ cursor: "pointer" }}>
        <span>{label}</span>
        {hint ? <span className="ed-note">{hint}</span> : null}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`ed-switch${checked ? " is-on" : ""}`}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

export function Chips<T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: { id: T; label: string; title?: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          title={option.title}
          disabled={option.disabled}
          onClick={() => onChange(option.id)}
          className={`ed-chip${value === option.id ? " is-active" : ""}${size === "sm" ? " !px-2 !py-0.5 !text-[11px]" : ""}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Section({
  title,
  children,
  action,
  collapsible,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="ed-section">
      <h3 className="ed-section-title">
        <button
          type="button"
          onClick={collapsible ? () => setOpen((value) => !value) : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            cursor: collapsible ? "pointer" : "default",
            color: "inherit",
            font: "inherit",
            letterSpacing: "inherit",
            textTransform: "inherit",
            background: "none",
            border: 0,
            padding: 0,
          }}
        >
          {collapsible ? <Icon name={open ? "minus" : "plus"} size={10} /> : null}
          {title}
        </button>
        {action}
      </h3>
      {open ? children : null}
    </section>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  step = 0.1,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(value.toFixed(2));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(Number.isFinite(value) ? value.toFixed(2) : "0.00");
  }, [value]);

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw.replace(",", "."));
    if (Number.isNaN(parsed)) return;
    const bounded = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? -Infinity, parsed));
    onChange(Number(bounded.toFixed(3)));
  };

  return (
    <label className="block">
      <span className="ed-row" style={{ fontSize: 11 }}>
        <span>{label}</span>
        {suffix ? <span className="ed-value">{suffix}</span> : null}
      </span>
      <input
        className="ed-input"
        style={{ fontVariantNumeric: "tabular-nums" }}
        value={draft}
        inputMode="decimal"
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          commit(draft);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          commit(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const next = (Number.parseFloat(draft) || 0) + (event.key === "ArrowUp" ? step : -step);
            setDraft(next.toFixed(2));
            commit(next.toFixed(2));
          }
        }}
      />
    </label>
  );
}

export function Swatches({
  value,
  colors,
  onChange,
}: {
  value: string;
  colors: { id: string; label: string; css: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <div className="ed-swatches">
      {colors.map((color) => (
        <button
          key={color.id}
          type="button"
          title={color.label}
          aria-label={color.label}
          className={`ed-swatch${value === color.id ? " is-active" : ""}`}
          style={{ background: color.css }}
          onClick={() => onChange(color.id)}
        />
      ))}
    </div>
  );
}

export function Kv({ k, v }: { k: string; v: ReactNode }) {
  return (
    <span className="ed-kv">
      <span>{k}</span>
      <b>{v}</b>
    </span>
  );
}

export function Notice({
  notice,
  onDismiss,
}: {
  notice: { kind: "info" | "warn" | "error" | "ok"; text: string } | null;
  onDismiss?: () => void;
}) {
  if (!notice) return null;
  const tone =
    notice.kind === "error"
      ? "error"
      : notice.kind === "warn"
        ? "warn"
        : notice.kind === "ok"
          ? "ok"
          : "";
  return (
    <div className={`ed-alert${tone ? ` ed-alert--${tone}` : ""}`} role="status">
      <div className="flex items-start gap-2">
        <Icon
          name={notice.kind === "error" ? "close" : notice.kind === "ok" ? "check" : "info"}
          size={13}
        />
        <span className="flex-1">{notice.text}</span>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Fermer"
            style={{ color: "inherit" }}
          >
            <Icon name="close" size={12} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
