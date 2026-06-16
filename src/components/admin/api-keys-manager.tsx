"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Check, Loader2, Trash2, Pencil } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type KeyRow = {
  keyName: string;
  label: string;
  description: string;
  configured: boolean;
  masked: string | null;
  source: "custom" | "env" | "not_set";
  systems: { key: string; name: string }[];
};

export function ApiKeysManager() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const res = await fetch("/api/admin/api-keys");
    if (res.ok) setKeys((await res.json()).keys);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const save = async (keyName: string) => {
    if (!value.trim()) return;
    setSaving(true);
    const res = await fetch("/api/admin/api-keys", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyName, value }),
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Key saved", { description: "Effective immediately across all systems." });
      setEditing(null);
      setValue("");
      load();
    } else {
      toast.error("Couldn't save key");
    }
  };

  const remove = async (keyName: string) => {
    const res = await fetch("/api/admin/api-keys", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyName }),
    });
    if (res.ok) {
      toast.success("Key removed");
      load();
    }
  };

  if (loading) {
    return <div className="h-48 animate-pulse rounded-[var(--radius)] bg-muted/50" />;
  }

  return (
    <div className="space-y-4">
      {keys.map((k) => (
        <BentoCard key={k.keyName} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-[28%] bg-primary/10 text-primary">
                  <KeyRound className="size-4" />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{k.label}</h3>
                    {k.configured ? (
                      <Badge variant="success">
                        <Check className="size-3" /> {k.source === "env" ? "Env" : "Set"}
                      </Badge>
                    ) : (
                      <Badge variant="warning">Not set</Badge>
                    )}
                  </div>
                  <code className="font-mono text-[11px] text-muted-foreground">{k.keyName}</code>
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{k.description}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {k.masked && <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{k.masked}</code>}
                {k.systems.map((s) => (
                  <Badge key={s.key} variant="muted">
                    {s.name}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {editing === k.keyName ? null : (
                <>
                  <Button size="sm" variant="outline" onClick={() => { setEditing(k.keyName); setValue(""); }}>
                    <Pencil className="size-3.5" /> {k.configured ? "Update" : "Set key"}
                  </Button>
                  {k.source === "custom" && (
                    <Button size="iconSm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => remove(k.keyName)} aria-label="Remove">
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          {editing === k.keyName && (
            <div className="mt-4 flex items-center gap-2 border-t border-border/60 pt-4">
              <Input
                type="password"
                autoFocus
                placeholder={`Paste ${k.label} key…`}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save(k.keyName)}
              />
              <Button onClick={() => save(k.keyName)} disabled={saving || !value.trim()}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save
              </Button>
              <Button variant="ghost" onClick={() => { setEditing(null); setValue(""); }}>
                Cancel
              </Button>
            </div>
          )}
        </BentoCard>
      ))}
    </div>
  );
}
