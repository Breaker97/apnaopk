/**
 * Shapes shared by the admin reviews page, its data table, the reply dialog
 * and the stats card. Kept in `lib/` so no component has to import a type
 * from a page or from a sibling that imports it back (the cycles madge flagged).
 */
export interface ReviewProductRef {
  _id: string;
  name?: string;
  slug?: string;
  images?: string[];
}

export interface ReviewUserRef {
  _id: string;
  name?: string;
  email?: string;
  image?: string;
  customerProfileId?: string;
}

interface ReviewReplyData {
  comment: string;
  userId?: string | ReviewUserRef;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminReview {
  _id: string;
  rating: number;
  title?: string;
  comment: string;
  images?: string[];
  isVerified: boolean;
  isApproved: boolean;
  reply?: ReviewReplyData;
  createdAt: string;
  productId?: string | ReviewProductRef;
  userId?: string | ReviewUserRef;
}

export interface ReviewsStats {
  average: number;
  total: number;
  published: number;
  onHold: number;
  weekDelta: number;
  breakdown: { 5: number; 4: number; 3: number; 2: number; 1: number };
}
