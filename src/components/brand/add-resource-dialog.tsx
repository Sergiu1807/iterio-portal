"use client";

import { useState } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type Field = { name: string; label: string; placeholder?: string; textarea?: boolean };

export function AddResourceDialog({
  trigger,
  title,
  description,
  fields,
  onSubmit,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  fields: Field[];
  onSubmit: (values: Record<string, string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});

  const submit = () => {
    const required = fields[0];
    if (required && !vals[required.name]?.trim()) return;
    onSubmit(vals);
    setVals({});
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setVals({});
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-3.5">
          {fields.map((f) => (
            <div key={f.name} className="space-y-1.5">
              <Label>{f.label}</Label>
              {f.textarea ? (
                <Textarea
                  value={vals[f.name] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => setVals((v) => ({ ...v, [f.name]: e.target.value }))}
                />
              ) : (
                <Input
                  value={vals[f.name] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => setVals((v) => ({ ...v, [f.name]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-end gap-2.5">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit}>Add</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
