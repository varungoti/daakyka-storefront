export type TopStyle = "v-neck" | "mandarin" | "round-neck";
export type BottomStyle = "jogger" | "slim" | "cargo";
export type FabricChoice = "2-way-stretch" | "4-way-stretch" | "eco-flex" | "cooling";

export interface MixMatchConfig {
  topStyle: TopStyle;
  bottomStyle: BottomStyle;
  fabric: FabricChoice;
  color: string;
  size: string;
  embroideryName: string;
}

export const defaultMixMatchConfig: MixMatchConfig = {
  topStyle: "v-neck",
  bottomStyle: "jogger",
  fabric: "4-way-stretch",
  color: "Navy",
  size: "M",
  embroideryName: "",
};

export const topStyleOptions: { id: TopStyle; label: string; productHandle: string }[] = [
  { id: "v-neck", label: "V-Neck", productHandle: "womens-vneck-scrub-top" },
  { id: "mandarin", label: "Mandarin", productHandle: "unisex-mandarin-collar-scrub-top" },
  { id: "round-neck", label: "Round Neck", productHandle: "mens-round-neck-scrub-top" },
];

export const bottomStyleOptions: { id: BottomStyle; label: string; productHandle: string }[] = [
  { id: "jogger", label: "Jogger", productHandle: "unisex-jogger-scrub-pants" },
  { id: "slim", label: "Slim", productHandle: "womens-slim-scrub-pants" },
  { id: "cargo", label: "Cargo", productHandle: "mens-cargo-scrub-pants" },
];

export const fabricOptions: { id: FabricChoice; label: string; tech: string }[] = [
  { id: "2-way-stretch", label: "2-Way Stretch", tech: "2-way-stretch" },
  { id: "4-way-stretch", label: "4-Way Stretch", tech: "4-way-stretch" },
  { id: "eco-flex", label: "EcoFlex™", tech: "eco-flex" },
  { id: "cooling", label: "Cooling Tech", tech: "moisture-wicking" },
];

export const mixMatchColors = [
  { name: "Navy", hex: "#1E3A5F" },
  { name: "Ceil Blue", hex: "#8FB8DE" },
  { name: "Wine", hex: "#722F37" },
  { name: "Hunter Green", hex: "#355E3B" },
  { name: "Black", hex: "#1F2937" },
  { name: "White", hex: "#F5F5F4" },
];

export const mixMatchSizes = ["XS", "S", "M", "L", "XL", "2XL"];
