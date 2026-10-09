import type { ReturnListQuery } from '@/contracts/mobile/biz/v1/returns';
import { OPEN_RETURN_STATUSES } from '@/lib/returns/returns';

/** Home and the native Open queue use the same store-owned status set. */
export function returnQueueStateFilter(tab: ReturnListQuery['tab']): Record<string, unknown> | null {
  if (tab === 'open') return { status: { $in: OPEN_RETURN_STATUSES } };
  if (tab === 'completed') return { status: { $nin: OPEN_RETURN_STATUSES }, refundStatus: { $nin: ['processing', 'manual_required'] } };
  if (tab === 'pending') return { refundStatus: { $in: ['pending', 'processing', 'manual_required', 'failed'] }, status: { $nin: ['rejected', 'cancelled', 'closed'] } };
  return null;
}
