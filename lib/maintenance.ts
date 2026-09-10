import { ServiceUnavailableError } from "@/lib/api/errors";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";

const DEFAULT_MAINTENANCE_TITLE = "We'll be back soon";
const DEFAULT_MAINTENANCE_MESSAGE =
  "We're making a few improvements behind the scenes. Thanks for your patience.";

type MaintenanceSettingsInput = {
  enabled?: unknown;
  title?: unknown;
  message?: unknown;
  backgroundImageUrl?: unknown;
  countdownEnabled?: unknown;
  countdownEndsAt?: unknown;
  allowedIPs?: unknown;
};

type ResolvedMaintenanceSettings = {
  enabled: boolean;
  title: string;
  message: string;
  backgroundImageUrl?: string;
  countdownEnabled: boolean;
  countdownEndsAt?: string;
  allowedIPs: string[];
  retryAfterSeconds?: number;
};

function normalizeOptionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeAllowedIPs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function getMaintenanceRetryAfterSeconds(
  countdownEndsAt?: string | null,
) {
  if (!countdownEndsAt) return undefined;

  const endsAtMs = new Date(countdownEndsAt).getTime();
  if (!Number.isFinite(endsAtMs)) return undefined;

  const diffMs = endsAtMs - Date.now();
  if (diffMs <= 0) return undefined;

  return Math.max(60, Math.ceil(diffMs / 1000));
}

export function normalizeMaintenanceSettings(
  value: MaintenanceSettingsInput | null | undefined,
  storeName: string = DEFAULT_STORE_NAME,
): ResolvedMaintenanceSettings {
  const safeStoreName =
    typeof storeName === "string" && storeName.trim()
      ? storeName.trim()
      : DEFAULT_STORE_NAME;
  const title =
    normalizeOptionalText(value?.title) ||
    `${safeStoreName} is temporarily offline`;
  const message =
    normalizeOptionalText(value?.message) || DEFAULT_MAINTENANCE_MESSAGE;
  const backgroundImageUrl = normalizeOptionalText(value?.backgroundImageUrl);
  const countdownEndsAt = normalizeOptionalText(value?.countdownEndsAt);
  const countdownEnabled =
    Boolean(value?.countdownEnabled) && Boolean(countdownEndsAt);

  return {
    enabled: Boolean(value?.enabled),
    title,
    message,
    backgroundImageUrl,
    countdownEnabled,
    countdownEndsAt: countdownEnabled ? countdownEndsAt : undefined,
    allowedIPs: normalizeAllowedIPs(value?.allowedIPs),
    retryAfterSeconds: getMaintenanceRetryAfterSeconds(countdownEndsAt),
  };
}

function normalizeClientIp(ip: string) {
  const trimmed = ip.trim();
  return trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
}

export function isAllowedMaintenanceIp(ip: string | null, allowedIPs: string[]) {
  if (!ip) return false;
  const normalizedIp = normalizeClientIp(ip);
  return allowedIPs.some((allowed) => normalizeClientIp(allowed) === normalizedIp);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMessageHtml(message: string) {
  return escapeHtml(message).replace(/\r?\n/g, "<br />");
}

export function buildMaintenanceHtml(params: {
  storeName?: string;
  storeEmail?: string;
  logoUrl?: string;
  faviconUrl?: string;
  backgroundImageUrl?: string;
  title: string;
  message: string;
  countdownEndsAt?: string;
  lang?: string;
}) {
  const storeName =
    typeof params.storeName === "string" && params.storeName.trim()
      ? params.storeName.trim()
      : DEFAULT_STORE_NAME;
  const title = normalizeOptionalText(params.title) || DEFAULT_MAINTENANCE_TITLE;
  const message =
    normalizeOptionalText(params.message) || DEFAULT_MAINTENANCE_MESSAGE;
  const countdownEndsAt = normalizeOptionalText(params.countdownEndsAt);
  const storeEmail = normalizeOptionalText(params.storeEmail);
  const logoUrl = normalizeOptionalText(params.logoUrl);
  const faviconUrl = normalizeOptionalText(params.faviconUrl);
  const backgroundImageUrl = normalizeOptionalText(params.backgroundImageUrl);
  const lang = normalizeOptionalText(params.lang) || "en";
  const pageTitle = `${title} | ${storeName}`;
  const hasBackgroundImage = Boolean(backgroundImageUrl);
  const bodyClass = hasBackgroundImage ? ` class="has-background-image"` : "";
  const backgroundMarkup = backgroundImageUrl
    ? `<div class="background-layer" aria-hidden="true"><img src="${escapeHtml(backgroundImageUrl)}" alt="" /></div>`
    : "";
  const countdownMarkup = countdownEndsAt
    ? `
      <section class="countdown-shell" aria-labelledby="maintenance-countdown-label">
        <div class="countdown-header">
          <p id="maintenance-countdown-label" class="countdown-eyebrow">Expected back in</p>
          <p id="countdown-status" class="countdown-note">We are on it.</p>
        </div>
        <div id="countdown-grid" class="countdown-grid" data-end-at="${escapeHtml(countdownEndsAt)}">
          <div class="countdown-box"><span id="countdown-days">00</span><label>Days</label></div>
          <div class="countdown-box"><span id="countdown-hours">00</span><label>Hours</label></div>
          <div class="countdown-box"><span id="countdown-minutes">00</span><label>Minutes</label></div>
          <div class="countdown-box"><span id="countdown-seconds">00</span><label>Seconds</label></div>
        </div>
      </section>
    `
    : "";
  const contactMarkup = storeEmail
    ? `<p class="support-copy">Need help sooner? Reach us at <a href="mailto:${escapeHtml(storeEmail)}">${escapeHtml(storeEmail)}</a>.</p>`
    : "";
  const brandMarkup = logoUrl
    ? `<img class="brand-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(storeName)}" />`
    : `<div class="brand-mark">${escapeHtml(storeName.slice(0, 1).toUpperCase())}</div>`;
  const faviconMarkup = faviconUrl
    ? `<link rel="icon" href="${escapeHtml(faviconUrl)}" />`
    : "";

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${escapeHtml(pageTitle)}</title>
    ${faviconMarkup}
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f7fb;
        --surface: rgba(255, 255, 255, 0.92);
        --surface-strong: #ffffff;
        --text: #101828;
        --muted: #475467;
        --border: rgba(16, 24, 40, 0.08);
        --accent: #2065d1;
        --accent-soft: rgba(32, 101, 209, 0.12);
        --shadow: 0 24px 80px rgba(15, 23, 42, 0.12);
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top, rgba(32, 101, 209, 0.08), transparent 34%),
          linear-gradient(180deg, #fcfdff 0%, var(--bg) 100%);
        color: var(--text);
      }

      .background-layer {
        display: none;
      }

      body.has-background-image {
        background: #0b1220;
        color: #ffffff;
      }

      body.has-background-image .background-layer {
        position: fixed;
        inset: 0;
        display: block;
        overflow: hidden;
        background: #0b1220;
        z-index: 0;
      }

      body.has-background-image .background-layer::after {
        content: "";
        position: absolute;
        inset: 0;
        background:
          linear-gradient(180deg, rgba(2, 6, 23, 0.34), rgba(2, 6, 23, 0.62)),
          radial-gradient(circle at center, transparent 0%, rgba(2, 6, 23, 0.26) 72%);
        z-index: 1;
      }

      body.has-background-image .background-layer img {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: contain;
        opacity: 0.56;
      }

      main {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 32px 20px;
        position: relative;
        z-index: 1;
      }

      .shell {
        width: min(760px, 100%);
        background: var(--surface);
        backdrop-filter: blur(18px);
        border: 1px solid var(--border);
        border-radius: 24px;
        box-shadow: var(--shadow);
        overflow: hidden;
      }

      body.has-background-image .shell {
        background: transparent;
        backdrop-filter: none;
        border: 0;
        box-shadow: none;
      }

      .topbar {
        height: 6px;
        background: linear-gradient(90deg, var(--accent) 0%, #12b76a 100%);
      }

      body.has-background-image .topbar {
        display: none;
      }

      .content {
        padding: 36px;
      }

      .brand-row {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-bottom: 28px;
        flex-wrap: wrap;
      }

      .brand-logo {
        max-height: 44px;
        max-width: 180px;
        object-fit: contain;
      }

      .brand-mark {
        width: 44px;
        height: 44px;
        border-radius: 12px;
        display: grid;
        place-items: center;
        background: var(--accent-soft);
        color: var(--accent);
        font-weight: 700;
        font-size: 20px;
      }

      body.has-background-image .brand-logo {
        filter: drop-shadow(0 8px 20px rgba(0, 0, 0, 0.28));
      }

      body.has-background-image .brand-mark {
        background: rgba(255, 255, 255, 0.18);
        color: #ffffff;
        backdrop-filter: blur(10px);
      }

      h1 {
        margin: 0;
        font-size: clamp(30px, 4vw, 44px);
        line-height: 1.08;
      }

      body.has-background-image h1 {
        text-shadow: 0 2px 18px rgba(0, 0, 0, 0.34);
      }

      .message {
        margin: 18px 0 0;
        max-width: 58ch;
        color: var(--muted);
        font-size: 17px;
        line-height: 1.75;
      }

      body.has-background-image .message {
        color: rgba(255, 255, 255, 0.88);
        text-shadow: 0 1px 14px rgba(0, 0, 0, 0.3);
      }

      .countdown-shell {
        margin-top: 28px;
        padding: 24px;
        border-radius: 20px;
        background: var(--surface-strong);
        border: 1px solid rgba(32, 101, 209, 0.12);
      }

      body.has-background-image .countdown-shell {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.22);
        backdrop-filter: blur(8px);
      }

      .countdown-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 18px;
        flex-wrap: wrap;
      }

      .countdown-eyebrow,
      .countdown-note {
        margin: 0;
      }

      .countdown-eyebrow {
        color: var(--text);
        font-weight: 700;
        font-size: 15px;
      }

      .countdown-note {
        color: var(--muted);
        font-size: 14px;
      }

      body.has-background-image .countdown-eyebrow,
      body.has-background-image .countdown-note {
        color: rgba(255, 255, 255, 0.9);
      }

      .countdown-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
      }

      .countdown-box {
        min-height: 118px;
        border-radius: 18px;
        background: #f8fafc;
        border: 1px solid rgba(15, 23, 42, 0.06);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
      }

      body.has-background-image .countdown-box {
        background: rgba(255, 255, 255, 0.12);
        border-color: rgba(255, 255, 255, 0.18);
      }

      .countdown-box span {
        display: block;
        font-size: clamp(28px, 4vw, 40px);
        line-height: 1;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }

      .countdown-box label {
        display: block;
        margin-top: 10px;
        color: var(--muted);
        font-size: 12px;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      body.has-background-image .countdown-box label {
        color: rgba(255, 255, 255, 0.72);
      }

      .support-copy {
        margin: 24px 0 0;
        color: var(--muted);
        font-size: 14px;
      }

      body.has-background-image .support-copy {
        color: rgba(255, 255, 255, 0.82);
      }

      .support-copy a {
        color: var(--accent);
        text-decoration: none;
      }

      body.has-background-image .support-copy a {
        color: #bfdbfe;
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 999px;
        border: 1px solid rgba(18, 183, 106, 0.16);
        background: rgba(18, 183, 106, 0.08);
        color: #067647;
        font-size: 13px;
        font-weight: 600;
      }

      body.has-background-image .status-pill {
        border-color: rgba(255, 255, 255, 0.24);
        background: rgba(255, 255, 255, 0.12);
        color: #ffffff;
        backdrop-filter: blur(8px);
      }

      @media (max-width: 720px) {
        .content { padding: 24px; }
        .countdown-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }

      @media (max-width: 420px) {
        .countdown-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body${bodyClass}>
    ${backgroundMarkup}
    <main>
      <section class="shell" aria-labelledby="maintenance-title">
        <div class="topbar"></div>
        <div class="content">
          <div class="brand-row">
            ${brandMarkup}
            <div class="status-pill">Scheduled maintenance in progress</div>
          </div>
          <h1 id="maintenance-title">${escapeHtml(title)}</h1>
          <p class="message">${formatMessageHtml(message)}</p>
          ${countdownMarkup}
          ${contactMarkup}
        </div>
      </section>
    </main>
    <script>
      (function () {
        const grid = document.getElementById("countdown-grid");
        if (!grid) return;

        const endAt = grid.getAttribute("data-end-at");
        if (!endAt) return;

        const status = document.getElementById("countdown-status");
        const daysEl = document.getElementById("countdown-days");
        const hoursEl = document.getElementById("countdown-hours");
        const minutesEl = document.getElementById("countdown-minutes");
        const secondsEl = document.getElementById("countdown-seconds");

        const pad = (value) => String(value).padStart(2, "0");

        function render() {
          const diff = new Date(endAt).getTime() - Date.now();
          if (!Number.isFinite(diff)) return;

          if (diff <= 0) {
            if (daysEl) daysEl.textContent = "00";
            if (hoursEl) hoursEl.textContent = "00";
            if (minutesEl) minutesEl.textContent = "00";
            if (secondsEl) secondsEl.textContent = "00";
            if (status) status.textContent = "We are wrapping up the final checks.";
            return;
          }

          const totalSeconds = Math.floor(diff / 1000);
          const days = Math.floor(totalSeconds / 86400);
          const hours = Math.floor((totalSeconds % 86400) / 3600);
          const minutes = Math.floor((totalSeconds % 3600) / 60);
          const seconds = totalSeconds % 60;

          if (daysEl) daysEl.textContent = pad(days);
          if (hoursEl) hoursEl.textContent = pad(hours);
          if (minutesEl) minutesEl.textContent = pad(minutes);
          if (secondsEl) secondsEl.textContent = pad(seconds);
          if (status) status.textContent = "Thanks for sticking with us.";
        }

        render();
        setInterval(render, 1000);
      })();
    </script>
  </body>
</html>`;
}

export function assertStorefrontWriteAllowed(
  value: MaintenanceSettingsInput | null | undefined,
  storeName?: string,
) {
  const maintenance = normalizeMaintenanceSettings(value, storeName);
  if (!maintenance.enabled) return;

  throw new ServiceUnavailableError(
    maintenance.message,
    maintenance.retryAfterSeconds,
    "STORE_MAINTENANCE",
  );
}
