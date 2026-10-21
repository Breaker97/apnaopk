/**
 * Where a Campaign Banner screen reads and writes, and where its links go.
 * The admin, the staff area and a vendor's dashboard mount the same table and
 * the same form; only this differs between them.
 */
export interface CampaignBannerScope {
  /** `/api/admin/campaign-banners` or `/api/vendor/campaign-banners`. */
  apiBase: string;
  /** The list page; "new" and "<id>/edit" hang off it. */
  basePath: string;
  /** False shows the screens read-only. */
  canEdit: boolean;
  /** A vendor's banners: no signup form, links stay on the store. */
  vendor: boolean;
}

export const newBannerHref = (scope: CampaignBannerScope) =>
  `${scope.basePath}/new`;

export const editBannerHref = (scope: CampaignBannerScope, id: string) =>
  `${scope.basePath}/${id}/edit`;
