import { isPageEnabled } from "@/lib/settings";
import { permanentRedirect } from "next/navigation";

// release-hardening F-048: this legacy URL's destination depends on the
// fabricTech flag, so it can't move into next.config.ts's static
// redirects() — but it's always a permanent alias for a page that has
// moved, never a temporary one, so `redirect()` (a 307) understated that
// to search engines. `permanentRedirect()` sends a 308 either way.
export default async function ScienceOfTheScrubRedirect() {
  const fabricTechEnabled = await isPageEnabled("fabricTech");
  permanentRedirect(fabricTechEnabled ? "/fabric-technology" : "/shop");
}
