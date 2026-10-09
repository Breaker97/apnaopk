"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AdminDocumentUploadField } from "../admin-document-upload-field";
import type { VendorTabProps } from "../vendor-detail-types";

const DOC_HINT = "PDF, PNG, JPG or WEBP up to 10MB";

export function DocumentsTab({ form, setField, readOnly }: VendorTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Verification Documents</CardTitle>
        <CardDescription>
          Documents submitted by the vendor during onboarding. Admins can view,
          replace, or upload documents on the vendor&apos;s behalf.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <AdminDocumentUploadField
            label="Business license"
            hint={DOC_HINT}
            value={form.docBusinessLicense}
            onChange={(url) => setField("docBusinessLicense", url)}
            disabled={readOnly}
          />
          <AdminDocumentUploadField
            label="Tax certificate"
            hint={DOC_HINT}
            value={form.docTaxCertificate}
            onChange={(url) => setField("docTaxCertificate", url)}
            disabled={readOnly}
          />
          <AdminDocumentUploadField
            label="Government ID"
            hint={DOC_HINT}
            value={form.docGovernmentId}
            onChange={(url) => setField("docGovernmentId", url)}
            disabled={readOnly}
          />
          <div className="space-y-2">
            <Label htmlFor="vendor-doc-tax-id">Tax ID / VAT number</Label>
            <Input
              id="vendor-doc-tax-id"
              value={form.docTaxId}
              onChange={(e) => setField("docTaxId", e.target.value)}
              placeholder="e.g. 12-3456789"
              disabled={readOnly}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
