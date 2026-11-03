import type { InputHTMLAttributes } from 'react';

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
};

export default function Input({ id, label, hint, error, required, className = '', 'aria-describedby': callerDescribedBy, 'aria-invalid': callerInvalid, ...props }: InputProps) {
  const describedBy = [callerDescribedBy, hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}{required && <span className="required" aria-hidden="true">*</span>}</label>
      <input id={id} className={`text-input ${className}`.trim()} required={required} aria-invalid={error ? true : callerInvalid} aria-describedby={describedBy} {...props} />
      {hint && <p className="field-help" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="field-error" id={`${id}-error`} role="alert">{error}</p>}
    </div>
  );
}
