import * as z from "zod";
import { RETURN_CONDITIONS } from "@/contracts/mobile/biz/v1/returns";

/** One line coming back at the till, with the condition the cashier saw. */
export const POSReturnLineSchema = z.object({
  index: z.number().int().nonnegative(),
  quantity: z.number().int().positive().max(100_000),
  condition: z.enum(RETURN_CONDITIONS),
});
