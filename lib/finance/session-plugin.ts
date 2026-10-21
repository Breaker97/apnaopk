import type { Schema, Query } from "mongoose";
import { financeSession } from "./transaction";

/** Source claims and inventory evidence use the same enclosing transaction. */
export function financeSessionPlugin(schema: Schema) {
  schema.pre(/^(find|update|replace|delete|count|distinct)/, function (this: Query<unknown, unknown>) {
    const session = financeSession();
    if (session && !this.getOptions().session) this.session(session);
  });
  schema.pre("save", function () {
    const session = financeSession();
    if (session && !this.$session()) this.$session(session);
  });
}
