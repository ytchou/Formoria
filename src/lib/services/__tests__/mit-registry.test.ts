import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

import { parseMitCsv, lookupCertNumber } from '@/lib/services/mit-registry';

describe('mit-registry service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseMitCsv', () => {
    it('parses CSV rows into mit_registry records', () => {
      const csvContent = [
        '序號,產業別,獲證業者,統一編號,產品名稱,產品型號,產品效期,標章編號,品牌名稱,備註',
        '1,食品,台灣好茶有限公司,12345678,烏龍茶,TW-001,2027-12-31,01900539-00001,好茶品牌,',
        '2,紡織,台灣布料公司,87654321,純棉布料,FB-100,2028-06-30,01900539-00002,布料品牌,備註文字',
      ].join('\n');

      const records = parseMitCsv(csvContent);

      expect(records).toHaveLength(2);
      expect(records[0]).toEqual({
        cert_number: '01900539-00001',
        company_name: '台灣好茶有限公司',
        brand_name: '好茶品牌',
        product_name: '烏龍茶',
        product_model: 'TW-001',
        industry_type: '食品',
        valid_until: '2027-12-31',
      });
      expect(records[1]).toEqual({
        cert_number: '01900539-00002',
        company_name: '台灣布料公司',
        brand_name: '布料品牌',
        product_name: '純棉布料',
        product_model: 'FB-100',
        industry_type: '紡織',
        valid_until: '2028-06-30',
      });
    });

    it('skips rows with missing cert_number', () => {
      const csvContent = [
        '序號,產業別,獲證業者,統一編號,產品名稱,產品型號,產品效期,標章編號,品牌名稱,備註',
        '1,食品,台灣好茶有限公司,12345678,烏龍茶,TW-001,2027-12-31,,好茶品牌,',
      ].join('\n');

      const records = parseMitCsv(csvContent);
      expect(records).toHaveLength(0);
    });

    it('returns empty array for empty CSV', () => {
      const records = parseMitCsv('');
      expect(records).toHaveLength(0);
    });
  });

  describe('lookupCertNumber', () => {
    it('returns registry record when cert exists', async () => {
      const mockRecord = {
        cert_number: '01900539-00001',
        company_name: '台灣好茶有限公司',
        brand_name: '好茶品牌',
      };

      mockFrom.mockReturnValue({ select: mockSelect });
      mockSelect.mockReturnValue({ eq: mockEq });
      mockEq.mockReturnValue({ single: mockSingle });
      mockSingle.mockResolvedValue({ data: mockRecord, error: null });

      const result = await lookupCertNumber('01900539-00001');

      expect(result).toEqual(mockRecord);
      expect(mockFrom).toHaveBeenCalledWith('mit_registry');
      expect(mockEq).toHaveBeenCalledWith('cert_number', '01900539-00001');
    });

    it('returns null when cert does not exist', async () => {
      mockFrom.mockReturnValue({ select: mockSelect });
      mockSelect.mockReturnValue({ eq: mockEq });
      mockEq.mockReturnValue({ single: mockSingle });
      mockSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

      const result = await lookupCertNumber('nonexistent');
      expect(result).toBeNull();
    });
  });
});
