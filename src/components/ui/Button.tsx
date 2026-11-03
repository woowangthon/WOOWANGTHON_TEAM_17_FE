import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
  children: ReactNode;
  loading?: boolean;
  loadingLabel?: string;
};

export default function Button({ variant = 'primary', children, className = '', loading = false, loadingLabel = '처리 중', type = 'button', disabled, ...props }: ButtonProps) {
  return (
    <button
      className={`btn btn-${variant} ${className}`.trim()}
      type={type}
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <><span className="button-spinner" aria-hidden="true" />{loadingLabel}<span className="sr-only" role="status">{loadingLabel}</span></> : children}
    </button>
  );
}
