import {
  CollectionDetailHeader,
  CollectionDetailMain,
} from "@/components/store/sections/collection-detail";
import type { SectionDefinition } from "../types";

/**
 * The collection page split like the category one: locked grid+pagination
 * core, deletable header (banner, description, count, sort). Both read the
 * page's single collection-detail fetch through the resource.
 */

export const collectionHeader: SectionDefinition = {
  type: "collection-header",
  version: 1,
  category: "categories",
  templates: ["collection"],
  maxPerPage: 1,
  resourceType: "collection",
  fields: [],
  Render({ ctx }) {
    const resource = ctx.resource;
    if (resource?.type !== "collection") return null;
    return <CollectionDetailHeader locale={ctx.locale} resource={resource} />;
  },
};

export const collectionMain: SectionDefinition = {
  type: "collection-main",
  version: 1,
  category: "categories",
  templates: ["collection"],
  required: true,
  locked: true,
  maxPerPage: 1,
  resourceType: "collection",
  fields: [],
  Render({ ctx }) {
    const resource = ctx.resource;
    if (resource?.type !== "collection") return null;
    return <CollectionDetailMain locale={ctx.locale} resource={resource} />;
  },
};
