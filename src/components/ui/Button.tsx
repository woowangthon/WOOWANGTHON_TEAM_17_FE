import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
  children: ReactNode;
};

export default function Button({ variant = 'primary', children, className = '', ...props }: ButtonProps) {
  return <button className={`btn btn-${variant} ${className}`.trim()} {...props}>{children}</button>;
}
