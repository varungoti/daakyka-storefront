import { HomepageEditor } from "@/components/admin/homepage-editor";
import { HeroSlidesEditor } from "@/components/admin/hero-slides-editor";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { getHeroContent, getHeroSlidesContentForAdmin } from "@/lib/homepage";
import { redirect } from "next/navigation";

export default async function AdminHomepagePage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "homepage:manage")) {
    redirect("/admin/dashboard");
  }

  const [heroContent, heroSlidesContent] = await Promise.all([
    getHeroContent(),
    getHeroSlidesContentForAdmin(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Homepage Manager</h1>
        <p className="text-muted">Edit key homepage content blocks.</p>
      </div>
      <HeroSlidesEditor initialContent={heroSlidesContent} />
      <HomepageEditor heroContent={heroContent} />
    </div>
  );
}
