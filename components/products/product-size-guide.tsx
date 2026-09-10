"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/hooks/use-client-value";

// Lazy-loaded on demand (see product-details.tsx) so the static guide charts
// below ship to the client only when a shopper opens the size guide.
type SizeGuideProduct = {
  name: string;
  title?: string;
  category?: { name?: string } | null;
  tags?: string[];
  attributes?: { name: string; value: string }[];
};

type SizeGuideLine = "men" | "women" | "kids";
type SizeGuideType =
  | "apparelTops"
  | "apparelBottoms"
  | "footwear"
  | "rings"
  | "belts"
  | "hats"
  | "bags"
  | "homeTextiles";
type SizeGuideRegion = "US" | "UK" | "EU" | "International" | "JP";
type SizeGuideUnit = "in" | "cm";

type MeasurementRange = {
  min?: number;
  max?: number;
  text?: string;
};

type SizeGuideRow = {
  label: string;
  values: MeasurementRange[];
};

type SizeGuideChart = {
  alphaSizes: string[];
  regionSizes: Record<SizeGuideRegion, string[]>;
  rows: SizeGuideRow[];
  fitTips: string[];
  measureTips: { label: string; description: string }[];
};

const SIZE_GUIDE_REGIONS: SizeGuideRegion[] = [
  "US",
  "UK",
  "EU",
  "International",
  "JP",
];

const SIZE_GUIDE_LINES: { value: SizeGuideLine; label: string }[] = [
  { value: "men", label: "Men" },
  { value: "women", label: "Women" },
  { value: "kids", label: "Kids" },
];

const SIZE_GUIDE_TYPES: { value: SizeGuideType; label: string }[] = [
  { value: "apparelTops", label: "T-shirts, shirts & jackets" },
  { value: "apparelBottoms", label: "Pants, jeans & shorts" },
  { value: "footwear", label: "Shoes & footwear" },
  { value: "rings", label: "Rings" },
  { value: "belts", label: "Belts" },
  { value: "hats", label: "Hats & caps" },
  { value: "bags", label: "Bags & luggage" },
  { value: "homeTextiles", label: "Bedding, curtains & rugs" },
];

const MEN_TOPS: SizeGuideChart = {
  alphaSizes: ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL"],
  regionSizes: {
    US: ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL"],
    UK: ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL"],
    EU: ["40", "42", "44-46", "48-50", "52-54", "56", "58", "60"],
    International: ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL"],
    JP: ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"],
  },
  rows: [
    {
      label: "Chest",
      values: [
        { min: 31, max: 33 },
        { min: 33, max: 35 },
        { min: 35, max: 37 },
        { min: 38, max: 40 },
        { min: 41, max: 43 },
        { min: 44, max: 46 },
        { min: 47, max: 49 },
        { min: 50, max: 53 },
      ],
    },
    {
      label: "Waist",
      values: [
        { min: 25, max: 27 },
        { min: 27, max: 29 },
        { min: 29, max: 31 },
        { min: 32, max: 34 },
        { min: 35, max: 37 },
        { min: 38, max: 40 },
        { min: 41, max: 43 },
        { min: 44, max: 47 },
      ],
    },
    {
      label: "Hip",
      values: [
        { min: 31, max: 33 },
        { min: 33, max: 35 },
        { min: 35, max: 37 },
        { min: 38, max: 40 },
        { min: 41, max: 43 },
        { min: 44, max: 46 },
        { min: 47, max: 49 },
        { min: 50, max: 53 },
      ],
    },
  ],
  fitTips: [
    "For tops, choose the size that matches your chest measurement first. Use waist and hip measurements to refine the fit.",
    "If you are between two sizes, choose the smaller size for a closer fit or the larger size for a relaxed fit.",
  ],
  measureTips: [
    {
      label: "Chest",
      description: "Measure under your arms around the fullest part of your chest.",
    },
    {
      label: "Waist",
      description:
        "Measure around your natural waist, keeping the tape comfortably loose.",
    },
    {
      label: "Hip",
      description: "Measure around the fullest part of your seat with feet together.",
    },
  ],
};

const MEN_BOTTOMS: SizeGuideChart = {
  alphaSizes: ["XS", "S", "M", "L", "XL", "XXL", "3XL"],
  regionSizes: {
    US: ["28", "30", "32", "34", "36", "38", "40"],
    UK: ["28", "30", "32", "34", "36", "38", "40"],
    EU: ["44", "46", "48", "50", "52", "54", "56"],
    International: ["XS", "S", "M", "L", "XL", "XXL", "3XL"],
    JP: ["XS", "S", "M", "L", "XL", "XXL", "3XL"],
  },
  rows: [
    {
      label: "Waist",
      values: [
        { min: 27, max: 29 },
        { min: 29, max: 31 },
        { min: 31, max: 33 },
        { min: 33, max: 35 },
        { min: 35, max: 37 },
        { min: 37, max: 39 },
        { min: 39, max: 41 },
      ],
    },
    {
      label: "Hip",
      values: [
        { min: 33, max: 35 },
        { min: 35, max: 37 },
        { min: 37, max: 39 },
        { min: 39, max: 41 },
        { min: 41, max: 43 },
        { min: 43, max: 45 },
        { min: 45, max: 47 },
      ],
    },
    {
      label: "Inseam",
      values: [
        { min: 30, max: 32 },
        { min: 30, max: 32 },
        { min: 31, max: 33 },
        { min: 31, max: 33 },
        { min: 32, max: 34 },
        { min: 32, max: 34 },
        { min: 32, max: 34 },
      ],
    },
  ],
  fitTips: [
    "For pants and jeans, choose the size that matches your waist. Check hip measurement if you prefer more room through the seat and thigh.",
    "If your waist and hip measurements point to different sizes, choose the larger size for comfort.",
  ],
  measureTips: [
    {
      label: "Waist",
      description: "Measure around the waistband line where you normally wear trousers.",
    },
    {
      label: "Hip",
      description: "Measure around the fullest part of your hips and seat.",
    },
    {
      label: "Inseam",
      description: "Measure from the crotch seam to the bottom of the ankle.",
    },
  ],
};

const WOMEN_TOPS: SizeGuideChart = {
  alphaSizes: ["XXS", "XS", "S", "M", "L", "XL", "XXL"],
  regionSizes: {
    US: ["00", "0-2", "4-6", "8-10", "12-14", "16-18", "20"],
    UK: ["2", "4-6", "8-10", "12-14", "16-18", "20-22", "24"],
    EU: ["30", "32-34", "36-38", "40-42", "44-46", "48-50", "52"],
    International: ["XXS", "XS", "S", "M", "L", "XL", "XXL"],
    JP: ["3", "5", "7-9", "11-13", "15-17", "19-21", "23"],
  },
  rows: [
    {
      label: "Bust",
      values: [
        { min: 29.5, max: 31.5 },
        { min: 31.5, max: 33.5 },
        { min: 33.5, max: 35.5 },
        { min: 35.5, max: 38 },
        { min: 38, max: 41 },
        { min: 41, max: 44.5 },
        { min: 44.5, max: 48 },
      ],
    },
    {
      label: "Waist",
      values: [
        { min: 23.5, max: 25.5 },
        { min: 25.5, max: 27.5 },
        { min: 27.5, max: 29.5 },
        { min: 29.5, max: 32 },
        { min: 32, max: 35 },
        { min: 35, max: 38.5 },
        { min: 38.5, max: 42 },
      ],
    },
    {
      label: "Hip",
      values: [
        { min: 33, max: 35 },
        { min: 35, max: 37 },
        { min: 37, max: 39 },
        { min: 39, max: 41.5 },
        { min: 41.5, max: 44.5 },
        { min: 44.5, max: 48 },
        { min: 48, max: 51.5 },
      ],
    },
  ],
  fitTips: [
    "For tops and dresses, choose the size that matches your bust. Use waist and hip measurements to adjust for the silhouette.",
    "If your measurements sit between sizes, size down for a closer fit or size up for more ease.",
  ],
  measureTips: [
    {
      label: "Bust",
      description: "Measure around the fullest part of your bust, keeping the tape level.",
    },
    {
      label: "Waist",
      description: "Measure around the narrowest part of your natural waist.",
    },
    {
      label: "Hip",
      description: "Measure around the fullest part of your hips while standing.",
    },
  ],
};

const WOMEN_BOTTOMS: SizeGuideChart = {
  alphaSizes: ["XXS", "XS", "S", "M", "L", "XL", "XXL"],
  regionSizes: {
    US: ["00", "0-2", "4-6", "8-10", "12-14", "16-18", "20"],
    UK: ["2", "4-6", "8-10", "12-14", "16-18", "20-22", "24"],
    EU: ["30", "32-34", "36-38", "40-42", "44-46", "48-50", "52"],
    International: ["XXS", "XS", "S", "M", "L", "XL", "XXL"],
    JP: ["3", "5", "7-9", "11-13", "15-17", "19-21", "23"],
  },
  rows: [
    {
      label: "Waist",
      values: [
        { min: 23.5, max: 25.5 },
        { min: 25.5, max: 27.5 },
        { min: 27.5, max: 29.5 },
        { min: 29.5, max: 32 },
        { min: 32, max: 35 },
        { min: 35, max: 38.5 },
        { min: 38.5, max: 42 },
      ],
    },
    {
      label: "Hip",
      values: [
        { min: 33, max: 35 },
        { min: 35, max: 37 },
        { min: 37, max: 39 },
        { min: 39, max: 41.5 },
        { min: 41.5, max: 44.5 },
        { min: 44.5, max: 48 },
        { min: 48, max: 51.5 },
      ],
    },
    {
      label: "Inseam",
      values: [
        { min: 28, max: 30 },
        { min: 28, max: 30 },
        { min: 29, max: 31 },
        { min: 29, max: 31 },
        { min: 30, max: 32 },
        { min: 30, max: 32 },
        { min: 30, max: 32 },
      ],
    },
  ],
  fitTips: [
    "For pants, jeans and skirts, choose the size that matches your waist. Check hip measurement for fitted styles.",
    "If waist and hip fall into different sizes, choose based on the area where you prefer more comfort.",
  ],
  measureTips: [
    {
      label: "Waist",
      description: "Measure around the narrowest part of your natural waist.",
    },
    {
      label: "Hip",
      description: "Measure around the fullest part of your hips while standing.",
    },
    {
      label: "Inseam",
      description: "Measure from the top of the inner thigh to the ankle bone.",
    },
  ],
};

const KIDS_TOPS: SizeGuideChart = {
  alphaSizes: ["2T", "3T", "4T", "5", "6", "7", "8", "10", "12"],
  regionSizes: {
    US: ["2T", "3T", "4T", "5", "6", "7", "8", "10", "12"],
    UK: ["2-3Y", "3-4Y", "4-5Y", "5-6Y", "6-7Y", "7-8Y", "8-9Y", "9-10Y", "11-12Y"],
    EU: ["92", "98", "104", "110", "116", "122", "128", "140", "152"],
    International: ["2Y", "3Y", "4Y", "5Y", "6Y", "7Y", "8Y", "10Y", "12Y"],
    JP: ["90", "100", "105", "110", "120", "120", "130", "140", "150"],
  },
  rows: [
    {
      label: "Height",
      values: [
        { min: 33, max: 35 },
        { min: 35, max: 38 },
        { min: 38, max: 41 },
        { min: 41, max: 44 },
        { min: 44, max: 46.5 },
        { min: 46.5, max: 49.5 },
        { min: 49.5, max: 52 },
        { min: 52, max: 56 },
        { min: 56, max: 60 },
      ],
    },
    {
      label: "Chest",
      values: [
        { min: 20, max: 21 },
        { min: 21, max: 22 },
        { min: 22, max: 23 },
        { min: 23, max: 24 },
        { min: 24, max: 25 },
        { min: 25, max: 26 },
        { min: 26, max: 27 },
        { min: 27, max: 29 },
        { min: 29, max: 31 },
      ],
    },
    {
      label: "Waist",
      values: [
        { min: 19.5, max: 20.5 },
        { min: 20, max: 21 },
        { min: 20.5, max: 21.5 },
        { min: 21, max: 22 },
        { min: 22, max: 23 },
        { min: 22.5, max: 23.5 },
        { min: 23, max: 24 },
        { min: 24, max: 25 },
        { min: 25, max: 26 },
      ],
    },
  ],
  fitTips: [
    "For kids apparel, choose the size by height first, then use chest and waist measurements to refine the fit.",
    "If the child is between sizes, size up for room to grow.",
  ],
  measureTips: [
    {
      label: "Height",
      description: "Measure from the top of the head to the floor while standing straight.",
    },
    {
      label: "Chest",
      description: "Measure around the fullest part of the chest.",
    },
    {
      label: "Waist",
      description: "Measure around the natural waist without pulling the tape tight.",
    },
  ],
};

const KIDS_BOTTOMS: SizeGuideChart = {
  alphaSizes: ["2T", "3T", "4T", "5", "6", "7", "8", "10", "12"],
  regionSizes: KIDS_TOPS.regionSizes,
  rows: [
    KIDS_TOPS.rows[0],
    KIDS_TOPS.rows[2],
    {
      label: "Hip",
      values: [
        { min: 20.5, max: 21.5 },
        { min: 21.5, max: 22.5 },
        { min: 22.5, max: 23.5 },
        { min: 23.5, max: 24.5 },
        { min: 24.5, max: 25.5 },
        { min: 25.5, max: 26.5 },
        { min: 26.5, max: 28 },
        { min: 28, max: 30 },
        { min: 30, max: 32 },
      ],
    },
    {
      label: "Inseam",
      values: [
        { min: 13, max: 14 },
        { min: 14, max: 15 },
        { min: 15, max: 16 },
        { min: 17, max: 18 },
        { min: 18, max: 19 },
        { min: 19, max: 20 },
        { min: 20, max: 21 },
        { min: 22, max: 24 },
        { min: 25, max: 27 },
      ],
    },
  ],
  fitTips: [
    "For kids bottoms, choose by waist and height. Check inseam for trousers and jeans.",
    "Size up when a child is between sizes or needs extra movement room.",
  ],
  measureTips: [
    {
      label: "Waist",
      description: "Measure around the child's natural waist.",
    },
    {
      label: "Hip",
      description: "Measure around the fullest part of the hips.",
    },
    {
      label: "Inseam",
      description: "Measure from the crotch seam to the ankle.",
    },
  ],
};

const MEN_FOOTWEAR: SizeGuideChart = {
  alphaSizes: ["6", "7", "8", "9", "10", "11", "12", "13"],
  regionSizes: {
    US: ["6", "7", "8", "9", "10", "11", "12", "13"],
    UK: ["5.5", "6.5", "7.5", "8.5", "9.5", "10.5", "11.5", "12.5"],
    EU: ["39", "40", "41", "42", "43", "44", "45", "46-47"],
    International: ["XS", "S", "S/M", "M", "M/L", "L", "XL", "XXL"],
    JP: ["24", "25", "26", "27", "28", "29", "30", "31"],
  },
  rows: [
    {
      label: "Foot length",
      values: [
        { min: 9.25, max: 9.5 },
        { min: 9.5, max: 9.75 },
        { min: 9.75, max: 10 },
        { min: 10, max: 10.25 },
        { min: 10.25, max: 10.6 },
        { min: 10.6, max: 10.9 },
        { min: 10.9, max: 11.25 },
        { min: 11.25, max: 11.6 },
      ],
    },
  ],
  fitTips: [
    "For footwear, choose the size that matches the longer foot. Leave a small amount of toe room for closed shoes.",
    "If one foot is larger, use the larger foot measurement when selecting the size.",
  ],
  measureTips: [
    {
      label: "Foot length",
      description:
        "Stand on paper, mark heel and longest toe, then measure the distance between the marks.",
    },
  ],
};

const WOMEN_FOOTWEAR: SizeGuideChart = {
  alphaSizes: ["5", "6", "7", "8", "9", "10", "11", "12"],
  regionSizes: {
    US: ["5", "6", "7", "8", "9", "10", "11", "12"],
    UK: ["3", "4", "5", "6", "7", "8", "9", "10"],
    EU: ["35-36", "36-37", "37-38", "38-39", "39-40", "40-41", "41-42", "42-43"],
    International: ["XS", "S", "S/M", "M", "M/L", "L", "XL", "XXL"],
    JP: ["22", "23", "24", "25", "26", "27", "28", "29"],
  },
  rows: [
    {
      label: "Foot length",
      values: [
        { min: 8.5, max: 8.75 },
        { min: 8.75, max: 9 },
        { min: 9, max: 9.25 },
        { min: 9.25, max: 9.5 },
        { min: 9.5, max: 9.875 },
        { min: 9.875, max: 10.2 },
        { min: 10.2, max: 10.5 },
        { min: 10.5, max: 10.85 },
      ],
    },
  ],
  fitTips: MEN_FOOTWEAR.fitTips,
  measureTips: MEN_FOOTWEAR.measureTips,
};

const KIDS_FOOTWEAR: SizeGuideChart = {
  alphaSizes: ["10C", "11C", "12C", "13C", "1Y", "2Y", "3Y", "4Y", "5Y"],
  regionSizes: {
    US: ["10C", "11C", "12C", "13C", "1Y", "2Y", "3Y", "4Y", "5Y"],
    UK: ["9.5", "10.5", "11.5", "12.5", "13.5", "1.5", "2.5", "3.5", "4.5"],
    EU: ["27", "28", "29-30", "31", "32", "33", "34", "35", "36-37"],
    International: ["10C", "11C", "12C", "13C", "1Y", "2Y", "3Y", "4Y", "5Y"],
    JP: ["16", "17", "18", "19", "20", "21", "22", "23", "24"],
  },
  rows: [
    {
      label: "Foot length",
      values: [
        { min: 6.25, max: 6.5 },
        { min: 6.5, max: 6.75 },
        { min: 6.75, max: 7.125 },
        { min: 7.125, max: 7.5 },
        { min: 7.5, max: 7.75 },
        { min: 7.75, max: 8.125 },
        { min: 8.125, max: 8.5 },
        { min: 8.5, max: 8.75 },
        { min: 8.75, max: 9.125 },
      ],
    },
  ],
  fitTips: [
    "For kids shoes, measure both feet and choose the size for the longer foot.",
    "Allow a little extra room at the toe so the shoe stays comfortable as the child moves.",
  ],
  measureTips: MEN_FOOTWEAR.measureTips,
};

const RINGS: SizeGuideChart = {
  alphaSizes: ["4", "5", "6", "7", "8", "9", "10", "11", "12", "13"],
  regionSizes: {
    US: ["4", "5", "6", "7", "8", "9", "10", "11", "12", "13"],
    UK: ["H", "J 1/2", "L 1/2", "N 1/2", "P 1/2", "R 1/2", "T 1/2", "V 1/2", "Y", "Z+1"],
    EU: ["47", "49", "52", "54", "57", "59", "62", "64", "67", "70"],
    International: ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"],
    JP: ["7", "9", "11", "14", "16", "18", "20", "23", "25", "27"],
  },
  rows: [
    {
      label: "Inside diameter",
      values: [
        { min: 0.586, max: 0.594 },
        { min: 0.618, max: 0.626 },
        { min: 0.65, max: 0.658 },
        { min: 0.682, max: 0.69 },
        { min: 0.714, max: 0.722 },
        { min: 0.746, max: 0.754 },
        { min: 0.778, max: 0.786 },
        { min: 0.81, max: 0.818 },
        { min: 0.842, max: 0.85 },
        { min: 0.874, max: 0.882 },
      ],
    },
    {
      label: "Inside circumference",
      values: [
        { min: 1.84, max: 1.87 },
        { min: 1.94, max: 1.97 },
        { min: 2.04, max: 2.07 },
        { min: 2.14, max: 2.17 },
        { min: 2.24, max: 2.27 },
        { min: 2.34, max: 2.37 },
        { min: 2.44, max: 2.47 },
        { min: 2.54, max: 2.57 },
        { min: 2.64, max: 2.67 },
        { min: 2.74, max: 2.77 },
      ],
    },
  ],
  fitTips: [
    "Rings should slide over the knuckle with slight resistance and sit comfortably at the base of the finger.",
    "Measure fingers near the end of the day when they are usually at their largest.",
  ],
  measureTips: [
    {
      label: "Inside diameter",
      description: "Measure the inside width of a ring that already fits well.",
    },
    {
      label: "Circumference",
      description:
        "Wrap a thin strip of paper around the finger, mark the overlap, then measure the strip.",
    },
  ],
};

const BELTS: SizeGuideChart = {
  alphaSizes: ["XS", "S", "M", "L", "XL", "XXL"],
  regionSizes: {
    US: ["28", "30", "32-34", "36-38", "40-42", "44-46"],
    UK: ["28", "30", "32-34", "36-38", "40-42", "44-46"],
    EU: ["70", "75", "80-85", "90-95", "100-105", "110-115"],
    International: ["XS", "S", "M", "L", "XL", "XXL"],
    JP: ["70", "75", "80-85", "90-95", "100-105", "110-115"],
  },
  rows: [
    {
      label: "Waist",
      values: [
        { min: 26, max: 28 },
        { min: 28, max: 30 },
        { min: 31, max: 34 },
        { min: 35, max: 38 },
        { min: 39, max: 42 },
        { min: 43, max: 46 },
      ],
    },
    {
      label: "Belt length",
      values: [
        { min: 32, max: 34 },
        { min: 34, max: 36 },
        { min: 37, max: 40 },
        { min: 41, max: 44 },
        { min: 45, max: 48 },
        { min: 49, max: 52 },
      ],
    },
  ],
  fitTips: [
    "Choose a belt about two inches larger than your waist measurement for a standard fit.",
    "For low-rise styling, measure where the belt will actually sit.",
  ],
  measureTips: [
    {
      label: "Waist",
      description: "Measure around the point where you plan to wear the belt.",
    },
    {
      label: "Belt length",
      description:
        "Measure from the buckle fold to the hole you use most often on a belt that fits.",
    },
  ],
};

const HATS: SizeGuideChart = {
  alphaSizes: ["XS", "S", "M", "L", "XL"],
  regionSizes: {
    US: ["6 5/8", "6 3/4-6 7/8", "7-7 1/8", "7 1/4-7 3/8", "7 1/2-7 5/8"],
    UK: ["6 5/8", "6 3/4-6 7/8", "7-7 1/8", "7 1/4-7 3/8", "7 1/2-7 5/8"],
    EU: ["53", "54-55", "56-57", "58-59", "60-61"],
    International: ["XS", "S", "M", "L", "XL"],
    JP: ["53", "54-55", "56-57", "58-59", "60-61"],
  },
  rows: [
    {
      label: "Head circumference",
      values: [
        { min: 20.75, max: 21 },
        { min: 21.25, max: 21.75 },
        { min: 22, max: 22.5 },
        { min: 22.75, max: 23.25 },
        { min: 23.5, max: 24 },
      ],
    },
  ],
  fitTips: [
    "A hat should feel secure without leaving pressure marks.",
    "If you are between sizes, choose the larger size for structured hats and adjust down if possible.",
  ],
  measureTips: [
    {
      label: "Head circumference",
      description:
        "Measure around the head about half an inch above the eyebrows and ears.",
    },
  ],
};

const BAGS: SizeGuideChart = {
  alphaSizes: ["Small", "Medium", "Large", "Cabin", "Checked"],
  regionSizes: {
    US: ["Small", "Medium", "Large", "Carry-on", "Checked"],
    UK: ["Small", "Medium", "Large", "Cabin", "Checked"],
    EU: ["Small", "Medium", "Large", "Cabin", "Checked"],
    International: ["Small", "Medium", "Large", "Cabin", "Checked"],
    JP: ["Small", "Medium", "Large", "Cabin", "Checked"],
  },
  rows: [
    {
      label: "Height",
      values: [
        { min: 8, max: 11 },
        { min: 11, max: 16 },
        { min: 16, max: 20 },
        { min: 20, max: 22 },
        { min: 24, max: 30 },
      ],
    },
    {
      label: "Width",
      values: [
        { min: 6, max: 10 },
        { min: 10, max: 14 },
        { min: 14, max: 18 },
        { min: 13, max: 16 },
        { min: 16, max: 20 },
      ],
    },
    {
      label: "Depth",
      values: [
        { min: 2, max: 4 },
        { min: 4, max: 7 },
        { min: 7, max: 10 },
        { min: 8, max: 10 },
        { min: 10, max: 13 },
      ],
    },
    {
      label: "Laptop fit",
      values: [
        { text: "Up to 10 in" },
        { text: "Up to 13 in" },
        { text: "Up to 15 in" },
        { text: "Up to 15 in" },
        { text: "Varies" },
      ],
    },
  ],
  fitTips: [
    "For bags, check device compatibility and internal dimensions, not only the outer size.",
    "Airline cabin limits can vary, so always compare carry-on dimensions with the airline rule before travel.",
  ],
  measureTips: [
    {
      label: "Height",
      description: "Measure from the bottom of the bag to the highest point.",
    },
    {
      label: "Width",
      description: "Measure across the widest front-facing point.",
    },
    {
      label: "Depth",
      description: "Measure from the front to the back at the deepest point.",
    },
  ],
};

const HOME_TEXTILES: SizeGuideChart = {
  alphaSizes: ["Twin", "Full", "Queen", "King", "Curtain", "Rug"],
  regionSizes: {
    US: ["Twin", "Full", "Queen", "King", "Panel", "Area"],
    UK: ["Single", "Double", "King", "Super King", "Panel", "Area"],
    EU: ["90x200", "140x200", "160x200", "180x200", "Panel", "Area"],
    International: ["Twin", "Full", "Queen", "King", "Curtain", "Rug"],
    JP: ["Single", "Semi-double", "Double", "Queen", "Panel", "Area"],
  },
  rows: [
    {
      label: "Width",
      values: [
        { min: 38, max: 39 },
        { min: 53, max: 54 },
        { min: 60, max: 60 },
        { min: 76, max: 78 },
        { min: 50, max: 54 },
        { min: 60, max: 96 },
      ],
    },
    {
      label: "Length",
      values: [
        { min: 74, max: 80 },
        { min: 74, max: 80 },
        { min: 80, max: 80 },
        { min: 80, max: 80 },
        { min: 84, max: 96 },
        { min: 84, max: 120 },
      ],
    },
  ],
  fitTips: [
    "For bedding, match the mattress size first and then check pocket depth if the product is a fitted sheet.",
    "For curtains and rugs, measure the actual space before choosing the size.",
  ],
  measureTips: [
    {
      label: "Bedding",
      description: "Measure mattress width, length and depth before selecting sheets.",
    },
    {
      label: "Curtains",
      description: "Measure rod width and the drop from rod to desired endpoint.",
    },
    {
      label: "Rugs",
      description: "Measure the area you want the rug to cover, leaving room around furniture.",
    },
  ],
};

const SIZE_GUIDE_DATA: Record<
  SizeGuideLine,
  Record<SizeGuideType, SizeGuideChart>
> = {
  men: {
    apparelTops: MEN_TOPS,
    apparelBottoms: MEN_BOTTOMS,
    footwear: MEN_FOOTWEAR,
    rings: RINGS,
    belts: BELTS,
    hats: HATS,
    bags: BAGS,
    homeTextiles: HOME_TEXTILES,
  },
  women: {
    apparelTops: WOMEN_TOPS,
    apparelBottoms: WOMEN_BOTTOMS,
    footwear: WOMEN_FOOTWEAR,
    rings: RINGS,
    belts: BELTS,
    hats: HATS,
    bags: BAGS,
    homeTextiles: HOME_TEXTILES,
  },
  kids: {
    apparelTops: KIDS_TOPS,
    apparelBottoms: KIDS_BOTTOMS,
    footwear: KIDS_FOOTWEAR,
    rings: RINGS,
    belts: BELTS,
    hats: HATS,
    bags: BAGS,
    homeTextiles: HOME_TEXTILES,
  },
};

function getProductText(product: SizeGuideProduct) {
  return [
    product.name,
    product.title,
    product.category?.name,
    ...(product.tags || []),
    ...(product.attributes || []).map((attr) => `${attr.name} ${attr.value}`),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function inferSizeGuideLine(product: SizeGuideProduct): SizeGuideLine {
  const text = getProductText(product);

  if (
    /\b(kid|kids|child|children|junior|youth|toddler|baby|infant|boy|boys|girl|girls)\b/.test(
      text,
    )
  ) {
    return "kids";
  }
  if (/\b(women|woman|female|ladies|lady)\b/.test(text)) return "women";
  return "men";
}

function inferSizeGuideType(product: SizeGuideProduct): SizeGuideType {
  const text = getProductText(product);

  if (/\b(shoe|shoes|sneaker|sneakers|boot|boots|sandal|sandals|footwear)\b/.test(text)) {
    return "footwear";
  }
  if (/\b(ring|rings)\b/.test(text)) return "rings";
  if (/\b(belt|belts)\b/.test(text)) return "belts";
  if (/\b(hat|hats|cap|caps|beanie|helmet)\b/.test(text)) return "hats";
  if (/\b(bag|bags|backpack|handbag|luggage|suitcase|duffel|tote)\b/.test(text)) {
    return "bags";
  }
  if (
    /\b(bedding|bedsheet|bed sheet|sheet|duvet|pillow|curtain|rug|carpet|towel|mattress)\b/.test(
      text,
    )
  ) {
    return "homeTextiles";
  }
  if (
    /\b(pant|pants|jean|jeans|trouser|trousers|short|shorts|skirt|leggings)\b/.test(
      text,
    )
  ) {
    return "apparelBottoms";
  }
  return "apparelTops";
}

function formatMeasurementValue(value: number, unit: SizeGuideUnit) {
  const converted = unit === "cm" ? value * 2.54 : value;
  const rounded =
    unit === "cm" ? Math.round(converted * 10) / 10 : Math.round(converted * 2) / 2;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatMeasurementRange(range: MeasurementRange, unit: SizeGuideUnit) {
  if (range.text) return range.text;

  const suffix = unit === "cm" ? " cm" : " in";
  if (typeof range.min === "number" && typeof range.max === "number") {
    if (range.min === range.max) {
      return `${formatMeasurementValue(range.min, unit)}${suffix}`;
    }

    return `${formatMeasurementValue(range.min, unit)} - ${formatMeasurementValue(
      range.max,
      unit,
    )}${suffix}`;
  }
  if (typeof range.min === "number") {
    return `${formatMeasurementValue(range.min, unit)}+${suffix}`;
  }
  if (typeof range.max === "number") {
    return `Up to ${formatMeasurementValue(range.max, unit)}${suffix}`;
  }
  return "-";
}

interface ProductSizeGuideProps {
  product: SizeGuideProduct;
  onClose: () => void;
}

export default function ProductSizeGuide({
  product,
  onClose,
}: ProductSizeGuideProps) {
  const mounted = useHydrated();
  const [sizeGuideLine, setSizeGuideLine] = useState<SizeGuideLine>(() =>
    inferSizeGuideLine(product),
  );
  const [sizeGuideType, setSizeGuideType] = useState<SizeGuideType>(() =>
    inferSizeGuideType(product),
  );
  const [sizeGuideRegion, setSizeGuideRegion] = useState<SizeGuideRegion>("US");
  const [sizeGuideUnit, setSizeGuideUnit] = useState<SizeGuideUnit>("in");
  const sizeGuideChart = SIZE_GUIDE_DATA[sizeGuideLine][sizeGuideType];
  const measurementColumns = sizeGuideChart.regionSizes[sizeGuideRegion];

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-[1px]"
      onClick={() => onClose()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Size guide"
        className="absolute left-1/2 top-1/2 h-[min(620px,calc(100vh-3rem))] w-[min(1100px,calc(100vw-2.25rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-sm border bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-7 py-3">
          <h2 className="text-base font-semibold leading-[0.95] tracking-tight text-foreground">
            Size guide
          </h2>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground hover:bg-muted/80"
            aria-label="Close size guide"
            onClick={() => onClose()}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="h-[calc(100%-86px)] overflow-y-auto px-7 py-6 text-foreground">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <span className="text-[12px] text-muted-foreground">Line</span>
              <div className="relative">
                <NativeSelect
                  value={sizeGuideLine}
                  onChange={(event) =>
                    setSizeGuideLine(event.target.value as SizeGuideLine)
                  }
                  className="h-12 w-full appearance-none rounded-md border-border bg-background pr-10 text-base text-foreground"
                >
                  {SIZE_GUIDE_LINES.map((line) => (
                    <option key={line.value} value={line.value}>
                      {line.label}
                    </option>
                  ))}
                </NativeSelect>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </div>
            </label>

            <label className="space-y-2">
              <span className="text-[12px] text-muted-foreground">
                Size guide type
              </span>
              <div className="relative">
                <NativeSelect
                  value={sizeGuideType}
                  onChange={(event) =>
                    setSizeGuideType(event.target.value as SizeGuideType)
                  }
                  className="h-12 w-full appearance-none rounded-md border-border bg-background pr-10 text-base text-foreground"
                >
                  {SIZE_GUIDE_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </NativeSelect>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </div>
            </label>

            <label className="space-y-2">
              <span className="text-[12px] text-muted-foreground">Region</span>
              <div className="relative">
                <NativeSelect
                  value={sizeGuideRegion}
                  onChange={(event) =>
                    setSizeGuideRegion(event.target.value as SizeGuideRegion)
                  }
                  className="h-12 w-full appearance-none rounded-md border-border bg-background pr-10 text-base text-foreground"
                >
                  {SIZE_GUIDE_REGIONS.map((region) => (
                    <option key={region} value={region}>
                      {region}
                    </option>
                  ))}
                </NativeSelect>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </div>
            </label>
          </div>

          <div className="mt-5 flex justify-end">
            <div className="inline-flex items-center gap-8 text-lg leading-none text-muted-foreground">
              <button
                type="button"
                onClick={() => setSizeGuideUnit("in")}
                className="inline-flex items-center gap-2"
              >
                <span
                  className={cn(
                    "inline-flex h-4 w-4 rounded-full border",
                    sizeGuideUnit === "in"
                      ? "border-blue-500 bg-blue-500 ring-2 ring-blue-200"
                      : "border-border bg-background",
                  )}
                />
                in
              </button>
              <button
                type="button"
                onClick={() => setSizeGuideUnit("cm")}
                className="inline-flex items-center gap-2"
              >
                <span
                  className={cn(
                    "inline-flex h-4 w-4 rounded-full border",
                    sizeGuideUnit === "cm"
                      ? "border-blue-500 bg-blue-500 ring-2 ring-blue-200"
                      : "border-border bg-background",
                  )}
                />
                cm
              </button>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-md border border-border">
            <div className="min-w-[760px]">
              <div
                className="grid border-b border-border text-sm text-foreground"
                style={{
                  gridTemplateColumns: `118px repeat(${measurementColumns.length}, minmax(92px, 1fr))`,
                }}
              >
                <div className="bg-muted px-4 py-4 font-medium">Size</div>
                {measurementColumns.map((column, index) => (
                  <div
                    key={`${sizeGuideRegion}-${column}-${index}`}
                    className={cn(
                      "border-l border-border px-4 py-4 font-medium",
                      index % 2 === 0 ? "bg-muted/80" : "bg-muted",
                    )}
                  >
                    {column}
                  </div>
                ))}
              </div>
              {sizeGuideChart.rows.map((row) => (
                <div
                  key={row.label}
                  className="grid border-b border-border text-sm last:border-b-0"
                  style={{
                    gridTemplateColumns: `118px repeat(${measurementColumns.length}, minmax(92px, 1fr))`,
                  }}
                >
                  <div className="bg-muted px-4 py-6 font-medium text-foreground">
                    {row.label}
                  </div>
                  {row.values.map((value, index) => (
                    <div
                      key={`${row.label}-${index}`}
                      className={cn(
                        "border-l border-border px-4 py-6 text-muted-foreground",
                        index % 2 === 0 ? "bg-muted/80" : "bg-muted",
                      )}
                    >
                      {formatMeasurementRange(value, sizeGuideUnit)}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-8 space-y-5 text-sm leading-[1.35] text-muted-foreground">
            <h3 className="text-base font-semibold leading-none text-foreground">
              Fit tips
            </h3>
            {sizeGuideChart.fitTips.map((tip) => (
              <p key={tip}>{tip}</p>
            ))}
          </div>

          <div className="mt-8">
            <h3 className="text-sm font-semibold leading-none text-foreground">
              How to measure
            </h3>
            <ul className="mt-4 list-disc space-y-1 pl-6 text-sm leading-[1.35] text-muted-foreground">
              {sizeGuideChart.measureTips.map((tip) => (
                <li key={tip.label}>
                  <span className="font-semibold text-foreground">
                    {tip.label}:
                  </span>{" "}
                  {tip.description}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-8">
            <h3 className="mb-4 text-sm font-semibold leading-none text-foreground">
              International size equivalents
            </h3>
            <div className="overflow-hidden rounded-md border border-border">
              <div
                className="grid border-b border-border bg-muted text-xs font-semibold text-foreground"
                style={{
                  gridTemplateColumns: `repeat(${SIZE_GUIDE_REGIONS.length}, minmax(0, 1fr))`,
                }}
              >
                {SIZE_GUIDE_REGIONS.map((column) => (
                  <div
                    key={column}
                    className="border-r border-border px-4 py-4 last:border-r-0"
                  >
                    {column}
                  </div>
                ))}
              </div>
              {sizeGuideChart.alphaSizes.map((row, index) => (
                <div
                  key={row}
                  className={cn(
                    "grid border-b border-border text-xs last:border-b-0",
                    index % 2 === 0 ? "bg-background" : "bg-muted/40",
                  )}
                  style={{
                    gridTemplateColumns: `repeat(${SIZE_GUIDE_REGIONS.length}, minmax(0, 1fr))`,
                  }}
                >
                  {SIZE_GUIDE_REGIONS.map((column) => (
                    <div
                      key={`${row}-${column}`}
                      className="border-r border-border px-4 py-4 text-muted-foreground last:border-r-0"
                    >
                      {sizeGuideChart.regionSizes[column][index] ?? row}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
