export type TryOnGender = "male" | "female";

export interface OutfitTryOnRequest {
  gender: TryOnGender;
  topImageUrl: string;
  bottomImageUrl?: string;
  avatarImageUrl?: string;
  topHandle?: string;
  bottomHandle?: string;
  color?: string;
}

export interface OutfitTryOnResponse {
  ok: boolean;
  mode: "ar-tryon" | "fallback";
  resultImageUrl: string;
  jobId?: string;
  error?: string;
  cached?: boolean;
}
