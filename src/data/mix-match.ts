export type TopStyle = "v-neck" | "mandarin" | "round-neck" | "zip-neck";
export type BottomStyle = "jogger" | "straight" | "cargo" | "shorts";
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
  color: "Lilac Purple",
  size: "M",
  embroideryName: "",
};

export const topStyleOptions: { id: TopStyle; label: string; productHandle: string }[] = [
  { id: "v-neck", label: "V-Neck", productHandle: "v-neck-top-lilac" },
  { id: "mandarin", label: "Mandarin", productHandle: "mandarin-collar-sage" },
  { id: "round-neck", label: "Round Neck", productHandle: "round-neck-white" },
  { id: "zip-neck", label: "Zip-Neck", productHandle: "zip-neck-lilac" },
];

export const bottomStyleOptions: { id: BottomStyle; label: string; productHandle: string }[] = [
  { id: "jogger", label: "Jogger", productHandle: "jogger-pants-navy" },
  { id: "straight", label: "Straight", productHandle: "straight-pants-charcoal" },
  { id: "cargo", label: "Cargo", productHandle: "cargo-pants-teal" },
  { id: "shorts", label: "Shorts", productHandle: "jogger-pants-navy" },
];

export const fabricOptions: { id: FabricChoice; label: string; tech: string }[] = [
  { id: "2-way-stretch", label: "2-Way Stretch", tech: "2-way-stretch" },
  { id: "4-way-stretch", label: "4-Way Stretch", tech: "4-way-stretch" },
  { id: "eco-flex", label: "EcoFlex™", tech: "eco-flex" },
  { id: "cooling", label: "Cooling Tech", tech: "moisture-wicking" },
];

export const mixMatchColors = [
  { name: "Lilac Purple", hex: "#C4B5FD" },
  { name: "Midnight Navy", hex: "#1E3A5F" },
  { name: "Sage Green", hex: "#86A789" },
  { name: "Cloud White", hex: "#F5F5F4" },
  { name: "Charcoal", hex: "#374151" },
  { name: "Ocean Teal", hex: "#2DD4BF" },
];

export const mixMatchSizes = ["XS", "S", "M", "L", "XL", "2XL"];
