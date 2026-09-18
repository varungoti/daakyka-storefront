import { PageLoadingState } from "@/components/ui/spinner";

// Shared across every /admin/(panel)/* route — renders inside AdminShell
// (the layout above this route group still shows the sidebar/nav) while
// an individual admin page's data is loading.
export default function AdminPanelLoading() {
  return <PageLoadingState className="min-h-[40vh] py-12" />;
}
