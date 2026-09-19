import { AdminPanelContentSkeleton } from "@/components/ui/route-skeletons";

// Shared across every /admin/(panel)/* route — renders inside AdminShell
// (the layout above this route group still shows the sidebar/nav) while
// an individual admin page's data is loading. Admin pages vary widely
// (dashboard stats, tables, forms) so this is a generic but content-shaped
// placeholder rather than the old min-h-[40vh] spinner (release-hardening
// F14) — see src/components/ui/route-skeletons.tsx.
export default function AdminPanelLoading() {
  return <AdminPanelContentSkeleton />;
}
