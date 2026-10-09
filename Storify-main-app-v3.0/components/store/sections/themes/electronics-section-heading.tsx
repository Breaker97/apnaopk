import { cn } from "@/lib/utils";

/**
 * Electronics' section heading: centred, with ONE word carrying the weight
 * — "Shop by **Categories**", "Best **Selling**", "**Compare** Products".
 *
 * One title string goes in and the two-tone treatment comes out, so the
 * merchant never has to split their copy across two fields and the same
 * stored content reads correctly under every other theme too.
 *
 * Single-word titles and scripts that do not space their words render whole
 * and bold: half a CJK title in a lighter weight would be an accident
 * rather than a design.
 */
export function ElectronicsSectionHeading({
  title,
  className,
  emphasis = "last",
  restStyle = "faded",
  as: Tag = "h2",
}: {
  title: string;
  className?: string;
  /**
   * Which end of the title carries the gradient. The home page's section
   * headings lead up to it ("Best **Selling**"); the page titles put it
   * first ("**Compare** Products"); the products page leads INTO it with one
   * plain word ("Shop **All Products**" — "tail" splits at the first space
   * and emphasises the remainder), so all three frames of the design are
   * reachable without splitting the copy or forking this component.
   */
  emphasis?: "first" | "last" | "tail";
  /**
   * How the words beside the gradient read. Section headings fade them
   * ("Best **Selling**" recedes through colour); the categories index keeps
   * them plain ink at regular weight ("All **Categories**"), so both frames
   * of the design come from the one component.
   */
  restStyle?: "faded" | "plain";
  /** Page titles are the document's h1; section headings stay h2. "span"
   * lets a row heading nest the treatment inside its own h2 (e.g. a title
   * that carries an inline subtitle beside it). */
  as?: "h1" | "h2" | "span";
}) {
  const trimmed = title.trim();
  if (!trimmed) return null;

  const split =
    emphasis === "last" ? trimmed.lastIndexOf(" ") : trimmed.indexOf(" ");
  const hasTwoParts = split > 0;
  const emphasised = !hasTwoParts
    ? trimmed
    : emphasis === "first"
      ? trimmed.slice(0, split)
      : trimmed.slice(split + 1);
  const rest = !hasTwoParts
    ? ""
    : emphasis === "first"
      ? trimmed.slice(split + 1)
      : trimmed.slice(0, split);

  // The design's signature: the emphasised word fades through a
  // left-to-right gradient. Token-based so it holds in both themes.
  const emphasisNode = (
    <span className="bg-gradient-to-r from-foreground to-foreground/35 bg-clip-text text-transparent">
      {emphasised}
    </span>
  );
  // Faded rest stays bold — it recedes through colour, not weight. Plain
  // rest holds full ink and drops to regular weight instead.
  const restNode = rest ? (
    restStyle === "plain" ? (
      <span className="font-normal text-foreground">{rest}</span>
    ) : (
      <span className="text-foreground/35">{rest}</span>
    )
  ) : null;

  return (
    <Tag
      className={cn(
        // 28px / -0.03em in the design, stepped down on small screens.
        "text-center text-[length:var(--sec-title,22px)] font-bold tracking-[-0.03em] sm:text-[length:var(--sec-title-lg,28px)]",
        className,
      )}
    >
      {emphasis === "first" ? (
        <>
          {emphasisNode}
          {restNode ? <> {restNode}</> : null}
        </>
      ) : (
        <>
          {restNode ? <>{restNode} </> : null}
          {emphasisNode}
        </>
      )}
    </Tag>
  );
}
