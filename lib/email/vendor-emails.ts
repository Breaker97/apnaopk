import { sendEmail } from "@/lib/email/email";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import type { ISettings } from "@/models/settings.model";
import { appBaseUrl } from "@/lib/app-url";
import { escapeHtml } from "@/lib/email/escape-html";

type VendorApplicationEmailData = {
  vendorEmail: string;
  vendorName?: string;
  storeName: string;
  settings?: ISettings;
};

type AdminVendorApplicationEmailData = {
  adminEmails: string[];
  vendorEmail?: string;
  vendorName?: string;
  storeName: string;
  settings?: ISettings;
};

type VendorPaymentEmailData = VendorApplicationEmailData & {
  planName: string;
  price: number;
  currency: string;
  billingInterval: string;
  paymentDueAt: Date;
};

function getStoreName(settings?: ISettings) {
  return settings?.general?.storeName || DEFAULT_STORE_NAME;
}

/**
 * Resolve a stored asset URL to an absolute URL. Email clients cannot load
 * relative paths (e.g. "/uploads/logo.png"), so locally-hosted logos must be
 * prefixed with the app's base URL. Remote/data URLs are returned as-is.
 */
function resolveAssetUrl(url?: string) {
  if (!url) return "";
  if (/^(https?:|data:)/i.test(url)) return url;
  return `${appBaseUrl()}${url.startsWith("/") ? url : `/${url}`}`;
}

/** Build an absolute app link from a path (e.g. "/login"). */
function buildAppLink(path: string) {
  return `${appBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

function uniqueEmails(emails: string[]) {
  return Array.from(
    new Set(
      emails
        .map((email) => email.trim().toLowerCase())
        .filter((email) => /\S+@\S+\.\S+/.test(email)),
    ),
  );
}

export function buildEmailShell(params: {
  title: string;
  intro: string;
  body: string;
  settings?: ISettings;
  cta?: { label: string; href: string };
}) {
  const storeName = escapeHtml(getStoreName(params.settings));
  const logoUrl = resolveAssetUrl(params.settings?.general?.logoUrl);
  const header = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${storeName}" style="max-height:42px;max-width:180px;" />`
    : `<div style="font-size:24px;font-weight:700;color:#111827;">${storeName}</div>`;
  const cta = params.cta
    ? `<div style="margin:24px 0 0;">
        <a href="${escapeHtml(params.cta.href)}" style="display:inline-block;padding:12px 22px;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">${escapeHtml(params.cta.label)}</a>
      </div>`
    : "";

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:640px;margin:0 auto;padding:24px;">
      <div style="text-align:center;padding:8px 0 24px;">${header}</div>
      <h2 style="margin:0 0 16px;color:#111827;">${escapeHtml(params.title)}</h2>
      <p style="margin:0 0 16px;">${params.intro}</p>
      ${params.body}
      ${cta}
      <p style="margin:24px 0 0;color:#6b7280;font-size:13px;">${storeName}</p>
    </div>
  `;
}

export async function sendVendorApplicationPendingEmail({
  vendorEmail,
  vendorName,
  storeName,
  settings,
}: VendorApplicationEmailData) {
  const safeStoreName = escapeHtml(storeName);
  const greeting = vendorName ? `Hi ${escapeHtml(vendorName)},` : "Hi,";

  return sendEmail({
    to: vendorEmail,
    subject: `Your vendor application is pending - ${getStoreName(settings)}`,
    settings,
    html: buildEmailShell({
      title: "Vendor application pending",
      intro: greeting,
      settings,
      body: `
        <p style="margin:0 0 16px;">Your vendor application for <strong>${safeStoreName}</strong> has been received.</p>
        <p style="margin:0 0 16px;">Current status: <strong>Pending</strong></p>
        <p style="margin:0;">Our admin team will review your application and notify you after a decision is made.</p>
      `,
    }),
  });
}

export async function sendAdminNewVendorApplicationEmail({
  adminEmails,
  vendorEmail,
  vendorName,
  storeName,
  settings,
}: AdminVendorApplicationEmailData) {
  const recipients = uniqueEmails(adminEmails);
  if (recipients.length === 0) return false;

  const safeStoreName = escapeHtml(storeName);
  const safeVendorName = vendorName ? escapeHtml(vendorName) : "Unknown";
  const safeVendorEmail = vendorEmail ? escapeHtml(vendorEmail) : "No email";

  const results = await Promise.all(
    recipients.map((to) =>
      sendEmail({
        to,
        subject: `New vendor application - ${storeName}`,
        settings,
        html: buildEmailShell({
          title: "New vendor application",
          intro: "A new vendor has applied and is waiting for review.",
          settings,
          body: `
            <p style="margin:0 0 8px;"><strong>Store:</strong> ${safeStoreName}</p>
            <p style="margin:0 0 8px;"><strong>Applicant:</strong> ${safeVendorName}</p>
            <p style="margin:0 0 16px;"><strong>Email:</strong> ${safeVendorEmail}</p>
            <p style="margin:0;">Open the admin vendor area to review and approve or reject this application.</p>
          `,
        }),
      }),
    ),
  );

  return results.some(Boolean);
}

export async function sendVendorApprovedEmail({
  vendorEmail,
  vendorName,
  storeName,
  settings,
}: VendorApplicationEmailData) {
  const safeStoreName = escapeHtml(storeName);
  const greeting = vendorName ? `Hi ${escapeHtml(vendorName)},` : "Hi,";
  const loginUrl = buildAppLink("/login");

  return sendEmail({
    to: vendorEmail,
    subject: `Your vendor account has been approved - ${getStoreName(settings)}`,
    settings,
    html: buildEmailShell({
      title: "Vendor account approved",
      intro: greeting,
      settings,
      cta: { label: "Log in to your dashboard", href: loginUrl },
      body: `
        <p style="margin:0 0 16px;">Good news: your account has been approved as a vendor for <strong>${safeStoreName}</strong>.</p>
        <p style="margin:0 0 16px;">You can now access your vendor dashboard and start selling. Use the button below to sign in, or visit <a href="${escapeHtml(loginUrl)}" style="color:#2563eb;">${escapeHtml(loginUrl)}</a>.</p>
      `,
    }),
  });
}

export async function sendVendorApplicationRejectedEmail({
  vendorEmail,
  vendorName,
  storeName,
  reason,
  settings,
}: VendorApplicationEmailData & { reason?: string | null }) {
  const safeStoreName = escapeHtml(storeName);
  const greeting = vendorName ? `Hi ${escapeHtml(vendorName)},` : "Hi,";
  const reapplyUrl = buildAppLink("/become-vendor");
  const safeReason = reason?.trim() ? escapeHtml(reason.trim()) : "";

  return sendEmail({
    to: vendorEmail,
    subject: `Update on your vendor application - ${getStoreName(settings)}`,
    settings,
    html: buildEmailShell({
      title: "Vendor application not approved",
      intro: greeting,
      settings,
      cta: { label: "Update and apply again", href: reapplyUrl },
      body: `
        <p style="margin:0 0 16px;">We reviewed your application for <strong>${safeStoreName}</strong> and could not approve it this time.</p>
        ${safeReason ? `<p style="margin:0 0 16px;"><strong>Reason:</strong> ${safeReason}</p>` : ""}
        <p style="margin:0 0 16px;">Your customer account is unaffected. You can update your details and submit the application again at <a href="${escapeHtml(reapplyUrl)}" style="color:#2563eb;">${escapeHtml(reapplyUrl)}</a>.</p>
      `,
    }),
  });
}

function paymentDetails(data: VendorPaymentEmailData) {
  const safePlan = escapeHtml(data.planName);
  const safeCurrency = escapeHtml(data.currency.toUpperCase());
  const safeInterval = escapeHtml(data.billingInterval);
  const due = escapeHtml(
    new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(data.paymentDueAt),
  );
  return `
    <p style="margin:0 0 8px;"><strong>Plan:</strong> ${safePlan}</p>
    <p style="margin:0 0 8px;"><strong>Price:</strong> ${safeCurrency} ${Number(data.price).toFixed(2)} / ${safeInterval}</p>
    <p style="margin:0 0 16px;"><strong>Setup access ends:</strong> ${due} UTC</p>
  `;
}

export async function sendVendorPaymentRequiredEmail(
  data: VendorPaymentEmailData,
) {
  const greeting = data.vendorName
    ? `Hi ${escapeHtml(data.vendorName)},`
    : "Hi,";
  const dashboardUrl = buildAppLink("/vendor/dashboard");
  return sendEmail({
    to: data.vendorEmail,
    subject: `Complete your vendor subscription - ${getStoreName(data.settings)}`,
    settings: data.settings,
    html: buildEmailShell({
      title: "Vendor verification approved",
      intro: greeting,
      settings: data.settings,
      cta: { label: "Complete subscription payment", href: dashboardUrl },
      body: `
        <p style="margin:0 0 16px;">Your application for <strong>${escapeHtml(data.storeName)}</strong> has passed admin review. You can prepare your dashboard and catalog for seven days, but selling and financial transactions remain locked until payment.</p>
        ${paymentDetails(data)}
        <p style="margin:0;">Complete payment at any time to activate your store. Payment remains available after setup access ends.</p>
      `,
    }),
  });
}

export async function sendVendorPaymentReminderEmail(
  data: VendorPaymentEmailData & { finalReminder?: boolean },
) {
  const dashboardUrl = buildAppLink("/vendor/dashboard");
  return sendEmail({
    to: data.vendorEmail,
    subject: `${data.finalReminder ? "Final reminder" : "Reminder"}: vendor subscription payment due`,
    settings: data.settings,
    html: buildEmailShell({
      title: data.finalReminder
        ? "Final payment reminder"
        : "Subscription payment reminder",
      intro: data.vendorName
        ? `Hi ${escapeHtml(data.vendorName)},`
        : "Hi,",
      settings: data.settings,
      cta: { label: "Complete payment", href: dashboardUrl },
      body: `
        <p style="margin:0 0 16px;">Your verified vendor application for <strong>${escapeHtml(data.storeName)}</strong> is still waiting for subscription payment. Selling and financial transactions remain locked.</p>
        ${paymentDetails(data)}
      `,
    }),
  });
}

export async function sendVendorPaymentExpiredEmail(
  data: Omit<VendorPaymentEmailData, "paymentDueAt">,
) {
  const dashboardUrl = buildAppLink("/vendor/dashboard");
  return sendEmail({
    to: data.vendorEmail,
    subject: `Vendor setup access ended - ${getStoreName(data.settings)}`,
    settings: data.settings,
    html: buildEmailShell({
      title: "Vendor setup access ended",
      intro: data.vendorName
        ? `Hi ${escapeHtml(data.vendorName)},`
        : "Hi,",
      settings: data.settings,
      cta: { label: "Complete subscription payment", href: dashboardUrl },
      body: `
        <p style="margin:0 0 16px;">The seven-day setup access for <strong>${escapeHtml(data.storeName)}</strong> has ended because subscription payment was not completed.</p>
        <p style="margin:0;">Your vendor dashboard remains locked, but you can still sign in and complete payment to reactivate it.</p>
      `,
    }),
  });
}

/**
 * Where an admin answers a pre-order access request: the queue at the bottom of
 * Marketplace settings, which scrolls itself into view for this anchor.
 */
export const PREORDER_ACCESS_REVIEW_PATH =
  "/admin/settings/marketplace#preorder-access";

type PreorderLimits = { maxLeadDays: number; maxDepositPercent: number };

export async function sendAdminPreorderAccessRequestEmail({
  adminEmails,
  vendorEmail,
  vendorName,
  storeName,
  limits,
  settings,
}: AdminVendorApplicationEmailData & { limits: PreorderLimits }) {
  const recipients = uniqueEmails(adminEmails);
  if (recipients.length === 0) return false;

  const reviewUrl = buildAppLink(PREORDER_ACCESS_REVIEW_PATH);
  const safeStoreName = escapeHtml(storeName);
  const safeVendorName = vendorName ? escapeHtml(vendorName) : "Unknown";
  const safeVendorEmail = vendorEmail ? escapeHtml(vendorEmail) : "No email";

  const results = await Promise.all(
    recipients.map((to) =>
      sendEmail({
        to,
        subject: `Pre-order access request - ${storeName}`,
        settings,
        html: buildEmailShell({
          title: "Pre-order access request",
          intro: "A vendor is asking to sell pre-orders on your store.",
          settings,
          cta: { label: "Review request", href: reviewUrl },
          body: `
            <p style="margin:0 0 8px;"><strong>Store:</strong> ${safeStoreName}</p>
            <p style="margin:0 0 8px;"><strong>Owner:</strong> ${safeVendorName}</p>
            <p style="margin:0 0 16px;"><strong>Email:</strong> ${safeVendorEmail}</p>
            <p style="margin:0;">If you approve, they can open pre-orders with release dates up to ${limits.maxLeadDays} days out and deposits up to ${limits.maxDepositPercent}% of the price.</p>
          `,
        }),
      }),
    ),
  );

  return results.some(Boolean);
}

export async function sendVendorPreorderAccessDecisionEmail({
  vendorEmail,
  vendorName,
  storeName,
  decision,
  note,
  limits,
  settings,
}: VendorApplicationEmailData & {
  decision: "approved" | "declined" | "revoked";
  note?: string | null;
  limits: PreorderLimits;
}) {
  const safeStoreName = escapeHtml(storeName);
  const greeting = vendorName ? `Hi ${escapeHtml(vendorName)},` : "Hi,";
  const safeReason = note?.trim() ? escapeHtml(note.trim()) : "";
  const reasonBlock = safeReason
    ? `<p style="margin:0 0 16px;"><strong>Reason:</strong> ${safeReason}</p>`
    : "";

  const content = {
    approved: {
      subject: "Pre-order access approved",
      cta: { label: "Open your products", href: buildAppLink("/vendor/products") },
      body: `
        <p style="margin:0 0 16px;">You can now open pre-orders for <strong>${safeStoreName}</strong>.</p>
        <p style="margin:0;">Release dates can be up to ${limits.maxLeadDays} days out, and deposits up to ${limits.maxDepositPercent}% of the price.</p>
      `,
    },
    declined: {
      subject: "Pre-order access request declined",
      cta: { label: "Open pre-orders", href: buildAppLink("/vendor/preorders") },
      body: `
        <p style="margin:0 0 16px;">Your request to sell pre-orders for <strong>${safeStoreName}</strong> was not approved.</p>
        ${reasonBlock}
        <p style="margin:0;">You can send a new request from the Pre-orders page in your dashboard.</p>
      `,
    },
    revoked: {
      subject: "Pre-order access withdrawn",
      cta: { label: "Open pre-orders", href: buildAppLink("/vendor/preorders") },
      body: `
        <p style="margin:0 0 16px;">You can no longer open new pre-orders for <strong>${safeStoreName}</strong>.</p>
        ${reasonBlock}
        <p style="margin:0;">Pre-orders that are already selling keep running, and what you owe the shoppers who paid for them is unchanged.</p>
      `,
    },
  }[decision];

  return sendEmail({
    to: vendorEmail,
    subject: `${content.subject} - ${getStoreName(settings)}`,
    settings,
    html: buildEmailShell({
      title: content.subject,
      intro: greeting,
      settings,
      cta: content.cta,
      body: content.body,
    }),
  });
}
