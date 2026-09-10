
export type CategoryNode = {
  _id: string;
  name: string;
  slug: string;
  image?: string;
  icon?: string;
  children: CategoryNode[];
};

export type CollectionItem = {
  _id: string;
  title: string;
  slug: string;
  handle?: string;
  description?: string;
  image?: { url?: string; alt?: string };
};
