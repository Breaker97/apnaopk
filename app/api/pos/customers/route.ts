import { connectDB } from "@/lib/db";
import { USER_ROLES } from "@/config/app.config";
import { User } from "@/models";
import { successResponse, createdResponse } from "@/lib/api/response";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { canAccessPOS } from "@/lib/access/rbac";
import { sanitizeSearchString, validateBody } from "@/lib/api/validate";
import { notifyAdminsNewCustomer } from "@/lib/notifications/notifications";
import { withApi } from "@/lib/api/handler";
import { z } from "zod";

const PosCustomerSchema = z.object({
  name: z.string().max(200).optional(),
  email: z.string().max(320).optional(),
  phone: z.string().max(50).optional(),
});

/**
 * GET /api/pos/customers
 * Search customers for POS order assignment
 */
export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    if (!(await canAccessPOS(session.user))) throw new AuthorizationError();

    await connectDB();

    const { searchParams } = new URL(request.url);
    const rawSearch = (searchParams.get("search") || "").trim();

    if (rawSearch.length < 2) {
      return successResponse([]);
    }
    const search = sanitizeSearchString(rawSearch);

    // Customers only. Without the role filter a cashier could type a common
    // name into POS search and enumerate admin and vendor emails and phone
    // numbers — everything needed to target the store's own accounts.
    const customers = await User.find({
      role: USER_ROLES.CUSTOMER,
      $or: [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ],
    })
      .select("name email phone image")
      .limit(10)
      .lean();

    return successResponse(customers);
  },
);

/**
 * POST /api/pos/customers
 * Create a new customer from POS terminal
 */
export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    if (!(await canAccessPOS(session.user))) throw new AuthorizationError();

    await connectDB();

    const { name, email, phone } = await validateBody(request, PosCustomerSchema);

    if (!name || !name.trim()) {
      throw new ValidationError("Customer name is required");
    }
    if (!email || !email.trim()) {
      throw new ValidationError("Customer email is required");
    }

    // Check if email already exists
    const existing = await User.findOne({ email: email.toLowerCase().trim() })
      .select("name email phone image")
      .lean();

    if (existing) {
      // Return existing customer instead of throwing error
      return successResponse(existing);
    }

    // Create new customer
    const newCustomer = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone?.trim() || undefined,
      emailVerified: false,
    });

    const customerData = {
      _id: newCustomer._id,
      name: newCustomer.name,
      email: newCustomer.email,
      phone: newCustomer.phone,
      image: newCustomer.image,
    };

    await notifyAdminsNewCustomer({
      customerId: newCustomer._id.toString(),
      name: newCustomer.name,
      email: newCustomer.email,
      createdBy: session.user.id,
    });

    return createdResponse(customerData);
  },
);
