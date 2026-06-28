import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/services/mit-registry', () => ({
  lookupCertNumber: vi.fn(),
}));

import { lookupCertNumber } from '@/lib/services/mit-registry';
import { verifyMitByCert } from '@/lib/services/mit-verification';

const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockSingle = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      update: mockUpdate,
    })),
  })),
}));

describe('mit-verification service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ select: mockSelect });
    mockSelect.mockReturnValue({ single: mockSingle });
  });

  describe('verifyMitByCert', () => {
    it('sets mit_status to verified when cert is found in registry', async () => {
      const mockRegistryRecord = {
        cert_number: '01900539-00001',
        company_name: '台灣好茶有限公司',
        brand_name: '好茶品牌',
      };
      vi.mocked(lookupCertNumber).mockResolvedValue(mockRegistryRecord);
      mockSingle.mockResolvedValue({ data: { id: 'brand-1' }, error: null });

      const result = await verifyMitByCert('brand-1', '01900539-00001');

      expect(result.error).toBeUndefined();
      expect(lookupCertNumber).toHaveBeenCalledWith('01900539-00001');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          mit_status: 'verified',
          mit_verified_at: expect.any(String),
          mit_evidence: expect.objectContaining({
            mit_smile_listed: true,
            mit_smile_cert: '01900539-00001',
            verified_source: 'mit_registry_auto',
          }),
        })
      );
    });

    it('returns error when cert is not found in registry', async () => {
      vi.mocked(lookupCertNumber).mockResolvedValue(null);

      const result = await verifyMitByCert('brand-1', 'nonexistent');

      expect(result.error).toBe('cert_not_found');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('returns error when cert number is empty', async () => {
      const result = await verifyMitByCert('brand-1', '');

      expect(result.error).toBe('cert_required');
      expect(lookupCertNumber).not.toHaveBeenCalled();
    });
  });
});
