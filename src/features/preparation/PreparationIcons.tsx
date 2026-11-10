import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

export function InfoIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6"/><path d="M12 10.8v5M12 7.8h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
}

export function PanelIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}><rect x="3.5" y="4" width="17" height="16" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M9 4.5v15" stroke="currentColor" strokeWidth="1.6"/></svg>;
}

export function MapIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}><path d="m3.5 6 5.7-2.5 5.6 2.5L20.5 4v14l-5.7 2.5-5.6-2.5L3.5 20V6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M9.2 3.8v14.4m5.6-12.2v14.2" stroke="currentColor" strokeWidth="1.4"/></svg>;
}

export function CheckIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}><path d="m5 12.5 4.2 4.2L19 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function ArrowIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}><path d="M4.5 12h14m-5.5-5.5L18.5 12 13 17.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
