export function isGenerationAccessLost(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = 'status' in error ? Number((error as { status?: unknown }).status) : 0;
  const code = 'code' in error ? String((error as { code?: unknown }).code) : '';
  if (['TRIP_NOT_ACCESSIBLE', 'MEMBERSHIP_INACTIVE', 'TRIP_CLOSED'].includes(code)) return true;
  if (status === 401) return true;
  if (status === 403) return code !== 'OWNER_REQUIRED';
  return status === 404 && code === 'HTTP_404';
}
