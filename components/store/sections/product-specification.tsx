import { ElectronicsSectionHeading } from "./themes/electronics-section-heading";

export interface ProductSpecificationRow {
  name: string;
  value: string;
}

/**
 * The product's merchant-entered specification table, as a page section
 * (Figma 829-2420): a left-aligned two-tone heading over hairline rows —
 * bold label on the start edge, the value in its own column so a long one
 * (a build description, a list of SIM options) wraps without pushing the
 * label around.
 */
export function ProductSpecification({
  title,
  rows,
}: {
  title: string;
  rows: ProductSpecificationRow[];
}) {
  if (rows.length === 0) return null;

  return (
    // `id`/`data-section`: the sticky product bar's tabs and the scroll
    // spy in ProductDetails target this by id once the table lives out
    // here instead of inside the product-main tabs.
    <section
      id="specifications"
      data-section="specifications"
      className="container mx-auto scroll-mt-24 px-4 py-8 lg:py-12"
    >
      <ElectronicsSectionHeading
        title={title}
        className="mb-6 text-left text-xl sm:text-2xl"
      />

      <dl className="divide-y divide-border border-t border-border">
        {rows.map((row, index) => (
          <div
            key={`${row.name}-${index}`}
            className="grid gap-1 py-4 sm:grid-cols-[minmax(160px,240px)_1fr] sm:gap-6"
          >
            <dt className="text-sm font-semibold text-foreground">
              {row.name}
            </dt>
            {/* `whitespace-pre-line` keeps a merchant's line breaks — spec
                values are routinely written as short lists. */}
            <dd className="whitespace-pre-line text-sm leading-relaxed text-foreground/80">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
