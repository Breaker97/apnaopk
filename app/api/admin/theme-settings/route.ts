import { schemeDiagnostics } from "@/lib/theme-colors/diagnostics";
import { sectionVersion } from "@/lib/settings/section-versions";
import { connectDB } from "@/lib/db";
import { withApi } from '@/lib/api/handler';
import { successResponse } from '@/lib/api/response';
import { ConflictError, ValidationError } from '@/lib/api/errors';
import { audit, createAuditContext } from '@/lib/audit';
import { revalidateSettingsContent } from '@/lib/cache-invalidation';
import { getActiveThemeManifest, getThemeDefaults } from '@/lib/storefront/themes/registry';
import { adoptThemeKeyColors, migrateLegacyThemeSettings, normalizeThemeTokens, storedThemeColors } from '@/lib/storefront/themes/tokens';
import { adoptionUpdates, keyColorMirror } from '@/lib/storefront/themes/key-colors';
import { canonicalizeThemeColors, resolveThemeSchemes } from '@/lib/storefront/themes/compile';
import { resolveBrand } from '@/lib/branding/brand';
import { loadSettingsDocument, Settings } from '@/models/settings.model';
import { pickBrand } from '@/lib/theme-colors/brand';
import { assertScope, brandWriteGuard, capturePath, normalizeBrandPatch, themeScopeVersions, validateThemeColorInput } from '@/lib/theme-colors/settings-write';
import { validateBody } from '@/lib/api/validate';
import { isRecord } from '@/lib/utils';
import * as z from 'zod';
const Body = z.object({themeId:z.string().min(1).optional(),values:z.unknown().optional(),brandPatch:z.unknown().optional(),expected:z.object({themeValues:z.string().optional(),brandColors:z.string().optional()}).optional()}).strict();
function snapshot(settings: Awaited<ReturnType<typeof loadSettingsDocument>>) {
  const manifest=getActiveThemeManifest(settings.onlineStore?.activeTheme);
  const raw=settings.onlineStore?.themeSettings?.[manifest.id];
  const brandColors=resolveBrand(settings).colors;
  // A theme still following the one store-wide brand is shown adopted: its
  // key colours are its own from the first save on (adoptThemeKeyColors).
  const values=adoptThemeKeyColors(normalizeThemeTokens(getThemeDefaults(manifest),raw),brandColors);
  const brand=pickBrand(settings.appearance);
  const schemes=resolveThemeSchemes(values,brandColors);
  const plain=settings.toObject({flattenMaps:true});
  return {theme:manifest.id,values,brand,versions:themeScopeVersions(raw,settings.appearance),appearanceVersion:sectionVersion(plain.appearance),appearanceSnapshot:plain.appearance,schemes,diagnostics:{light:schemeDiagnostics(schemes.light),dark:schemeDiagnostics(schemes.dark)}};
}
export const GET=withApi({auth:'admin'},async()=>{await connectDB();return successResponse(snapshot(await loadSettingsDocument()));});
export const PATCH=withApi({auth:'admin',demo:'block-mutations',rateLimit:{action:'admin:theme-settings:save'}},async({request,session})=>{
  const body=await validateBody(request,Body);
  if (body.values === undefined && body.brandPatch === undefined) throw new ValidationError('Provide theme values or brand colors');
  await connectDB();
  const captured = await Settings.collection.findOne({});
  const settings=await loadSettingsDocument();
  const before=captured ?? settings.toObject({flattenMaps:true});
  const manifest=getActiveThemeManifest(settings.onlineStore?.activeTheme);
  // Theme values belong to the theme they were edited for; the brand is
  // global, so a brand-only save still goes through after a theme switch.
  if (body.values !== undefined && body.themeId && body.themeId !== manifest.id) throw new ConflictError('The active theme changed. Reopen its editor.');
  const path=`onlineStore.themeSettings.${manifest.id}`;
  const raw=settings.onlineStore?.themeSettings?.[manifest.id];
  const versions=themeScopeVersions(raw,settings.appearance);
  const brandPatch=body.brandPatch === undefined ? undefined : normalizeBrandPatch(body.brandPatch);
  // The brand's colours ARE the live theme's key colours now, mirrored below
  // (keyColorMirror); a patch carries only the palette library. An older tab
  // that still sends colours must not overwrite the mirror.
  if (brandPatch) for (const key of ['primaryColor','secondaryColor','accentColor','skeletonColor']) delete brandPatch[key];
  const filter: Record<string,unknown>={_id:settings._id,'onlineStore.activeTheme':capturePath(before,'onlineStore.activeTheme')};
  const updates: Record<string,unknown>={};
  if (body.values !== undefined) {
    if (body.themeId && !body.expected?.themeValues) throw new ValidationError("Missing theme version");
    assertScope(versions.themeValues,body.expected?.themeValues);
    validateThemeColorInput(body.values);
    // Old clients know only the original roles; merge before normalizing so advanced roles survive.
    const brandBefore=resolveBrand(settings).colors;
    let previous;
    try { previous=adoptThemeKeyColors(normalizeThemeTokens(getThemeDefaults(manifest),raw,{strict:true}),brandBefore); }
    catch { throw new ConflictError('These theme colors were saved by a newer version of the editor. Update the app before changing them.'); }
    const incoming=isRecord(body.values)?migrateLegacyThemeSettings(body.values):{};
    const colors=isRecord(incoming.colors)?incoming.colors:{};
    const merged={...previous,...incoming,colors:{...previous.colors,...colors,light:{...previous.colors.light,...(isRecord(colors.light)?colors.light:{})},dark:{...previous.colors.dark,...(isRecord(colors.dark)?colors.dark:{})}}};
    // The brand this save leaves behind: the patch over the stored colours,
    // resolved like every reader resolves it (a missing or cleared colour is
    // the shipped default, never the text "undefined").
    const brandAfter=resolveBrand({appearance:{...settings.toObject({flattenMaps:true}).appearance,...(brandPatch ?? {})}}).colors;
    // Adopted again in case an older tab sent schema-3 colours naming the brand.
    const values=adoptThemeKeyColors(canonicalizeThemeColors(normalizeThemeTokens(getThemeDefaults(manifest),merged,{strict:true}),previous,brandAfter),brandBefore);
    updates[path]=storedThemeColors(values,getThemeDefaults(manifest));
    filter[path]=capturePath(before,path);
    // Every other theme still following the store-wide brand gets its own copy
    // in this same write, so this theme's new colours never reach them.
    Object.assign(updates,adoptionUpdates((before as {onlineStore?:unknown}).onlineStore,brandBefore,{except:manifest.id}));
    // The live theme's key colours, mirrored for the dashboards, emails and apps.
    Object.assign(updates,keyColorMirror(values,brandBefore));
  }
  if (body.brandPatch !== undefined) {
    if (body.themeId && !body.expected?.brandColors) throw new ValidationError("Missing brand version");
    assertScope(versions.brandColors,body.expected?.brandColors);
    const patch=brandPatch! as Record<string,unknown>;
    if (Object.keys(patch).length === 0 && body.values === undefined) throw new ValidationError("Provide at least one brand color field");
    Object.assign(filter,brandWriteGuard(before));
    for (const [key,value] of Object.entries(patch)) updates[`appearance.${key}`]=value;
  }
  const committed=await Settings.findOneAndUpdate(filter,{$set:updates},{runValidators:true,returnDocument:"after"});
  if (!committed) throw new ConflictError('These settings changed during the save. Your draft has been kept.');
  const warnings:string[]=[];
  try { revalidateSettingsContent(); } catch {warnings.push('Saved, but storefront cache refresh failed.');}
  try {await audit(createAuditContext(request,session),{action:'UPDATE',resource:'settings',resourceId:'theme-settings',resourceName:manifest.id,changes:{summary:`Updated ${manifest.id} theme colors and settings`}});} catch {warnings.push('Saved, but audit logging failed.');}
  return successResponse({...snapshot(committed),warnings});
});
