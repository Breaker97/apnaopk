/**
 * Per-template export rules: what a template's snapshot deliberately does NOT
 * take verbatim from its source store.
 *
 * A demo store is also a working database. QA runs against it, so it collects
 * test vendors and renamed posts. And some decisions exist only in the
 * snapshot because they are about what a FRESH install gets: new installs
 * follow the theme colours, while the live demo keeps the hex values it was
 * saved with (e5657df3). Those decisions used to be hand edits to the JSON, and
 * the next `pnpm db:seed:export` quietly undid them. Written down here, the
 * export applies them every time and reports each one in the manifest.
 *
 * Shape, per template id (the directory name under scripts/seed-data):
 *
 * - excludeVendors: slugs or ids of vendors that are test accounts, not demo
 *   stores. Their products and locations drop with them in the audit.
 * - excludeProducts: slugs or ids of test products. They are left out before
 *   the audit, so it drops them from collections and category counts too.
 * - excludeDocuments: { <snapshotKey>: [slug or id, …] } for test documents
 *   nothing else in the snapshot points at (a test vendor plan, say).
 * - settings: { "<dot.path>": value } written into settings.json.
 * - settingsItems: [{ root, id, set }] patches the object carrying `id`
 *   anywhere under settings.<root>. Builder items are addressed by id because
 *   ids survive a reorder and array indexes do not.
 * - documents: { <snapshotKey>: { "<_id>": { when?, set } } } patches one
 *   exported document. `when` limits the patch to the value a test left
 *   behind, so a later deliberate edit in the store still exports.
 *
 * A rule whose target is gone (an id the store deleted) is skipped with a
 * warning in the export output and the manifest, so it gets cleaned up.
 */

/**
 * Fashion demo stock that visitors' test orders ran down: product id →
 * [the count they left, the count to ship]. The old products go back to their
 * 2026-09-17 export; the ones added later go back to their first recorded
 * stock. "Silk marocain shirt" is a home-page pick, and at 0 a fresh install
 * showed it sold out.
 */
const FASHION_STOCK_BEFORE_TEST_ORDERS = {
  "6aa6962c9e1a8ac7a89ff11d": [11, 12], // Embroidered natté fabric dress
  "6aa696ac9e1a8ac7a89ff11f": [20, 22], // Embroidered marocain dress
  "6aa94ad514e6a3473c5cf2b6": [6, 12], // Polka-dot print marocain shirt dress
  "6aa94d7114e6a3473c5cf2bb": [0, 4], // Silk marocain shirt
  "6aaa6ecf2f46abe23f278df6": [34, 35], // Poplin shirt
  "6aaa6fcd2f46abe23f278df7": [34, 35], // Re-Nylon blouson jacket
  "6aaa82442f46abe23f278e00": [39, 40], // Prada Bonnie medium leather bag
  "6aaa85a02f46abe23f278e02": [39, 40], // Prada Route large leather tote bag
  "6aaa87f52f46abe23f278e03": [39, 40], // Prada Corsaire aged leather mini shoulder bag
  "6aaa89502f46abe23f278e04": [39, 40], // Prada Boogie medium leather bag
  "6aaa964f2f46abe23f278e0a": [53, 55], // Prada Explore small nappa leather bag
  "6aaa96f82f46abe23f278e0b": [9, 10], // Brushed leather slingback pumps
  "6aaa97822f46abe23f278e0c": [1, 5], // Short-sleeved ribbed knit wool sweater
  "6aab6fca90a6dfba31d47727": [29, 30], // Leather pumps
  "6aab72b390a6dfba31d47728": [19, 20], // Brushed leather ballerina slingbacks
  "6aab798090a6dfba31d4772e": [19, 20], // Brushed leather pumps
  "6aabad0960c177e8c0c69ce6": [6, 20], // Idylle Blossom Pendant, Rose Gold and Diamonds
  "6aabcae813c31b1b59ea11ab": [10, 20], // Imagination
  "6aabd75aaf46cdbcc4e75c03": [0, 19], // Leather loafers (the third one)
};

/** Afternoon Swim's gallery, front view first, before a visitor swapped it. */
const AFTERNOON_SWIM_FRONT =
  "https://pub-266ab20f55f64e0280c0b46b296882c7.r2.dev/uploads/2026/09/1789632177657-fhbcug/louis-vuitton-afternoon-swim--LP0484_PM2_Front_view.avif";
const AFTERNOON_SWIM_INTERIOR =
  "https://pub-266ab20f55f64e0280c0b46b296882c7.r2.dev/uploads/2026/09/1789632177777-4eem2f/louis-vuitton-afternoon-swim--LP0484_PM1_Interior_view.webp";

/** Footer colours that follow the theme (e5657df3). */
const THEME_FOOTER_COLORS = {
  backgroundColor: "var(--theme-surface-alt)",
  textColor: "var(--theme-text)",
  mutedTextColor: "var(--theme-text-muted)",
  borderColor: "var(--theme-border)",
  accentColor: "var(--theme-primary)",
};

export const EXPORT_RULES = {
  electronics: {
    excludeVendors: [
      // Accounts created while testing on the demo database. None of them
      // sells anything. Two carried isDefault, and "Test Store" has no slug at
      // all, so the seeder would have given it the login undefined@example.com.
      "vendor-test-store",
      "vendor-two-store",
      "6ac899cce98668762b472bff", // "Test Store"
    ],

    excludeDocuments: {
      // A $200 plan created to test plan checkout. The demo sells one plan,
      // "Default".
      vendorPlans: ["max"],
      // A draft collection made while testing automated conditions
      // (title equals "ddd"). It has no products.
      collections: ["my-collection"],
      // A location named by keyboard mashing, made while testing. No product
      // stocks it, so the snapshot has no use for it.
      locations: ["6ad0d7a36b54cc80db377858"],
    },

    settings: {
      // A fresh install follows the theme colours, so a buyer who changes the
      // brand colour gets a footer that changes with it. The demo store keeps
      // its saved hex values; the snapshot does not copy them.
      "footer.colors": {
        light: THEME_FOOTER_COLORS,
        dark: THEME_FOOTER_COLORS,
      },
    },

    settingsItems: [
      {
        // The header's "Categories" button: brand-primary fill with the
        // matching ink, rather than the demo's saved #366FFF and white.
        root: "header.builder",
        id: "2f6195ab-4eae-44cd-b41f-e3b6fabe483a",
        set: {
          background: { type: "solid", color: "var(--theme-primary)" },
          "textStyle.fill": { type: "solid" },
        },
      },
    ],

    documents: {
      blogPosts: {
        // Renamed to "arabic" during a right-to-left test on the demo
        // database. Its SEO title and description, written later, are real
        // and stay.
        "6a9425294c7e1d8b0a785c1f": {
          when: { slug: "arabic" },
          set: {
            title: "Essential Gadgets for Your Home Office",
            slug: "essential-gadgets-for-your-home-office",
          },
        },
      },
      locations: {
        // Named after "Tech Gadgets", a vendor the demo no longer has. A
        // snapshot is imported into somebody else's shop, where that prefix is
        // a stranger's name on their inventory screen.
        "6a907908a8a12b22b27a0c34": {
          when: { name: "Tech Gadgets Store Front" },
          set: { name: "Store Front" },
        },
        "6a907908a8a12b22b27a0c33": {
          when: { name: "Tech Gadgets Warehouse" },
          set: { name: "Warehouse" },
        },
        "6a907908a8a12b22b27a0c35": {
          when: { name: "Tech Gadgets Secondary Storage" },
          set: { name: "Secondary Storage" },
        },
      },
    },
  },

  // The Fashion demo (storify-women-fashion) prints its admin login, so
  // visitors add test data to it.
  "women-fashion": {
    excludeVendors: [
      // "Big0", approved by a visitor. It sells nothing.
      "6aad66b1af46cdbcc4e75f8e",
    ],

    excludeProducts: [
      "6aae729daf46cdbcc4e76175", // "ghjgh"
      "6ab028f6af46cdbcc4e763ff", // "Iphone 16", in a fashion store
    ],

    excludeDocuments: {
      // A visitor's empty category.
      categories: ["6ab3dbb9a5167e0f50a94f7d"], // "First Aid Basics"
      // Visitors' option sets ("w, w, d, w, ss, w"; iPhone storage); no
      // product uses them.
      globalVariants: [
        "6aac2cd9af46cdbcc4e75d52", // "size"
        "6ab026ddaf46cdbcc4e763f2", // "Storage"
        "6ab026fcaf46cdbcc4e763f3", // "Color"
      ],
    },

    settings: {
      // Same as Electronics: a fresh install's footer follows the theme.
      "footer.colors": {
        light: THEME_FOOTER_COLORS,
        dark: THEME_FOOTER_COLORS,
      },
      // The widget's shipped purple, which `db:migrate ai-widget-theme-colors`
      // turns into the theme's primary. The demo store has not run it.
      "aiSalesAgent.widget.primaryColor": "var(--theme-primary)",
      "aiSalesAgent.widget.accentColor": "var(--theme-primary)",
    },

    documents: {
      products: {
        ...Object.fromEntries(
          Object.entries(FASHION_STOCK_BEFORE_TEST_ORDERS).map(([id, [left, ship]]) => [
            id,
            { when: { stock: left }, set: { stock: ship } },
          ]),
        ),
        // Afternoon Swim: a visitor (the demo vendor login) put the interior
        // shot first.
        "6aab9eede257f84cd5e061c3": {
          when: { "images.0": AFTERNOON_SWIM_INTERIOR },
          set: {
            images: [AFTERNOON_SWIM_FRONT, AFTERNOON_SWIM_INTERIOR],
            media: [
              {
                _id: "f949ba4c-24dc-45d9-8721-9f5dce267eb7",
                type: "image",
                url: AFTERNOON_SWIM_FRONT,
                filename: "louis-vuitton-afternoon-swim--LP0484_PM2_Front view.avif",
                alt: "",
                position: 0,
                mimeType: "image/avif",
                fit: "auto",
              },
              {
                _id: "298dab57-1228-4c33-ab6c-a0f92719400c",
                type: "image",
                url: AFTERNOON_SWIM_INTERIOR,
                filename: "louis-vuitton-afternoon-swim--LP0484_PM1_Interior view.webp",
                alt: "",
                position: 1,
                mimeType: "image/webp",
                fit: "auto",
              },
            ],
          },
        },
        // Mustard Brown Hooded Utility Coat Dress: the team listed it as one
        // $329 item. Visitors added size/colour variants (two pairs share a
        // SKU), cut the price, renamed the slug "-prada" and took it off the
        // till. This is the team's last version (2026-09-21), with its stock
        // unsplit: the per-location counts named the visitors' locations.
        "6ab101e410060cae37a54863": {
          when: { slug: "mustard-brown-hooded-utility-coat-dress-prada" },
          set: {
            slug: "mustard-brown-hooded-utility-coat-dress",
            handle: "mustard-brown-hooded-utility-coat-dress",
            price: 329,
            priceRange: { min: 329, max: 329 },
            stock: 10,
            locationInventory: [],
            options: [],
            variants: [],
            publishing: { onlineStore: true, pointOfSale: true },
            seo: {
              pageTitle: "Mustard Brown Hooded Utility Coat Dress",
              metaDescription:
                "Stay effortlessly stylish with this Brown Hooded Longline Jacket , designed with a modern relaxed fit and functional detailing. Featuring a high-neck hooded...",
              handle: "mustard-brown-hooded-utility-coat-dress",
            },
          },
        },
      },
      locations: {
        // Created by visitors testing transfers. The demo's own products are
        // stocked there now, so the locations stay under plain names.
        "6aad90bbaf46cdbcc4e75fb2": {
          when: { name: "MAGASIN 1" },
          set: { name: "Warehouse", address: "" },
        },
        "6aad90bfaf46cdbcc4e75fb3": {
          when: { name: "MAGASIN 2" },
          set: { name: "Store Front" },
        },
        "6ab0283eaf46cdbcc4e763fc": {
          when: { name: "Mobily storer" },
          set: { name: "Secondary Storage" },
        },
      },
    },
  },
};

/** One template's rules; an empty object when it has none. */
export function exportRulesFor(templateId) {
  return EXPORT_RULES[templateId] ?? {};
}
