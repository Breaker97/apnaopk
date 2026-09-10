/**
 * Static data for the AI Image Studio: prompt-bar tool instructions, canvas
 * size options, and the Quick Prompt preset library. Tool instructions are
 * deliberately explicit about "keep everything else identical" because the
 * server-side edit prompt only guards the product itself — the instruction
 * here is what scopes the change.
 */

import type { AIAuthoringMediaOptions } from "@/lib/ai-authoring/types";

export type StudioSizeOption = {
  key: string;
  label: string;
  ratio: string;
  size: NonNullable<AIAuthoringMediaOptions["size"]>;
};

export const STUDIO_SIZE_OPTIONS: StudioSizeOption[] = [
  { key: "square", label: "Square", ratio: "1:1", size: "1024x1024" },
  { key: "portrait", label: "Portrait", ratio: "2:3", size: "1024x1536" },
  { key: "landscape", label: "Landscape", ratio: "3:2", size: "1536x1024" },
];

export const STUDIO_TOOL_PROMPTS = {
  removeBackground:
    "Remove the entire background so only the product remains. Output the product perfectly cut out on a fully transparent background with clean, smooth edges — no leftover background pixels, no backdrop, no floor, no shadows, no reflections.",
  enhance:
    "Enhance the photo quality only: correct the lighting, exposure, and white balance, increase sharpness and clarity, make the colors accurate and slightly richer, and remove noise. Do not move, crop, restyle, or change the product, the background, or the composition.",
  upscale:
    "Reproduce this exact image at a much higher resolution with more fine detail: sharpen textures, edges, and any text, and remove blur, noise, pixelation, and compression artifacts. Keep the framing, colors, background, and every element exactly the same.",
  erase: (target: string) =>
    `Remove the following from the image completely: ${target}. Fill the removed area naturally so it blends seamlessly with the surrounding background. Everything else in the image must stay exactly the same.`,
  resize: (option: StudioSizeOption) =>
    `Adapt this image to a ${option.ratio} ${option.label.toLowerCase()} canvas. Keep the product exactly the same size, fully visible and centered, and extend the existing background naturally to fill the new canvas. Do not stretch, crop, or distort the product.`,
  expand: (option: StudioSizeOption) =>
    `The product has been placed, smaller and centered, on a larger ${option.ratio} ${option.label.toLowerCase()} canvas with empty transparent margins around it. Fill only those empty margins by realistically continuing the existing background, surface, lighting, and environment outward on every side so it blends seamlessly with the original. Keep the product and the already-filled center exactly as they are — do not move, resize, recolor, crop, or regenerate them.`,
} as const;

type QuickPrompt = {
  key: string;
  label: string;
  prompt: string;
};

export type QuickPromptCategory = {
  key: string;
  label: string;
  prompts: QuickPrompt[];
};

export const QUICK_PROMPT_CATEGORIES: QuickPromptCategory[] = [
  {
    key: "electronics",
    label: "Electronics",
    prompts: [
      {
        key: "clean-white",
        label: "Clean white",
        prompt:
          "Place the product on a seamless pure white studio background with soft, even lighting and a subtle natural shadow beneath it.",
      },
      {
        key: "lifestyle-room",
        label: "Lifestyle room",
        prompt:
          "Stage the product in a bright, modern living room on a clean surface, with soft natural daylight and a gently blurred background.",
      },
      {
        key: "desk-setup",
        label: "Desk setup",
        prompt:
          "Place the product on a tidy minimal desk beside a laptop and a small plant, soft window light, shallow depth of field.",
      },
      {
        key: "gradient-studio",
        label: "Gradient studio",
        prompt:
          "Place the product on a smooth blue-to-violet gradient studio backdrop with soft rim lighting and a gentle reflection below it.",
      },
      {
        key: "neon-accent",
        label: "Neon accent",
        prompt:
          "Place the product in a dark studio scene with soft cyan and magenta neon accent lighting and subtle reflections.",
      },
    ],
  },
  {
    key: "fashion",
    label: "Fashion & Apparel",
    prompts: [
      {
        key: "clean-white",
        label: "Clean white",
        prompt:
          "Place the product on a seamless pure white studio background with soft, even lighting and a subtle natural shadow beneath it.",
      },
      {
        key: "editorial-studio",
        label: "Editorial studio",
        prompt:
          "Place the product in a high-end fashion editorial studio with a warm beige backdrop, directional soft light, and a subtle film look.",
      },
      {
        key: "street-style",
        label: "Street style",
        prompt:
          "Place the product in an urban street scene with a blurred city background, natural daylight, and a candid editorial feel.",
      },
      {
        key: "marble-silk",
        label: "Marble & silk",
        prompt:
          "Place the product on a white marble surface with flowing silk fabric behind it and soft, glamorous lighting.",
      },
      {
        key: "golden-hour",
        label: "Golden hour",
        prompt:
          "Place the product in warm golden-hour sunlight with long soft shadows and a dreamy warm glow.",
      },
    ],
  },
  {
    key: "beauty",
    label: "Beauty & Care",
    prompts: [
      {
        key: "clean-white",
        label: "Clean white",
        prompt:
          "Place the product on a seamless pure white studio background with soft, even lighting and a subtle natural shadow beneath it.",
      },
      {
        key: "marble-counter",
        label: "Marble counter",
        prompt:
          "Place the product on a polished marble counter with soft spa-like lighting and an elegant blurred background.",
      },
      {
        key: "botanical-spa",
        label: "Botanical spa",
        prompt:
          "Place the product among fresh green leaves and natural stones with soft diffused daylight and a calm spa mood.",
      },
      {
        key: "silk-drape",
        label: "Silk drape",
        prompt:
          "Place the product on softly draped silk fabric in neutral tones with elegant studio lighting.",
      },
      {
        key: "water-splash",
        label: "Water splash",
        prompt:
          "Place the product on a wet reflective surface with fine water droplets and a fresh splash of water behind it, crisp studio lighting.",
      },
    ],
  },
  {
    key: "home",
    label: "Home & Kitchen",
    prompts: [
      {
        key: "clean-white",
        label: "Clean white",
        prompt:
          "Place the product on a seamless pure white studio background with soft, even lighting and a subtle natural shadow beneath it.",
      },
      {
        key: "cozy-living",
        label: "Cozy living room",
        prompt:
          "Stage the product in a cozy Scandinavian living room with warm lamps, soft textiles, and a gently blurred background.",
      },
      {
        key: "wooden-table",
        label: "Wooden table",
        prompt:
          "Place the product on a warm oak wooden table with soft morning light coming from a nearby window.",
      },
      {
        key: "sunlit-shelf",
        label: "Sunlit shelf",
        prompt:
          "Place the product on a bright shelf with sunlight and soft plant shadows falling across the wall behind it.",
      },
      {
        key: "minimal-concrete",
        label: "Minimal concrete",
        prompt:
          "Place the product on a minimal light-gray concrete pedestal with soft architectural shadows.",
      },
    ],
  },
  {
    key: "food",
    label: "Food & Drink",
    prompts: [
      {
        key: "clean-white",
        label: "Clean white",
        prompt:
          "Place the product on a seamless pure white studio background with soft, even lighting and a subtle natural shadow beneath it.",
      },
      {
        key: "rustic-wood",
        label: "Rustic wood",
        prompt:
          "Place the product on a rustic dark-wood table with a few scattered natural ingredients and warm side lighting.",
      },
      {
        key: "cafe-scene",
        label: "Cafe scene",
        prompt:
          "Place the product on a cafe table with a softly blurred coffee-shop background and warm ambient light.",
      },
      {
        key: "picnic-daylight",
        label: "Picnic daylight",
        prompt:
          "Place the product on a linen cloth outdoors in bright natural daylight with soft greenery in the background.",
      },
      {
        key: "dark-slate",
        label: "Dark slate",
        prompt:
          "Place the product on a dark slate surface with dramatic low-key lighting and a hint of mist in the background.",
      },
    ],
  },
];

export const HERO_BANNER_PROMPT_CATEGORIES: QuickPromptCategory[] = [
  {
    key: "hero-layouts",
    label: "Hero banners",
    prompts: [
      {
        key: "product-right",
        label: "Product right",
        prompt:
          "Create a premium ecommerce banner. Place the product on the right and keep the left side clean for text.",
      },
      {
        key: "product-left",
        label: "Product left",
        prompt:
          "Create a premium ecommerce banner. Place the product on the left and keep the right side clean for text.",
      },
      {
        key: "centered-campaign",
        label: "Centered campaign",
        prompt:
          "Create a clean centered campaign banner with generous horizontal margins and no baked-in text.",
      },
    ],
  },
];
