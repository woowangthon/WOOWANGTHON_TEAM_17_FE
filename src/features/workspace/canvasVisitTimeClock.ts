/** Parses compact 24-hour clock text and returns a normalized HH:mm value. */
export function parseVisitClockField(text: string): string {
  const value = text.trim();
  if (!value) return '';
  let hour: number; let minute: number;
  const colon = /^(\d{1,2}):(\d{1,2})$/u.exec(value);
  if (colon) {
    hour = Number(colon[1]);
    minute = Number(colon[2]);
  } else if (/^\d{1,4}$/u.test(value)) {
    if (value.length <= 2) {
      hour = Number(value);
      minute = 0;
    } else if (value.length === 3) {
      hour = Number(value.slice(0, 1));
      minute = Number(value.slice(1));
    } else {
      hour = Number(value.slice(0, 2));
      minute = Number(value.slice(2));
    }
  } else return '';
  if (hour > 23 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
