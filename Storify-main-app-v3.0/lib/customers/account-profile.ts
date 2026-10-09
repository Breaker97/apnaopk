import { ObjectId } from "mongodb";
import { connectDB, mongoose } from "@/lib/db";

/** A user's own profile, as the account screens show it. */
interface AccountProfile {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string;
  phone?: string;
  /** As the account form stores it: `YYYY-MM-DD`. */
  birthday?: string;
  gender?: string;
}

/**
 * The user's profile, read from the database. Not from the session: Better
 * Auth serves the session's copy of the user from a cookie for up to five
 * minutes, so a name or photo changed a moment ago would come back as it was.
 * Null when the user is gone.
 */
export async function readAccountProfile(userId: string): Promise<AccountProfile | null> {
  if (!ObjectId.isValid(userId)) return null;
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database not connected");

  const user = await db.collection("user").findOne(
    { _id: new ObjectId(userId) },
    {
      projection: { name: 1, email: 1, emailVerified: 1, image: 1, phone: 1, birthday: 1, gender: 1 },
    },
  );
  if (!user) return null;

  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;
  const image = text(user.image);
  const phone = text(user.phone);
  const birthday = text(user.birthday);
  const gender = text(user.gender);
  return {
    id: userId,
    name: typeof user.name === "string" ? user.name : "",
    email: typeof user.email === "string" ? user.email : "",
    emailVerified: Boolean(user.emailVerified),
    ...(image ? { image } : {}),
    ...(phone ? { phone } : {}),
    ...(birthday ? { birthday } : {}),
    ...(gender ? { gender } : {}),
  };
}
