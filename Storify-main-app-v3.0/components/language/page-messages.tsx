import type { ReactNode } from "react";
import { getMessages } from "next-intl/server";
import { MergedMessagesProvider } from "@/components/language/merged-messages-provider";
import {
  pickPageMessages,
  type PageScopedPath,
} from "@/lib/i18n/surface-messages";

/**
 * Adds the sub-trees only one page renders (`PAGE_SCOPED_PATHS`) to the
 * messages its route provides. The page sends just those sub-trees; the
 * browser merges them in.
 *
 * Its own module, apart from `RouteMessages`: the client provider it renders
 * joins the bundle of every route that imports the module, used or not.
 */
export async function PageMessages({
  paths,
  children,
}: {
  paths: readonly PageScopedPath[];
  children: ReactNode;
}) {
  return (
    <MergedMessagesProvider messages={pickPageMessages(await getMessages(), paths)}>
      {children}
    </MergedMessagesProvider>
  );
}
