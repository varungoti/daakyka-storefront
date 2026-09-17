import { isPageEnabled } from "@/lib/settings";
import { redirect } from "next/navigation";

export default async function ScienceOfTheScrubRedirect() {
  const fabricTechEnabled = await isPageEnabled("fabricTech");
  redirect(fabricTechEnabled ? "/fabric-technology" : "/shop");
}
