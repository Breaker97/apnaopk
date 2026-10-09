import { getNextSequence } from "@/models/counter.model";

export async function getNextReturnNumber() {
  const seq = await getNextSequence("return_request");
  return `RET-${String(seq).padStart(6, "0")}`;
}
