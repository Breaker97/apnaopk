import { connectDB } from "@/lib/db";
import { Vendor } from "@/models/vendor.model";

/** The admin's "Vendor" filter: a store, as the id the query takes and the name a person knows. */
export interface ActivityLogVendorOption {
  value: string;
  label: string;
}

/** A marketplace past this many stores finds one by its team member's email instead. */
const VENDOR_OPTION_LIMIT = 100;

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * Stores for the admin toolbar's Vendor filter, by name. The one in the URL is
 * always included, so a link from a vendor's page still names the store it
 * filters on when that store sorts past the cut.
 */
export async function fetchActivityLogVendorOptions(
  selectedId?: string,
): Promise<ActivityLogVendorOption[]> {
  await connectDB();

  const stores = await Vendor.find({})
    .select("storeName")
    .sort({ storeName: 1 })
    .limit(VENDOR_OPTION_LIMIT)
    .lean();

  const options = stores.map((store) => ({
    value: String(store._id),
    label: store.storeName,
  }));

  if (selectedId && OBJECT_ID.test(selectedId) && !options.some((o) => o.value === selectedId)) {
    const selected = await Vendor.findById(selectedId).select("storeName").lean();
    if (selected) options.push({ value: String(selected._id), label: selected.storeName });
  }

  return options;
}
