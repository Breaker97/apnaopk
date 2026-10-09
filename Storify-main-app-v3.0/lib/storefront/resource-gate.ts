import { notFound } from "next/navigation";
import type { ReactNode } from "react";

type ResourceGateProps = {
  children: ReactNode;
  params: Promise<{ slug: string }>;
};

/**
 * The layout of a storefront detail route — a product, category, collection,
 * brand or seller page — that answers 404 for a slug the storefront does not
 * show.
 *
 * The page's own `notFound()` comes too late for a status: the route's
 * `loading.tsx` wraps the page in a Suspense boundary, so the store's header
 * has already streamed with a 200 by the time the page learns there is
 * nothing to show. Next can then only add `<meta name="robots"
 * content="noindex">`, and search engines are told the missing page is an
 * empty one. A layout renders above that boundary, so the answer is known
 * before anything is sent.
 *
 * `isShown` is the page's own cached read where it takes only the slug (the
 * page then finds it warm), or a slug-only question asked with the page
 * loader's rule. The page keeps its `notFound()` for the moment the two
 * disagree, a cache entry expiring between them.
 */
export function storefrontResourceGate(
  isShown: (slug: string) => Promise<unknown>,
) {
  return async function StorefrontResourceGate({
    children,
    params,
  }: ResourceGateProps) {
    const { slug } = await params;
    if (!(await isShown(slug))) notFound();
    return children;
  };
}
