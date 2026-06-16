import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { ApiKeysManager } from "@/components/admin/api-keys-manager";

export default async function AdminApiKeysPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/dashboard");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="API Keys"
        description="Keys are encrypted at rest. Updates take effect on the very next call — no redeploy, no restart."
      />
      <ApiKeysManager />
    </div>
  );
}
