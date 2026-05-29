export interface SizeGuideRow {
  size: string;
  chest: string;
  waist: string;
  hip: string;
  inseam: string;
}

export const womenSizeGuide: SizeGuideRow[] = [
  { size: "XS", chest: "32-33\"", waist: "24-25\"", hip: "34-35\"", inseam: "28\"" },
  { size: "S", chest: "34-35\"", waist: "26-27\"", hip: "36-37\"", inseam: "28.5\"" },
  { size: "M", chest: "36-37\"", waist: "28-29\"", hip: "38-39\"", inseam: "29\"" },
  { size: "L", chest: "38-40\"", waist: "30-32\"", hip: "40-42\"", inseam: "29.5\"" },
  { size: "XL", chest: "41-43\"", waist: "33-35\"", hip: "43-45\"", inseam: "30\"" },
  { size: "2XL", chest: "44-46\"", waist: "36-38\"", hip: "46-48\"", inseam: "30\"" },
];

export const menSizeGuide: SizeGuideRow[] = [
  { size: "S", chest: "35-37\"", waist: "29-31\"", hip: "36-38\"", inseam: "30\"" },
  { size: "M", chest: "38-40\"", waist: "32-34\"", hip: "39-41\"", inseam: "30.5\"" },
  { size: "L", chest: "41-43\"", waist: "35-37\"", hip: "42-44\"", inseam: "31\"" },
  { size: "XL", chest: "44-46\"", waist: "38-40\"", hip: "45-47\"", inseam: "31.5\"" },
  { size: "2XL", chest: "47-49\"", waist: "41-43\"", hip: "48-50\"", inseam: "32\"" },
  { size: "3XL", chest: "50-52\"", waist: "44-46\"", hip: "51-53\"", inseam: "32\"" },
];

export const fitTips = [
  {
    title: "Between sizes?",
    description:
      "For a relaxed shift-long fit, size up. For a sharper tailored look, choose your regular size.",
  },
  {
    title: "Top vs bottom",
    description:
      "Many clinicians prefer matching size tops and bottoms, but you can mix sizes for personal comfort.",
  },
  {
    title: "Fabric stretch",
    description:
      "4-way stretch styles feel more forgiving. 2-way stretch fits closer to the listed measurements.",
  },
  {
    title: "After washing",
    description:
      "Follow care instructions to preserve stretch recovery and fit over repeated laundering.",
  },
];
