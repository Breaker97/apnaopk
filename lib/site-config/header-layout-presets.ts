/**
 * The Header Studio's "Select from template" gallery. Each preset is a
 * design expressed as rows, columns and items, so a merchant who picks one
 * lands on that header and can take any part of it apart. Nothing here is
 * a special case: every preset is reachable from an empty canvas with the
 * drawer alone.
 *
 * Only the studio imports this module; the storefront needs just the
 * default design (header-layout-default.ts).
 */

import {
  createHeaderRow,
  defaultTextStyle,
  solidBackground,
  type HeaderLayout,
  type HeaderMenuButtonItem,
  type HeaderSearchBarItem,
  type HeaderTextItem,
} from "@/lib/site-config/header-layout";
import {
  PRESET_NAV_LABELS,
  buildMenuFirstLayout,
  cart,
  categories,
  column,
  itemWith,
  navItem,
  presetLinks,
  searchPill,
  userIcon,
  utilityRow,
} from "@/lib/site-config/header-layout-default";

export const HEADER_LAYOUT_PRESET_KEYS = [
  "minimal",
  "nav-top",
  "classic",
  "banner-nav",
  "centered",
  "logo-center",
  "categories-sidebar",
  "categories-tinted",
  "showcase",
  "split-nav",
  "marketplace",
  "hamburger",
] as const;
export type HeaderLayoutPresetKey = (typeof HEADER_LAYOUT_PRESET_KEYS)[number];

interface HeaderLayoutPreset {
  key: HeaderLayoutPresetKey;
  label: string;
  description: string;
  build: () => HeaderLayout;
}

export const HEADER_LAYOUT_PRESETS: HeaderLayoutPreset[] = [
  {
    key: "minimal",
    label: "Minimal",
    description: "One row: logo, inline nav, a compact search and account.",
    build: () => ({
      rows: [
        createHeaderRow(3, { height: 80 }, [
          column([itemWith("brand")], { width: 1 }),
          column([navItem({ justify: "center", gap: 32 })], {
            width: 2.4,
            justify: "center",
          }),
          column([searchPill(), itemWith("user"), cart()], {
            width: 1.6,
            justify: "end",
            gap: 20,
          }),
        ]),
      ],
    }),
  },
  {
    key: "nav-top",
    label: "Menu first",
    description: "Logo and nav on top; categories and a wide search below.",
    build: buildMenuFirstLayout,
  },
  {
    key: "classic",
    label: "Classic",
    description: "Logo, search and account, with categories and nav below.",
    build: () => ({
      rows: [
        createHeaderRow(3, { height: 72 }, [
          column([itemWith("brand")], { width: 1 }),
          column([itemWith("searchBar")], { width: 2.6, justify: "center" }),
          column([userIcon(), cart()], { width: 1, justify: "end", gap: 20 }),
        ]),
        createHeaderRow(2, { height: 60, gap: 24 }, [
          column([categories({ width: 320 })], { width: 1 }),
          column([navItem({ gap: 32 })], { width: 2.3 }),
        ]),
        utilityRow(),
      ],
    }),
  },
  {
    key: "banner-nav",
    label: "Banner nav",
    description: "Logo, search and account above a coloured nav strip.",
    build: () => ({
      rows: [
        createHeaderRow(3, { height: 76 }, [
          column([itemWith("brand")], { width: 1 }),
          column([itemWith("searchBar")], { width: 2.6, justify: "center" }),
          column([userIcon(), cart()], { width: 1, justify: "end", gap: 20 }),
        ]),
        createHeaderRow(
          1,
          {
            height: 56,
            background: solidBackground("#3b6ff5"),
            foreground: solidBackground("#ffffff"),
          },
          [
            column(
              [navItem({ gap: 32, textStyle: defaultTextStyle({ fontWeight: 600 }) })],
              { width: 1 },
            ),
          ],
        ),
        utilityRow(),
      ],
    }),
  },
  {
    key: "centered",
    label: "Centered",
    description: "Inline nav, a centred logo, then search and account.",
    build: () => ({
      rows: [
        createHeaderRow(3, { height: 80 }, [
          column(
            [navItem({ gap: 32, links: presetLinks(PRESET_NAV_LABELS.slice(0, 4)) })],
            { width: 1.4 },
          ),
          column([itemWith("brand")], { width: 1, justify: "center" }),
          column([searchPill(), userIcon(), cart()], {
            width: 1.4,
            justify: "end",
            gap: 20,
          }),
        ]),
      ],
    }),
  },
  {
    key: "logo-center",
    label: "Logo centre",
    description: "Search, a centred logo and account, with a centred nav row.",
    build: () => ({
      rows: [
        createHeaderRow(3, { height: 80, borderBottom: 1 }, [
          column(
            [
              itemWith<HeaderSearchBarItem>("searchBar", {
                roundness: 10,
                borderThickness: 0,
                height: 44,
                background: solidBackground("#f2f2f2"),
                showCategoryFilter: false,
              }),
            ],
            { width: 1 },
          ),
          column([itemWith("brand")], { width: 1, justify: "center" }),
          column([userIcon(), cart()], { width: 1, justify: "end", gap: 28 }),
        ]),
        createHeaderRow(1, { height: 56 }, [
          column([navItem({ justify: "center", gap: 32 })], {
            width: 1,
            justify: "center",
          }),
        ]),
      ],
    }),
  },
  {
    key: "categories-sidebar",
    label: "Category sidebar",
    description: "Nav on top; an always-open category list beside the search.",
    build: () => ({
      rows: [
        createHeaderRow(3, { height: 72 }, [
          column([itemWith("brand")], { width: 1 }),
          column([navItem({ justify: "center", gap: 32 })], {
            width: 2.6,
            justify: "center",
          }),
          column([userIcon(), cart()], { width: 1, justify: "end", gap: 20 }),
        ]),
        createHeaderRow(2, { height: 64, gap: 16 }, [
          column([categories({ width: 340, openOn: "always" })], { width: 1 }),
          column([itemWith("searchBar")], { width: 3.4 }),
        ]),
        utilityRow(),
      ],
    }),
  },
  {
    key: "categories-tinted",
    label: "Tinted sidebar",
    description: "The category sidebar, with the list painted like its button.",
    build: () => ({
      rows: [
        createHeaderRow(3, { height: 72 }, [
          column([itemWith("brand")], { width: 1 }),
          column([navItem({ justify: "center", gap: 32 })], {
            width: 2.6,
            justify: "center",
          }),
          column([userIcon(), cart()], { width: 1, justify: "end", gap: 20 }),
        ]),
        createHeaderRow(2, { height: 64, gap: 16 }, [
          column(
            [
              categories({
                width: 340,
                openOn: "always",
                panel: {
                  background: solidBackground("#3b6ff5"),
                  foreground: solidBackground("#ffffff"),
                  width: 0,
                  itemRoundness: 999,
                  showIcons: true,
                  highlight: solidBackground("#ffffff33"),
                },
              }),
            ],
            { width: 1 },
          ),
          column([itemWith("searchBar")], { width: 3.4 }),
        ]),
        utilityRow(),
      ],
    }),
  },
  {
    key: "showcase",
    label: "Open categories",
    description: "Logo, search and account; the category list open beneath.",
    build: () => ({
      rows: [
        createHeaderRow(3, { height: 80 }, [
          column([itemWith("brand")], { width: 1 }),
          column([itemWith("searchBar")], { width: 2.2, justify: "center" }),
          column([itemWith("user"), cart()], { width: 1.4, justify: "end", gap: 28 }),
        ]),
        createHeaderRow(1, { height: 56 }, [
          column([categories({ width: 340, openOn: "always" })], { width: 1 }),
        ]),
        utilityRow(),
      ],
    }),
  },
  {
    key: "split-nav",
    label: "Split nav",
    description: "The nav split either side of a centred logo; account at the end.",
    build: () => ({
      rows: [
        createHeaderRow(3, { height: 80 }, [
          column(
            [navItem({ gap: 32, links: presetLinks(PRESET_NAV_LABELS.slice(0, 3)) })],
            { width: 1.4 },
          ),
          column([itemWith("brand")], { width: 1, justify: "center" }),
          column(
            [
              navItem({ gap: 32, links: presetLinks(PRESET_NAV_LABELS.slice(3)) }),
              itemWith("searchIcon"),
              cart(),
            ],
            { width: 1.4, justify: "end", gap: 24 },
          ),
        ]),
      ],
    }),
  },
  {
    key: "marketplace",
    label: "Marketplace",
    description: "Scoped search and account on top, a dark utility strip below.",
    build: () => ({
      rows: [
        createHeaderRow(3, { height: 72 }, [
          column([itemWith("brand")], { width: 1 }),
          column(
            [itemWith<HeaderSearchBarItem>("searchBar", { roundness: 8, height: 44 })],
            { width: 3, justify: "center" },
          ),
          column([itemWith("user"), cart()], { width: 1.4, justify: "end", gap: 24 }),
        ]),
        createHeaderRow(
          2,
          {
            height: 44,
            background: solidBackground("#1f2937"),
            foreground: solidBackground("#ffffff"),
          },
          [
            column(
              [
                itemWith<HeaderMenuButtonItem>("menuButton", {
                  size: 18,
                  showLabel: true,
                  label: "All",
                }),
                navItem({ gap: 24, textStyle: defaultTextStyle({ fontSize: 13 }) }),
              ],
              { width: 3, gap: 20 },
            ),
            column(
              [
                itemWith<HeaderTextItem>("text", {
                  content: "Free shipping on orders over $50",
                  textStyle: defaultTextStyle({ fontSize: 13 }),
                }),
              ],
              { width: 1, justify: "end" },
            ),
          ],
        ),
      ],
    }),
  },
  {
    key: "hamburger",
    label: "Hamburger",
    description: "A menu button, a centred logo, search and cart — nothing else.",
    build: () => ({
      rows: [
        createHeaderRow(3, { height: 72 }, [
          column([itemWith("menuButton")], { width: 1 }),
          column([itemWith("brand")], { width: 1, justify: "center" }),
          column([itemWith("searchIcon"), cart()], { width: 1, justify: "end", gap: 20 }),
        ]),
      ],
    }),
  },
];
