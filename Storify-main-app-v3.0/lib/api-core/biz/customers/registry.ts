import type { BizRouteEntry } from "@/lib/api-core/registry";
import {
  customerDetailRoute,
  customerListRoute,
  customerNoteCreateRoute,
  customerNotesRoute,
} from "./routes";

/** Customers: the list, one customer, and the business's notes (session F3). */
export const customersRoutes: readonly BizRouteEntry[] = [
  customerListRoute,
  customerDetailRoute,
  customerNotesRoute,
  customerNoteCreateRoute,
];
