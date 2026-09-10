"use client";

import { Switch } from "@/components/ui/switch";

export function SettingSwitchRow(props: {
  id?: string;
  title: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="font-medium">{props.title}</p>
        {props.description ? (
          <p className="text-sm text-muted-foreground">{props.description}</p>
        ) : null}
      </div>
      <Switch
        id={props.id}
        checked={props.checked}
        onCheckedChange={props.onCheckedChange}
      />
    </div>
  );
}

