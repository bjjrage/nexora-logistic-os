// Completed work remains visible to its last driver, until the parcel is reassigned.
// rowid is translated to the monotonic _sequence column by PostgresStore.
export const latestParcelAssignment = `NOT EXISTS(SELECT 1 FROM route_assignments newer WHERE newer.org_id=a.org_id AND newer.parcel_id=a.parcel_id AND newer.rowid>a.rowid)`;
