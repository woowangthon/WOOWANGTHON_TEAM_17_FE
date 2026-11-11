import type { CanvasCommandId } from './canvasCommands';

const paths: Record<CanvasCommandId, string> = {
  undo: 'M8 4 3 9l5 5M3 9h10a7 7 0 0 1 7 7v3',
  redo: 'm16 4 5 5-5 5M21 9H11a7 7 0 0 0-7 7v3',
  'add-comment': 'M20 15a3 3 0 0 1-3 3H9l-5 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v9ZM8 8h8M8 12h5',
  fit: 'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5',
  'toggle-drawer': 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm11 0v18',
  'toggle-day-links': 'M3 7h6l2 5h4l2 5h4M6 4 3 7l3 3m12 4 3 3-3 3',
  'connect-places': 'M8 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm14 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM7 9l10 6M17 9l-3 2',
  'edit-menu': 'M4 5h16M4 12h16M4 19h16',
  copy: 'M8 8h12v13H8V8ZM4 16H2V2h13v2',
  paste: 'M8 4H4v17h16V4h-4M8 2h8v4H8V2Z',
  disconnect: 'm4 4 16 16M7 12l-2 2a4 4 0 0 0 5 6l3-3m-2-10 3-3a4 4 0 0 1 6 5l-2 2',
  delete: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
};

export default function CanvasToolIcon({ command }: { command: CanvasCommandId }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={paths[command]} />
  </svg>;
}
