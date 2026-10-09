"use client";

import { KeyRound, Loader2, Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import type {
  StaffFormValues,
  StaffHeaderData,
  StaffStats,
} from "../staff-detail-types";

interface ProfileTabProps {
  form: StaffFormValues;
  setField: <K extends keyof StaffFormValues>(
    key: K,
    value: StaffFormValues[K],
  ) => void;
  header: StaffHeaderData;
  stats: StaffStats | null;
  onSendInvite: () => void;
  invitePending: boolean;
  readOnly?: boolean;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ProfileTab({
  form,
  setField,
  header,
  stats,
  onSendInvite,
  invitePending,
  readOnly = false,
}: ProfileTabProps) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Basic information</CardTitle>
            <CardDescription>
              Staff member identity and contact details
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="staff-name">Full name *</Label>
                <Input
                  id="staff-name"
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                  placeholder="e.g. John Doe"
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff-email">Email *</Label>
                <Input
                  id="staff-email"
                  type="email"
                  value={form.email}
                  disabled
                />
                <p className="text-xs text-muted-foreground">
                  Email cannot be changed after creation
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="staff-phone">Phone</Label>
                <Input
                  id="staff-phone"
                  value={form.phone}
                  onChange={(e) => setField("phone", e.target.value)}
                  placeholder="e.g. +1 555 0123"
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff-department">Department</Label>
                <Input
                  id="staff-department"
                  value={form.department}
                  onChange={(e) => setField("department", e.target.value)}
                  placeholder="e.g. Sales, Warehouse"
                  disabled={readOnly}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Employment</CardTitle>
            <CardDescription>
              How this person appears in staff lists and reports
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="staff-status">Account status</Label>
                <Select
                  value={form.status}
                  onValueChange={(value) =>
                    setField("status", value as StaffFormValues["status"])
                  }
                  disabled={readOnly}
                >
                  <SelectTrigger id="staff-status" className="w-full">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="banned">Banned</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Banned or inactive blocks sign-in entirely
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff-job-title">Job title</Label>
                <Input
                  id="staff-job-title"
                  value={form.jobTitle}
                  onChange={(e) => setField("jobTitle", e.target.value)}
                  placeholder="e.g. Senior sales associate"
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff-start-date">Start date</Label>
                <Input
                  id="staff-start-date"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setField("startDate", e.target.value)}
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-2">
                <Label>Member since</Label>
                <Input value={formatDate(header.createdAt)} disabled />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Staff access</CardTitle>
            <CardDescription>
              Toggle staff access without removing the profile
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">
                  {form.isActive
                    ? "Staff can access their dashboard"
                    : "Staff access is suspended"}
                </p>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(checked) => setField("isActive", checked)}
                disabled={readOnly}
                aria-label="Staff access"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Sign-in
            </CardTitle>
            <CardDescription>
              {header.hasPassword
                ? "This account has a password set"
                : "No password set yet — send the invite so they can create one"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={onSendInvite}
              disabled={invitePending || readOnly}
            >
              {invitePending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : header.hasPassword ? (
                <KeyRound className="mr-2 h-4 w-4" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              {header.hasPassword
                ? "Email a password link"
                : "Send invite email"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Sends a one-hour link to set a new password.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>At a glance</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="flex items-center justify-between gap-3 border-b py-2">
              <span className="text-muted-foreground">Two-factor</span>
              {header.twoFactorEnabled ? (
                <Badge variant="outline">Enabled</Badge>
              ) : (
                <Badge variant="outline" className="text-amber-600">
                  Not enabled
                </Badge>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 border-b py-2">
              <span className="text-muted-foreground">Added by</span>
              <span className="truncate">{header.assignedByEmail || "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2">
              <span className="text-muted-foreground">Orders processed</span>
              <span className="tabular-nums">
                {stats ? stats.orderCount.toLocaleString() : "—"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
