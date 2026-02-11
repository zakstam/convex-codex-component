export type HostIngestErrorLike = {
  recoverable: boolean;
};

export function hasRecoverableIngestErrors(errors: HostIngestErrorLike[]): boolean {
  return errors.some((error) => error.recoverable === true);
}
