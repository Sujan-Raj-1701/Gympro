import { API_BASE_URL, ApiService, ApiResponse } from './apiService';

// Types
export interface BusinessType {
  id: string;
  name: string;
}

// API Service for business-related operations
export class BusinessService {
  /**
   * Fetch business types from the business_master table
   * Uses authenticated endpoint
   */
  static async getBusinessTypes(accountCode: string, retailCode: string): Promise<BusinessType[]> {
    try {
      const { DataService } = await import('./userService');
      const result = await DataService.readData(["business_master"], accountCode, retailCode);
      
      if (result.success && result.data) {
        // Map the data to BusinessType format
        // Based on API response: Id, BusCode, BusName fields
        const mappedTypes = result.data.map((item: any) => ({
          id: item.BusCode || item.business_code || item.id || item.business_type,
          name: item.BusName || item.business_name || item.name || item.business_type
        }));
        return mappedTypes;
      } else {
        throw new Error(result.message || 'Failed to fetch business types');
      }
    } catch (error) {
      console.error('Error fetching business types:', error);
      // Return fallback data
      return [{ id: 'DINEZO', name: 'DINEZO' }];
    }
  }

  /**
   * Fetch business details/categories from the backend
   * Uses authenticated endpoint
   */
  static async getBusinessDetails(accountCode: string, retailCode: string): Promise<BusinessType[]> {
    try {
      const { DataService } = await import('./userService');
      const result = await DataService.readData(["business_category_master"], accountCode, retailCode);
      
      if (result.success && result.data) {
        // Map the data to BusinessType format
        const mappedDetails = result.data.map((item: any) => ({
          id: item.category_code || item.CategoryCode || item.id || item.code,
          name: item.category_name || item.CategoryName || item.name || item.category
        }));
        return mappedDetails;
      } else {
        throw new Error(result.message || 'Failed to fetch business details');
      }
    } catch (error) {
      console.error('Error fetching business details:', error);
      // Return fallback data if API fails
      return [
        { id: 'restaurant', name: 'Restaurant' },
        { id: 'cafe', name: 'Cafe' },
        { id: 'bar', name: 'Bar & Lounge' },
        { id: 'bakery', name: 'Bakery' },
        { id: 'fast_food', name: 'Fast Food' },
        { id: 'fine_dining', name: 'Fine Dining' },
        { id: 'catering', name: 'Catering Service' },
        { id: 'food_truck', name: 'Food Truck' },
        { id: 'delivery', name: 'Delivery Only' },
        { id: 'takeaway', name: 'Takeaway' }
      ];
    }
  }
}