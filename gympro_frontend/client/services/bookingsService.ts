// No network calls for bookings range; endpoint deprecated.

export interface BookingRangeEntry {
  booking: any;
  services: any[];
  payments: any[];
  customer?: any | null;
  hallbooking?: any[];
}

export class BookingsService {
  static async getRange(params: {
    account_code: string;
    retail_code: string;
    fromdate: string; // YYYY-MM-DD
    todate: string;   // YYYY-MM-DD
  }): Promise<{ success: boolean; count?: number; data: BookingRangeEntry[] }>
  {
    // Endpoint deprecated: /bookings-range has been removed on the backend.
    // Return an empty dataset to keep callers stable without making a network call.
    return Promise.resolve({ success: true, count: 0, data: [] });
  }
}
