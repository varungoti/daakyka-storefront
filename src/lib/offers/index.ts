import { db } from "@/lib/db";

export interface StoreOffer {
  id: string;
  name: string;
  type: string;
  description: string;
  config: Record<string, unknown>;
}

export async function getActiveOffers(): Promise<StoreOffer[]> {
  try {
    const rows = await db.offerRecommendation.findMany({
      where: { active: true },
      orderBy: { createdAt: "desc" },
      take: 4,
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      description: row.description,
      config: JSON.parse(row.config) as Record<string, unknown>,
    }));
  } catch {
    return [];
  }
}
