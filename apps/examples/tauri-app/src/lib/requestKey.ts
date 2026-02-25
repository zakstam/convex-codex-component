export function requestKey(requestId: string | number): string {
  return `${typeof requestId}:${String(requestId)}`;
}
