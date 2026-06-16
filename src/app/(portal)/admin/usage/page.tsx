import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { UsageDashboard } from "@/components/admin/usage-dashboard";

export default async function AdminUsagePage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/dashboard");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Usage & Spend"
        description="Every external call (Claude, Gemini, Apify) is metered here — by provider, system, brand, and key."
      />
      <UsageDashboard />
    </div>
  );
}
