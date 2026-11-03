import type { InputHTMLAttributes } from 'react';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
};

export default function Input({ id, label, hint, error, required, ...props }: InputProps) {
  const descriptionId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}{required && <span className="required" aria-hidden="true">*</span>}</label>
      <input id={id} className="text-input" required={required} aria-invalid={error ? true : undefined} aria-describedby={descriptionId} {...props} />
      {error ? <p className="field-error" id={`${id}-error`} role="alert">{error}</p> : hint ? <p className="field-help" id={`${id}-hint`}>{hint}</p> : null}
    </div>
  );
}
