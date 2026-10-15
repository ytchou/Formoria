// Bulk approval processes every submission concurrently, and the whole
// action only responds once every item has settled. One submission that
// hangs on a slow DB round trip (e.g. a stale-refresh check contending with
// other writes) otherwise keeps the client from learning about the other,
// already-committed approvals in the same batch — bound each item so the
// response never waits on the single slowest one.
const APPROVAL_ITEM_TIMEOUT_MS = 20_000;

/**
 * Rejects after `APPROVAL_ITEM_TIMEOUT_MS` without cancelling `promise`: the
 * underlying write may still commit, which is why the message says "check back"
 * rather than "failed".
 */
export function withApprovalTimeout<T>(
  promise: Promise<T>,
  message = "Approval is taking longer than expected — check back shortly",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, APPROVAL_ITEM_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
