/**
 * How many brands one curated-product backfill run may carry (DEV-1469).
 *
 * It lives here, not beside the server action that enforces it, for one reason:
 * the admin brand list has to be able to STOP the admin at the limit rather
 * than let them build a 101-brand selection and receive an error. A `'use
 * server'` module can only export async functions, so the action cannot hand
 * the number to the component.
 *
 * The value is pinned to `drop_needs_data_submissions`' own cap of 100, because
 * that RPC is the backfill's rollback path: a run this action can open must be
 * a run it can also roll back in one call.
 */
export const MAX_BULK_PRODUCT_BACKFILL = 100;
