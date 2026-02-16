import { ApiService } from './apiService';

// License processing interfaces
interface LicenseRequest {
  companyName: string;
  companyPhone: string;
  companyEmail: string;
  selectedBusinessTypes: string[];

  businesses: { [key: string]: any[] };
}

interface LicenseResponse {
  success: boolean;
  message?: string;
  companyCode?: string;
  accountCodes?: string[];
  licenseKeys?: string[];
}

// License info interface
interface LicenseInfo {
  licenseId: string;
  licenseKey: string;
  expiryDate: string;
  isActive: boolean;
  retailName?: string;
  planType?: string;
  features?: string[];
}

/**
 * License Service - handles license processing operations
 */
export class LicenseService {
  /**
   * Derive an expiry date from a licence key if it encodes a year.
   * Example supported formats:
   *   DEMO-LICENSE-<ID>-2025  -> 15 Nov 2025
   *   LIC_<ID>_2026           -> 15 Nov 2026
   */
  static deriveExpiryFromLicenceKey(licenceKey?: string): string | undefined {
    if (!licenceKey) return undefined;
    try {
      // Prefer explicit YYYYMMDD if present in the key (e.g., 20270908)
      const fullDate = /(?:^|[\-_.])((20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01]))(?!\d)/.exec(licenceKey);
      if (fullDate) {
        const y = Number(fullDate[2]);
        const m = Number(fullDate[3]);
        const d = Number(fullDate[4]);
        const dt = new Date(y, m - 1, d);
        // Set midday to avoid timezone shifts when converting to ISO
        dt.setHours(12, 0, 0, 0);
        return dt.toISOString();
      }
      // Else fallback to bare year e.g., -2025
      const yearOnly = /(?:^|[\-_.])((20)\d{2})(?!\d)/.exec(licenceKey);
      const year = yearOnly ? Number(yearOnly[1]) : undefined;
      if (!year || year < 2000 || year > 2100) return undefined;
      // Business rule (fallback): 15 Nov of the encoded year
      const expiry = new Date(year, 10 /* Nov */, 15);
      expiry.setHours(12, 0, 0, 0);
      return expiry.toISOString();
    } catch {
      return undefined;
    }
  }
  /**
   * Process license generation request
   */
  static async processLicense(licenseRequest: LicenseRequest): Promise<LicenseResponse> {
    return ApiService.post<LicenseResponse>('/process-license', licenseRequest);
  }

  /**
   * Get license information for the current user
   */
  static async getLicenseInfo(licenseId: string): Promise<LicenseInfo> {
    // Prefer sessionStorage licence key first (retail_master/licencekey), then license_info, then localStorage
    const sessionLicence = (() => {
      try {
        const rmRaw = sessionStorage.getItem('retail_master');
        if (rmRaw) {
          const rm = JSON.parse(rmRaw);
          const k = rm?.licencekey || rm?.license_key || rm?.licenseKey;
          if (typeof k === 'string' && k.trim()) return k.trim();
        }
      } catch { }
      try {
        const licRaw = sessionStorage.getItem('license_info');
        if (licRaw) {
          const li = JSON.parse(licRaw);
          const k = li?.licencekey || li?.license_key || li?.licenseKey;
          if (typeof k === 'string' && k.trim()) return k.trim();
        }
      } catch { }
      try { return localStorage.getItem('licencekey') || undefined; } catch { return undefined; }
    })();
    try {
      // Try to get from API first
      const apiInfo = await ApiService.get<LicenseInfo>(`/license-info/${licenseId}`);
      // If a session licence exists, prefer it for display
      const licenseKey = sessionLicence || apiInfo.licenseKey;
      // If API did not return an expiry date, or we prefer deriving from key, compute a sensible default
      const derivedExpiry = this.deriveExpiryFromLicenceKey(licenseKey);
      const expiryDate = apiInfo.expiryDate || derivedExpiry || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      return { ...apiInfo, licenseKey, expiryDate };
    } catch (error) {
      // Fallback to session storage or default values
      console.warn('API call failed, using fallback license info:', error);

      // Try to get from session storage
      try {
        const licenseData = sessionStorage.getItem('license_info');
        const retailMaster = sessionStorage.getItem('retail_master');

        let licenseKey = sessionLicence || "";
        let expiryDate = "";
        let retailName = "";

        if (licenseData) {
          const parsed = JSON.parse(licenseData);
          licenseKey = licenseKey || parsed.licencekey || parsed.license_key || parsed.licenseKey || "";
          expiryDate = parsed.expiry_date || parsed.expiryDate || "";
        }

        if (retailMaster) {
          const parsed = JSON.parse(retailMaster);
          retailName = parsed.RetailName || parsed.retail_name || parsed.CompanyName || parsed.company_name || "";
          if (!licenseKey) licenseKey = parsed.licencekey || parsed.license_key || parsed.licenseKey || "";
          if (!expiryDate) expiryDate = parsed.expiry_date || parsed.expiryDate || "";
        }
        // If still no expiry, derive from licence key or fallback to +30 days
        if (!expiryDate) {
          const derived = this.deriveExpiryFromLicenceKey(licenseKey);
          expiryDate = derived || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        }

        // Provide fallback values
        if (!licenseKey) licenseKey = `DEMO-LICENSE-${licenseId}-2025`;
        if (!expiryDate) expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        if (!retailName) retailName = "Demo Organization";

        return {
          licenseId,
          licenseKey,
          expiryDate,
          isActive: true,
          retailName,
          planType: "Standard",
          features: ["POS System", "Inventory Management", "Reporting"]
        };
      } catch (parseError) {
        console.error('Error parsing session storage:', parseError);

        // Final fallback
        return {
          licenseId,
          licenseKey: `DEMO-LICENSE-${licenseId}-2025`,
          expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          isActive: true,
          retailName: "Demo Organization",
          planType: "Standard",
          features: ["POS System", "Inventory Management", "Reporting"]
        };
      }
    }
  }

  /**
   * Request license extension
   */
  static async extendLicense(payload: {
    retail_code: string;
    account_code?: string;
    license_key?: string;
    extension_term?: '6-months' | '1-year' | '2-years' | '3-years' | 'custom-date';
    custom_expiry?: string; // ISO when custom-date
  }): Promise<{ success: boolean; message: string; data?: any }> {
    try {
      const body = {
        retail_code: payload.retail_code,
        account_code: payload.account_code,
        license_key: payload.license_key,
        extension_term: payload.extension_term || '1-year',
        custom_expiry: payload.custom_expiry,
      };
      return await ApiService.post<{ success: boolean; message: string; data?: any }>(
        '/api/retail-master/extend',
        body,
      );
    } catch (error) {
      console.error('Error extending license:', error);
      throw new Error('Failed to extend license. Please contact support.');
    }
  }

  /**
   * Get all customers and their details
   */
  static async getAllCustomers(): Promise<any[]> {
    try {
      const response = await ApiService.get<{ success: boolean; data: any[] }>('/admin/customers');
      if (response && response.success && Array.isArray(response.data)) {
        return response.data;
      }
      return [];
    } catch (error) {
      console.error('Error fetching customers:', error);
      return [];
    }
  }
}

export type { LicenseRequest, LicenseResponse, LicenseInfo };
