"use client";

import Link from "next/link";
import { AppImage } from "@/components/ui/app-image";
import { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Save,
  Clock3,
  type LucideIcon,
} from "lucide-react";
import { toast } from "@/components/ui/toast-notification";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { ImageUploadField } from "@/components/admin/settings/fields/image-upload-field";
import {
  CONTENT_PAGE_META,
  normalizeContentPagesSettings,
  type ContactPageData,
} from "@/lib/site-config/content-pages-config";
import { FieldRow, SwitchRow } from "@/components/admin/online-store/editor-fields";
import { PageEditorSkeleton } from "@/components/admin/online-store/online-store-skeletons";
import { isRecord } from "@/lib/utils";

type SettingsResponse = {
  success?: boolean;
  data?: {
    contentPages?: unknown;
  };
};

function cloneContact(value: ContactPageData): ContactPageData {
  return { ...value };
}

export function ContactPageEditor({ locale }: { locale: string }) {
  const pageMeta = CONTENT_PAGE_META.contact;
  const [contact, setContact] = useState<ContactPageData | null>(null);
  const [initialContact, setInitialContact] = useState<ContactPageData | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true);
        const response = await fetch("/api/admin/settings", { method: "GET" });
        const payload = (await response.json()) as SettingsResponse;

        if (
          !response.ok ||
          payload.success !== true ||
          !isRecord(payload.data)
        ) {
          throw new Error("Failed to load settings");
        }

        const normalized = normalizeContentPagesSettings(
          payload.data.contentPages,
        );
        setContact(cloneContact(normalized.contact));
        setInitialContact(cloneContact(normalized.contact));
      } catch {
        toast.error("Failed to load Contact Us editor");
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, []);

  const isDirty = useMemo(
    () => JSON.stringify(contact) !== JSON.stringify(initialContact),
    [contact, initialContact],
  );

  const updateField = <K extends keyof ContactPageData>(
    field: K,
    value: ContactPageData[K],
  ) => {
    setContact((current) =>
      current ? { ...current, [field]: value } : current,
    );
  };

  const save = async () => {
    if (!contact) return;

    try {
      setIsSaving(true);
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "contentPages",
          data: {
            contact,
          },
        }),
      });

      const payload = (await response.json()) as SettingsResponse;
      if (!response.ok || payload.success !== true || !isRecord(payload.data)) {
        throw new Error("Failed to save");
      }

      const normalized = normalizeContentPagesSettings(
        payload.data.contentPages,
      );
      setContact(cloneContact(normalized.contact));
      setInitialContact(cloneContact(normalized.contact));
      toast.success("Contact Us page saved successfully");
    } catch {
      toast.error("Failed to save Contact Us page");
    } finally {
      setIsSaving(false);
    }
  };

  const openPreview = () => {
    window.open(
      `/${locale}${pageMeta.publicPath}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  // Same placeholder as `pages/contact/loading.tsx`.
  if (isLoading || !contact) return <PageEditorSkeleton />;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <AdminFormStickyHeader
        className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
        title={pageMeta.adminTitle}
        description={pageMeta.description}
        status={
          <Badge variant={isDirty ? "secondary" : "default"}>
            {isDirty ? "Unsaved" : "Live"}
          </Badge>
        }
        actions={
          <>
            <Button asChild type="button" variant="outline" size="sm">
              <Link href="/admin/online-store/pages">Back to Pages</Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openPreview}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Preview
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={save}
              disabled={!isDirty || isSaving}
            >
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>
          </>
        }
      />

      <ContactPreview contact={contact} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <Card className="gap-4">
            <CardHeader>
              <CardTitle>Hero</CardTitle>
              <CardDescription>
                Control the page header, description, hero image, and storefront
                visibility.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <FieldRow label="Page title">
                <Input
                  value={contact.title}
                  onChange={(event) => updateField("title", event.target.value)}
                  placeholder="Contact Us"
                />
              </FieldRow>
              <FieldRow label="Page description">
                <Textarea
                  value={contact.description}
                  onChange={(event) =>
                    updateField("description", event.target.value)
                  }
                  rows={4}
                />
              </FieldRow>
              <ImageUploadField
                id="contact-hero-image"
                label="Hero image"
                value={contact.heroImageUrl}
                onChange={(value) => updateField("heroImageUrl", value)}
                previewAlt="Contact page hero"
                previewClassName="h-full w-full object-cover"
              />
              <SwitchRow
                label="Visible on storefront"
                description="Hide to temporarily unpublish the contact page."
                checked={contact.visible}
                onChange={(value) => updateField("visible", value)}
              />
            </CardContent>
          </Card>

          <Card className="gap-4">
            <CardHeader>
              <CardTitle>Get in Touch</CardTitle>
              <CardDescription>
                Customize the left-side contact panel labels and support hours.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <FieldRow label="Section title">
                <Input
                  value={contact.getInTouchTitle}
                  onChange={(event) =>
                    updateField("getInTouchTitle", event.target.value)
                  }
                />
              </FieldRow>
              <FieldRow label="Section description">
                <Textarea
                  value={contact.getInTouchDescription}
                  onChange={(event) =>
                    updateField("getInTouchDescription", event.target.value)
                  }
                  rows={3}
                />
              </FieldRow>
              <div className="grid gap-3 md:grid-cols-2">
                <FieldRow label="Address label">
                  <Input
                    value={contact.headOfficeTitle}
                    onChange={(event) =>
                      updateField("headOfficeTitle", event.target.value)
                    }
                  />
                </FieldRow>
                <FieldRow label="Email label">
                  <Input
                    value={contact.emailTitle}
                    onChange={(event) =>
                      updateField("emailTitle", event.target.value)
                    }
                  />
                </FieldRow>
                <FieldRow label="Phone label">
                  <Input
                    value={contact.phoneTitle}
                    onChange={(event) =>
                      updateField("phoneTitle", event.target.value)
                    }
                  />
                </FieldRow>
                <FieldRow label="Hours label">
                  <Input
                    value={contact.hoursTitle}
                    onChange={(event) =>
                      updateField("hoursTitle", event.target.value)
                    }
                  />
                </FieldRow>
              </div>
              <FieldRow label="Support hours">
                <Input
                  value={contact.supportHours}
                  onChange={(event) =>
                    updateField("supportHours", event.target.value)
                  }
                />
              </FieldRow>
              <SwitchRow
                label="Show social links"
                description="Uses social links from Settings."
                checked={contact.showSocialLinks}
                onChange={(value) => updateField("showSocialLinks", value)}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="gap-4">
            <CardHeader>
              <CardTitle>Message Form</CardTitle>
              <CardDescription>
                Customize the form heading and helper text.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <FieldRow label="Form title">
                <Input
                  value={contact.formTitle}
                  onChange={(event) =>
                    updateField("formTitle", event.target.value)
                  }
                />
              </FieldRow>
              <FieldRow label="Form description">
                <Textarea
                  value={contact.formDescription}
                  onChange={(event) =>
                    updateField("formDescription", event.target.value)
                  }
                  rows={4}
                />
              </FieldRow>
            </CardContent>
          </Card>

          <Card className="gap-4">
            <CardHeader>
              <CardTitle>Map</CardTitle>
              <CardDescription>
                Manage the map provider, exact location, embed behavior, and
                storefront display.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <SwitchRow
                label="Show map section"
                description="Hide only the map area while keeping the rest of Contact Us live."
                checked={contact.showMap}
                onChange={(value) => updateField("showMap", value)}
              />
              <FieldRow label="Map title">
                <Input
                  value={contact.mapTitle}
                  onChange={(event) =>
                    updateField("mapTitle", event.target.value)
                  }
                />
              </FieldRow>
              <FieldRow label="Map description">
                <Textarea
                  value={contact.mapDescription}
                  onChange={(event) =>
                    updateField("mapDescription", event.target.value)
                  }
                  rows={4}
                />
              </FieldRow>
              <FieldRow label="Map provider">
                <Select
                  value={contact.mapProvider}
                  onValueChange={(value) =>
                    updateField(
                      "mapProvider",
                      value as ContactPageData["mapProvider"],
                    )
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      value="google"
                      description="Use address or coordinates in a Google Maps embed."
                    >
                      Google Maps
                    </SelectItem>
                    <SelectItem
                      value="openstreetmap"
                      description="Use address or coordinates in an OpenStreetMap embed."
                    >
                      OpenStreetMap
                    </SelectItem>
                    <SelectItem
                      value="custom"
                      description="Paste a full iframe embed URL from any map provider."
                    >
                      Custom embed
                    </SelectItem>
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Address or search query">
                <Input
                  value={contact.mapAddress}
                  onChange={(event) =>
                    updateField("mapAddress", event.target.value)
                  }
                  placeholder="Leave empty to use the store address"
                />
              </FieldRow>
              <div className="grid gap-3 md:grid-cols-2">
                <FieldRow label="Latitude">
                  <Input
                    value={contact.mapLatitude}
                    onChange={(event) =>
                      updateField("mapLatitude", event.target.value)
                    }
                    placeholder="40.7128"
                  />
                </FieldRow>
                <FieldRow label="Longitude">
                  <Input
                    value={contact.mapLongitude}
                    onChange={(event) =>
                      updateField("mapLongitude", event.target.value)
                    }
                    placeholder="-74.0060"
                  />
                </FieldRow>
                <FieldRow label="Zoom level">
                  <NumberInput
                    min={1}
                    max={20}
                    step={1}
                    value={contact.mapZoom}
                    whenEmpty="keep"
                    normalize={Math.trunc}
                    onValueChange={(next) => {
                      if (next !== undefined) updateField("mapZoom", next);
                    }}
                  />
                </FieldRow>
                <FieldRow label="Map height">
                  <NumberInput
                    min={220}
                    max={720}
                    step={1}
                    value={contact.mapHeight}
                    whenEmpty="keep"
                    normalize={Math.trunc}
                    onValueChange={(next) => {
                      if (next !== undefined) updateField("mapHeight", next);
                    }}
                  />
                </FieldRow>
              </div>
              <FieldRow label="Custom embed URL">
                <Textarea
                  value={contact.mapEmbedUrl}
                  onChange={(event) =>
                    updateField("mapEmbedUrl", event.target.value)
                  }
                  placeholder="https://www.google.com/maps/embed?..."
                  rows={3}
                />
              </FieldRow>
              <FieldRow label="Map button label">
                <Input
                  value={contact.mapButtonLabel}
                  onChange={(event) =>
                    updateField("mapButtonLabel", event.target.value)
                  }
                  placeholder="Open in Google Maps"
                />
              </FieldRow>
            </CardContent>
          </Card>
        </div>
      </div>

      {!isDirty ? (
        <p className="text-sm text-muted-foreground">
          All changes are saved. Contact Us is synced with storefront content.
        </p>
      ) : null}
    </div>
  );
}

function ContactPreview({ contact }: { contact: ContactPageData }) {
  return (
    <Card className="overflow-hidden p-0 rounded-sm border-border bg-card shadow-[0_3px_14px_rgba(15,23,42,0.06)]">
      <div className="relative h-52 overflow-hidden bg-slate-950">
        {contact.heroImageUrl ? (
          <AppImage
            src={contact.heroImageUrl}
            alt=""
            fill
            sizes="100vw"
            className="object-cover"
          />
        ) : null}
        <div className="absolute inset-0 bg-slate-950/70" />
        <div className="absolute inset-0 bg-primary/20 mix-blend-multiply" />
        <div className="relative z-10 flex h-full flex-col items-center justify-center px-5 text-center text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
            Live Preview
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">
            {contact.title || "Contact Us"}
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/85">
            {contact.description || "Add a page description."}
          </p>
        </div>
      </div>

      <CardContent className="grid gap-5 p-5 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-md bg-muted/50 p-4">
          <h3 className="text-lg font-semibold">
            {contact.getInTouchTitle || "Get in Touch"}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {contact.getInTouchDescription || "Add contact helper text."}
          </p>
          <div className="mt-5 space-y-3 text-sm">
            <PreviewRow
              icon={MapPin}
              title={contact.headOfficeTitle}
              value="Store address"
            />
            <PreviewRow
              icon={Mail}
              title={contact.emailTitle}
              value="support@example.com"
            />
            <PreviewRow
              icon={Phone}
              title={contact.phoneTitle}
              value="+1 555 0100"
            />
            <PreviewRow
              icon={Clock3}
              title={contact.hoursTitle}
              value={contact.supportHours}
            />
          </div>
        </div>
        <div className="rounded-md border border-border p-4">
          <h3 className="text-lg font-semibold">
            {contact.formTitle || "Send us a message"}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {contact.formDescription || "Add form helper text."}
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="h-9 rounded-md border bg-muted/40" />
            <div className="h-9 rounded-md border bg-muted/40" />
            <div className="h-9 rounded-md border bg-muted/40 sm:col-span-2" />
            <div className="h-20 rounded-md border bg-muted/40 sm:col-span-2" />
          </div>
        </div>
        {contact.showMap ? (
          <div className="rounded-md border border-border bg-muted/30 p-4 lg:col-span-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold">
                  {contact.mapTitle || "Visit Our Store"}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {contact.mapDescription || "Add map helper text."}
                </p>
              </div>
              <Badge variant="secondary" className="w-fit">
                {contact.mapProvider === "google"
                  ? "Google Maps"
                  : contact.mapProvider === "openstreetmap"
                    ? "OpenStreetMap"
                    : "Custom embed"}
              </Badge>
            </div>
            <div
              className="mt-4 flex items-center justify-center rounded-md border border-dashed border-border bg-background text-center text-sm text-muted-foreground"
              style={{
                height: `${Math.min(240, Math.max(120, contact.mapHeight / 2))}px`,
              }}
            >
              <div className="px-4">
                <MapPin className="mx-auto mb-2 h-5 w-5 text-primary" />
                <p>
                  {contact.mapLatitude && contact.mapLongitude
                    ? `${contact.mapLatitude}, ${contact.mapLongitude}`
                    : contact.mapAddress || "Store address"}
                </p>
                <p className="mt-1 text-xs">
                  Zoom {contact.mapZoom} · Storefront height {contact.mapHeight}
                  px
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PreviewRow({
  icon: Icon,
  title,
  value,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
}) {
  return (
    <div className="flex gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <span>
        <span className="block font-medium">{title || "Label"}</span>
        <span className="text-muted-foreground">{value || "Value"}</span>
      </span>
    </div>
  );
}

