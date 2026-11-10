type PreparationActionButtonProps = {
  label: string;
  loadingLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  ariaDescribedBy?: string;
  ariaExpanded?: boolean;
  ariaControls?: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
};

export default function PreparationActionButton({
  label,
  loadingLabel,
  loading = false,
  disabled = false,
  className = '',
  ariaDescribedBy,
  ariaExpanded,
  ariaControls,
  onClick,
  type = 'button',
}: PreparationActionButtonProps) {
  return <button
    type={type}
    className={`prep-action-button ${className}`.trim()}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    aria-describedby={ariaDescribedBy}
    aria-expanded={ariaExpanded}
    aria-controls={ariaControls}
    onClick={onClick}
  >
    <span className="prep-action-label">{loading && loadingLabel ? loadingLabel : label}</span>
    <span className="prep-action-icon-slot" aria-hidden="true">
      {loading
        ? <svg className="prep-action-spinner" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" /></svg>
        : <svg className="prep-action-arrow" viewBox="0 0 20 20"><path d="M3.5 10h12m-5-5 5 5-5 5" /></svg>}
    </span>
  </button>;
}
