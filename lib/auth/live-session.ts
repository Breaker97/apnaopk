import { ObjectId, type Db, type Document } from "mongodb";

/** The user fields the session read re-checks on every request. */
const LIVE_SESSION_USER_PROJECTION = {
  role: 1,
  roles: 1,
  status: 1,
  emailVerified: 1,
  createdAt: 1,
  emailVerificationRequiredAt: 1,
  emailVerificationAudience: 1,
} as const;

/**
 * The user behind a session, read in the same round trip that proves the
 * session row still exists. Null means the session must not be honoured:
 * revoked, signed out elsewhere, or its user gone.
 *
 * Better Auth answers from the signed `session_data` cookie for up to its
 * cache window (five minutes here) without looking at the database, so a
 * deleted session kept working until that cookie expired — after a password
 * reset, a password change, or "Sign out other devices". Starting from the
 * session row closes that window at no extra cost: this read replaced a lookup
 * of the user alone.
 *
 * Both ids are matched as ObjectIds because that is how Better Auth's Mongo
 * adapter stores them; a string filter matches nothing.
 */
export async function readLiveSessionUser(
  db: Db,
  session: { userId: string; sessionId: string },
): Promise<Document | null> {
  const userId = new ObjectId(session.userId);

  // Better Auth mints ObjectId session ids; anything else predates that and
  // keeps the old user-only check rather than signing its holder out.
  if (!ObjectId.isValid(session.sessionId)) {
    return db
      .collection("user")
      .findOne({ _id: userId }, { projection: LIVE_SESSION_USER_PROJECTION });
  }

  const [user] = await db
    .collection("session")
    .aggregate([
      { $match: { _id: new ObjectId(session.sessionId), userId } },
      { $limit: 1 },
      {
        $lookup: {
          from: "user",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      { $replaceRoot: { newRoot: "$user" } },
      { $project: LIVE_SESSION_USER_PROJECTION },
    ])
    .toArray();

  return user ?? null;
}
