/**
 * The integrity pass every catalog snapshot goes through on its way out.
 *
 * A live demo store accumulates state a fresh install cannot inherit: vendors
 * get deleted and leave their inventory locations behind, a second store picks
 * up the `isDefault` flag, sliders are created and never bound to a section,
 * a landing page is started and abandoned. Exported verbatim, each of those
 * becomes a defect in every store seeded from the file — and the seeder is the
 * worst place to discover it, because by then the ids are already in a
 * database somebody is looking at.
 *
 * So the export refuses to write a snapshot it cannot vouch for. Everything
 * here is a PURE function over plain arrays (`tests/seed-snapshots.test.ts` pins
 * the rules without a database): `auditSnapshot` returns repaired collections,
 * a log of what it changed, and a list of faults it will not paper over.
 *
 * Two rules are worth stating out loud because they are invariants of the app
 * rather than tidiness:
 *
 * - ONE default vendor. `Vendor.userId` is unique and `createVendors` gives
 *   every `isDefault` vendor the same demo login, so a snapshot with two of
 *   them cannot be seeded at all — the second insert dies on a duplicate key.
 *   Runtime agrees: `findDefaultVendorIdReadOnly()` resolves the house store
 *   by the canonical slug precisely because the flag is not unique.
 * - Collection membership is stored TWICE, on purpose. `Collection.products`
 *   renders the collection page; `product.collectionIds` answers the
 *   storefront `?collection=` filter and the section grids. `syncProductCollections`
 *   keeps them mirrored at runtime, so a snapshot where they disagree ships a
 *   collection whose page and whose filter show different products.
 */

const S = (value) => (value == null ? null : String(value));

const isMoney = (value) => typeof value === "number" && Number.isFinite(value);

function idSet(docs) {
  return new Set(docs.map((doc) => S(doc._id)));
}

/**
 * Recompute `priceRange`/`compareAtPriceRange` the way the Product model's
 * `syncProductAggregates()` does, so a snapshot can never carry the stale
 * ranges a `findOneAndUpdate` write path leaves behind. The storefront prints
 * these directly — a wrong range is a wrong price on the card.
 */
export function derivePriceRanges(product) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (variants.length > 0) {
    const prices = variants.map((v) => v.price).filter(isMoney);
    const compares = variants
      .map((v) => v.comparePrice)
      .filter((p) => isMoney(p) && p > 0);
    return {
      priceRange:
        prices.length > 0
          ? { min: Math.min(...prices), max: Math.max(...prices) }
          : null,
      compareAtPriceRange:
        compares.length > 0
          ? { min: Math.min(...compares), max: Math.max(...compares) }
          : null,
    };
  }
  return {
    priceRange: isMoney(product.price)
      ? { min: product.price, max: product.price }
      : null,
    compareAtPriceRange:
      isMoney(product.comparePrice) && product.comparePrice > 0
        ? { min: product.comparePrice, max: product.comparePrice }
        : null,
  };
}

function rangesEqual(a, b) {
  if (!a || !b) return a === b || (!a && !b);
  return a.min === b.min && a.max === b.max;
}

/**
 * Pick the one vendor that owns the house store. The canonical slug wins over
 * the flag for the same reason `findDefaultVendorIdReadOnly()` prefers it: the
 * slug is the identifier only the house store can hold, while the flag is not
 * unique and demonstrably ends up on more than one document.
 */
export function pickDefaultVendor(vendors, defaultVendorSlug) {
  if (vendors.length === 0) return null;
  const bySlug = vendors.find(
    (vendor) => String(vendor.slug || "").toLowerCase() === defaultVendorSlug,
  );
  if (bySlug) return bySlug;
  const flagged = vendors.filter((vendor) => vendor.isDefault === true);
  if (flagged.length > 0) {
    // Oldest first, so repeated exports of the same store agree with each other.
    return flagged
      .slice()
      .sort((a, b) => String(a._id).localeCompare(String(b._id)))[0];
  }
  return null;
}

/** Walk every section of every exported page, draft and published alike. */
function eachSection(storePages, visit) {
  for (const page of storePages) {
    for (const state of [page.draft, page.published]) {
      for (const section of state?.sections ?? []) visit(section, page);
    }
  }
}

/** Every slider handle an exported store page binds, draft and published. */
export function boundSliderHandles(storePages) {
  const handles = new Set();
  eachSection(storePages, (section) => {
    for (const block of section?.blocks ?? []) {
      const handle = block?.settings?.slider;
      if (typeof handle === "string" && handle) handles.add(handle);
    }
  });
  return handles;
}

/**
 * Every discount code a `coupon-banner` section advertises, upper-cased the
 * way `Coupon.code` stores it. The banner falls back to the merchant's own
 * copy when the code resolves to nothing, so a missing coupon is not a crash
 * — it is worse: a storefront advertising a code checkout has never heard of.
 */
export function referencedCouponCodes(storePages) {
  const codes = new Set();
  eachSection(storePages, (section) => {
    if (section?.type !== "coupon-banner") return;
    const code = section?.settings?.code;
    if (typeof code === "string" && code.trim()) {
      codes.add(code.trim().toUpperCase());
    }
  });
  return codes;
}

/**
 * A prefix every location shares is a store BRAND, not a place name.
 *
 * The demo's warehouses came out named "Tech Gadgets Warehouse", "Tech Gadgets
 * Store Front" — after a vendor the store no longer has. A snapshot is
 * imported into somebody else's shop, so that prefix is someone else's name on
 * the buyer's inventory screen. Stripping the SHARED words keeps what actually
 * distinguishes each place ("Warehouse", "Store Front") and drops what only
 * identified the store they used to belong to.
 *
 * Needs two or more locations to have evidence of a shared prefix at all, and
 * never strips a name down to nothing.
 */
export function stripSharedLocationPrefix(names) {
  if (names.length < 2) return names;
  const split = names.map((name) => String(name).trim().split(/\s+/));
  let shared = 0;
  while (shared < split[0].length - 1) {
    const word = split[0][shared];
    const everyone = split.every(
      (words) => words.length > shared + 1 && words[shared] === word,
    );
    if (!everyone) break;
    shared += 1;
  }
  if (shared === 0) return names;
  return split.map((words) => words.slice(shared).join(" "));
}

function pageHasContent(page) {
  const sections = (state) =>
    Array.isArray(state?.sections) ? state.sections.length : 0;
  return sections(page.published) > 0 || sections(page.draft) > 0;
}

/**
 * Repair a snapshot in place-ish (documents are mutated; the arrays returned
 * are new) and report every change and every unfixable fault.
 *
 * @returns {{ data: object, repairs: string[], errors: string[] }}
 */
export function auditSnapshot(input, { defaultVendorSlug = "main-store" } = {}) {
  const repairs = [];
  const errors = [];
  const note = (message) => repairs.push(message);

  const vendors = [...(input.vendors ?? [])];
  const categories = [...(input.categories ?? [])];
  const brands = [...(input.brands ?? [])];
  const globalVariants = [...(input.globalVariants ?? [])];
  const collections = [...(input.collections ?? [])];
  const blogCategories = [...(input.blogCategories ?? [])];
  const blogPosts = [...(input.blogPosts ?? [])];
  const menus = [...(input.menus ?? [])];
  const vendorPlans = [...(input.vendorPlans ?? [])];
  let locations = [...(input.locations ?? [])];
  let products = [...(input.products ?? [])];
  let sliders = [...(input.sliders ?? [])];
  let storePages = [...(input.storePages ?? [])];
  let coupons = [...(input.coupons ?? [])];

  // ---- Vendors: exactly one default ------------------------------------
  if (vendors.length === 0) {
    errors.push("No approved vendors to export — the catalog would have no owner.");
  }
  const houseVendor = pickDefaultVendor(vendors, defaultVendorSlug);
  if (vendors.length > 0 && !houseVendor) {
    errors.push(
      `No default vendor: no store has slug "${defaultVendorSlug}" and none carries isDefault. ` +
        "Seeded products would have no house store to belong to.",
    );
  }
  for (const vendor of vendors) {
    const shouldBeDefault = houseVendor != null && vendor === houseVendor;
    if (Boolean(vendor.isDefault) !== shouldBeDefault) {
      note(
        `vendor "${vendor.slug}": isDefault ${vendor.isDefault === true} → ${shouldBeDefault}` +
          (shouldBeDefault ? " (canonical house store)" : ""),
      );
      vendor.isDefault = shouldBeDefault;
    }
  }
  const vendorIds = idSet(vendors);

  // ---- Inventory locations: must belong to an exported vendor ----------
  const keptLocations = locations.filter((location) =>
    vendorIds.has(S(location.vendorId)),
  );
  for (const dropped of locations.filter((l) => !keptLocations.includes(l))) {
    note(
      `dropped inventory location "${dropped.name}" — its vendor ${S(dropped.vendorId)} no longer exists`,
    );
  }
  locations = keptLocations;
  const locationIds = idSet(locations);

  // ---- Products: every reference must resolve --------------------------
  const keptProducts = products.filter((product) =>
    vendorIds.has(S(product.vendorId)),
  );
  for (const dropped of products.filter((p) => !keptProducts.includes(p))) {
    note(
      `dropped product "${dropped.slug}" — its vendor ${S(dropped.vendorId)} is not exported`,
    );
  }
  products = keptProducts;
  const productIds = idSet(products);
  const categoryIds = idSet(categories);
  const brandIds = idSet(brands);
  const collectionIds = idSet(collections);

  for (const product of products) {
    if (product.category && !categoryIds.has(S(product.category))) {
      note(`product "${product.slug}": cleared missing category ${S(product.category)}`);
      product.category = null;
    }
    if (product.brand && !brandIds.has(S(product.brand))) {
      note(`product "${product.slug}": cleared missing brand ${S(product.brand)}`);
      product.brand = null;
    }
    if (Array.isArray(product.collectionIds)) {
      const kept = product.collectionIds.filter((id) =>
        collectionIds.has(S(id)),
      );
      if (kept.length !== product.collectionIds.length) {
        note(
          `product "${product.slug}": dropped ${product.collectionIds.length - kept.length} missing collection reference(s)`,
        );
        product.collectionIds = kept;
      }
    }

    // Per-location counts that name a location this snapshot no longer has
    // would show the merchant stock at a warehouse that does not exist.
    const pruneInventory = (rows, label) => {
      if (!Array.isArray(rows)) return rows;
      const kept = rows.filter(
        (row) => !row?.locationId || locationIds.has(S(row.locationId)),
      );
      if (kept.length !== rows.length) {
        note(
          `product "${product.slug}"${label}: dropped ${rows.length - kept.length} inventory row(s) at missing locations`,
        );
      }
      return kept;
    };
    product.locationInventory = pruneInventory(product.locationInventory, "");
    for (const variant of product.variants ?? []) {
      variant.locationInventory = pruneInventory(
        variant.locationInventory,
        ` variant "${variant.sku}"`,
      );
    }

    // Derived money fields, recomputed the way the model does.
    const derived = derivePriceRanges(product);
    if (!rangesEqual(product.priceRange ?? null, derived.priceRange)) {
      note(
        `product "${product.slug}": priceRange ${JSON.stringify(product.priceRange ?? null)} → ${JSON.stringify(derived.priceRange)}`,
      );
      if (derived.priceRange) product.priceRange = derived.priceRange;
      else delete product.priceRange;
    }
    if (
      !rangesEqual(
        product.compareAtPriceRange ?? null,
        derived.compareAtPriceRange,
      )
    ) {
      note(
        `product "${product.slug}": compareAtPriceRange ${JSON.stringify(product.compareAtPriceRange ?? null)} → ${JSON.stringify(derived.compareAtPriceRange)}`,
      );
      if (derived.compareAtPriceRange) {
        product.compareAtPriceRange = derived.compareAtPriceRange;
      } else {
        delete product.compareAtPriceRange;
      }
    }
  }

  // ---- Locations, second pass: only places that do something -----------
  // A location no product stocks is an empty room on the buyer's inventory
  // screen — the same reasoning that drops a slider no section binds.
  //
  // Two exemptions, both load-bearing rather than tidy: the DEFAULT location
  // is where new stock lands, so a store keeps one before anything is counted
  // into it; and a PICKUP point is a collection address the storefront measures
  // "near me" against, which is a feature the demo exists to show — it earns
  // its place by being reachable, not by holding units.
  const stockedLocations = new Set();
  for (const product of products) {
    const rows = [
      ...(product.locationInventory ?? []),
      ...(product.variants ?? []).flatMap(
        (variant) => variant.locationInventory ?? [],
      ),
    ];
    for (const row of rows) {
      if (row?.locationId) stockedLocations.add(S(row.locationId));
    }
  }
  const usedLocations = locations.filter(
    (location) =>
      location.isDefault === true ||
      location.pickupEnabled === true ||
      stockedLocations.has(S(location._id)),
  );
  for (const dropped of locations.filter((l) => !usedLocations.includes(l))) {
    note(`dropped inventory location "${dropped.name}" — no product stocks it`);
  }
  locations = usedLocations;

  const strippedNames = stripSharedLocationPrefix(
    locations.map((location) => location.name),
  );
  locations.forEach((location, index) => {
    if (strippedNames[index] !== location.name) {
      note(
        `inventory location "${location.name}" → "${strippedNames[index]}" (shared store prefix)`,
      );
      location.name = strippedNames[index];
    }
  });

  // ---- Categories: no orphan parents -----------------------------------
  for (const category of categories) {
    if (category.parent && !categoryIds.has(S(category.parent))) {
      note(`category "${category.slug}": cleared missing parent ${S(category.parent)}`);
      category.parent = null;
    }
  }

  // ---- Brands: an owner vendor that is gone would dangle ---------------
  for (const brand of brands) {
    if (brand.ownerVendorId && !vendorIds.has(S(brand.ownerVendorId))) {
      note(`brand "${brand.name}": cleared missing owner vendor`);
      brand.ownerVendorId = null;
    }
  }

  // ---- Collections: mirrored membership, honest counts ------------------
  for (const collection of collections) {
    const cid = S(collection._id);
    if (Array.isArray(collection.products)) {
      const kept = collection.products.filter((id) => productIds.has(S(id)));
      if (kept.length !== collection.products.length) {
        note(
          `collection "${collection.slug}": dropped ${collection.products.length - kept.length} missing product reference(s)`,
        );
      }
      collection.products = kept;
    }

    if (collection.collectionType === "manual") {
      // Mirror the two stores of membership onto each other. A product that
      // lists the collection but is missing from the collection's own array
      // (or vice versa) renders in the filter and not on the page.
      const listed = new Set((collection.products ?? []).map(S));
      const claiming = new Set(
        products
          .filter((product) =>
            (product.collectionIds ?? []).some((id) => S(id) === cid),
          )
          .map((product) => S(product._id)),
      );
      for (const productId of listed) {
        if (!claiming.has(productId)) {
          const product = products.find((p) => S(p._id) === productId);
          product.collectionIds = [...(product.collectionIds ?? []), collection._id];
          note(
            `collection "${collection.slug}" ↔ product "${product.slug}": added missing collectionIds back-reference`,
          );
        }
      }
      for (const productId of claiming) {
        if (!listed.has(productId)) {
          collection.products = [...(collection.products ?? []), productId];
          const product = products.find((p) => S(p._id) === productId);
          note(
            `collection "${collection.slug}" ↔ product "${product.slug}": added missing products entry`,
          );
        }
      }
      const count = (collection.products ?? []).length;
      if (collection.productCount !== count) {
        note(
          `collection "${collection.slug}": productCount ${collection.productCount} → ${count}`,
        );
        collection.productCount = count;
      }
    }
  }

  // ---- Store pages: no abandoned drafts, no local authorship -----------
  const keptPages = storePages.filter(
    (page) => page.kind !== "landing" || pageHasContent(page),
  );
  for (const dropped of storePages.filter((p) => !keptPages.includes(p))) {
    note(`dropped empty landing page "${dropped.key}" — it has no sections`);
  }
  storePages = keptPages;
  for (const page of storePages) {
    // Version history is per-install working data and by far the heaviest
    // part of the document; authorship is stamped at seed time.
    page.history = [];
    if (page.draft) page.draft.updatedBy = null;
    if (page.published) page.published.publishedBy = null;
  }

  // ---- Sliders: only the ones a page actually binds ---------------------
  const bound = boundSliderHandles(storePages);
  const keptSliders = sliders.filter((slider) => bound.has(slider.handle));
  for (const dropped of sliders.filter((s) => !keptSliders.includes(s))) {
    note(
      `dropped slider "${dropped.name}" (${dropped.handle}) — no exported page binds it`,
    );
  }
  sliders = keptSliders;
  for (const handle of bound) {
    if (!sliders.some((slider) => slider.handle === handle)) {
      errors.push(
        `A store page binds slider "${handle}", which does not exist — the hero would render empty.`,
      );
    }
  }

  // ---- Coupons: the ones the storefront advertises, and only those ------
  const advertised = referencedCouponCodes(storePages);
  const keptCoupons = coupons.filter((coupon) =>
    advertised.has(String(coupon.code || "").toUpperCase()),
  );
  for (const dropped of coupons.filter((c) => !keptCoupons.includes(c))) {
    note(`dropped coupon "${dropped.code}" — no exported page advertises it`);
  }
  coupons = keptCoupons;
  for (const code of advertised) {
    if (!coupons.some((coupon) => String(coupon.code).toUpperCase() === code)) {
      errors.push(
        `A coupon-banner advertises "${code}", which no coupon defines — ` +
          "the storefront would offer a code checkout rejects.",
      );
    }
  }
  for (const coupon of coupons) {
    // Usage is per-store; a seeded copy starts at zero or it can arrive
    // already exhausted against its own usage limit.
    if (coupon.usedCount) {
      note(`coupon "${coupon.code}": usedCount ${coupon.usedCount} → 0`);
      coupon.usedCount = 0;
    }
    for (const [field, known, label] of [
      ["applicableCategories", categoryIds, "categor(y/ies)"],
      ["applicableProducts", productIds, "product(s)"],
    ]) {
      if (!Array.isArray(coupon[field])) continue;
      const kept = coupon[field].filter((id) => known.has(S(id)));
      if (kept.length !== coupon[field].length) {
        note(
          `coupon "${coupon.code}": dropped ${coupon[field].length - kept.length} missing ${label}`,
        );
        coupon[field] = kept;
      }
    }
  }

  // ---- Blog: posts must have a category that exists ---------------------
  const blogCategoryIds = idSet(blogCategories);
  for (const post of blogPosts) {
    if (Array.isArray(post.categories)) {
      const kept = post.categories.filter((id) => blogCategoryIds.has(S(id)));
      if (kept.length !== post.categories.length) {
        note(
          `blog post "${post.slug}": dropped ${post.categories.length - kept.length} missing categor(y/ies)`,
        );
        post.categories = kept;
      }
    }
    if (post.category && !blogCategoryIds.has(S(post.category))) {
      note(`blog post "${post.slug}": cleared missing category`);
      post.category = null;
    }
  }

  // ---- Menus: category links must point at a category that exists ------
  // Menu items link by URL, so a stale `?category=<slug>` is not a dangling
  // id — it is a live link to an empty results page, which is worse.
  const categorySlugs = new Set(categories.map((category) => category.slug));
  const walkMenu = (items, menuName) => {
    for (const item of items ?? []) {
      const url = typeof item.url === "string" ? item.url : "";
      const match = url.match(/[?&]category=([^&]+)/);
      if (match && !categorySlugs.has(decodeURIComponent(match[1]))) {
        errors.push(
          `menu "${menuName}" links to /products?category=${match[1]}, which no exported category has.`,
        );
      }
      walkMenu(item.children, menuName);
    }
  };
  for (const menu of menus) walkMenu(menu.items, menu.name || menu.handle);

  return {
    data: {
      vendors,
      locations,
      categories,
      brands,
      globalVariants,
      products,
      collections,
      menus,
      sliders,
      storePages,
      coupons,
      blogCategories,
      blogPosts,
      vendorPlans,
    },
    repairs,
    errors,
  };
}
