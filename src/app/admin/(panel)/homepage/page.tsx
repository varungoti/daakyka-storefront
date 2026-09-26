import { HomepageEditor } from "@/components/admin/homepage-editor";
import { HeroSlidesEditor } from "@/components/admin/hero-slides-editor";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { getAllHomepageSections, getHeroContent, getHeroSlidesContentForAdmin } from "@/lib/homepage";
import { redirect } from "next/navigation";

export default async function AdminHomepagePage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "homepage:manage")) {
    redirect("/admin/dashboard");
  }

  const [heroContent, heroSlidesContent, sections] = await Promise.all([
    getHeroContent(),
    getHeroSlidesContentForAdmin(),
    // F-343: getHeroContent()/getHeroSlidesContentForAdmin() only return
    // each section's content, not its `updatedAt` — this is the one call
    // that also has it, so each editor below can send it back on save (see
    // HomepageEditor/HeroSlidesEditor's own doc comments).
    getAllHomepageSections(),
  ]);
  const heroUpdatedAt = sections.find((s) => s.key === "hero")?.updatedAt ?? null;
  const heroSlidesUpdatedAt = sections.find((s) => s.key === "hero-slides")?.updatedAt ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Homepage Manager</h1>
        <p className="text-muted">Edit key homepage content blocks.</p>
      </div>
      <HeroSlidesEditor initialContent={heroSlidesContent} updatedAt={heroSlidesUpdatedAt} />
      <HomepageEditor heroContent={heroContent} updatedAt={heroUpdatedAt} />
    </div>
  );
}
