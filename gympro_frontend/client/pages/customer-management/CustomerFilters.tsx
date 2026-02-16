import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import {
  Filter,
  X,
  Calendar,
  Users,
  MapPin,
  Star,
  TrendingUp
} from 'lucide-react';

interface Customer {
  id?: string;
  customer_id?: string;
  customer_name?: string;
  name?: string;
  full_name?: string;
  city?: string;
  gender?: string;
  membership_name?: string;
  status?: string;
  total_visits?: number;
  total_spent?: number;
}

interface FilterOptions {
  search: string;
  gender: string;
  membershipStatus: string;
  visitRange: string;
  dateRange: { from: Date | null; to: Date | null };
  city: string;
}

interface CustomerFiltersProps {
  filters: FilterOptions;
  onFiltersChange: (filters: FilterOptions) => void;
  customers: Customer[];
}

export default function CustomerFilters({ filters, onFiltersChange, customers }: CustomerFiltersProps) {
  // Get unique cities from customers
  const uniqueCities = [...new Set(customers.map(c => c.city).filter(Boolean))].sort();
  
  // Get unique membership names
  const uniqueMemberships = [...new Set(customers.map(c => c.membership_name).filter(Boolean))].sort();

  const handleFilterChange = (key: keyof FilterOptions, value: any) => {
    onFiltersChange({
      ...filters,
      [key]: value
    });
  };

  const handleDateRangeChange = (type: 'from' | 'to', value: string) => {
    const date = value ? new Date(value) : null;
    onFiltersChange({
      ...filters,
      dateRange: {
        ...filters.dateRange,
        [type]: date
      }
    });
  };

  const clearFilters = () => {
    onFiltersChange({
      search: '',
      gender: '',
      membershipStatus: '',
      visitRange: '',
      dateRange: { from: null, to: null },
      city: ''
    });
  };

  const hasActiveFilters = Object.values(filters).some(value => {
    if (typeof value === 'string') return value !== '';
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).some(v => v !== null);
    }
    return false;
  });

  const getFilterSummary = () => {
    const activeFilters = [];
    if (filters.gender) activeFilters.push(`Gender: ${filters.gender}`);
    if (filters.membershipStatus) activeFilters.push(`Membership: ${filters.membershipStatus}`);
    if (filters.visitRange) activeFilters.push(`Visits: ${filters.visitRange}`);
    if (filters.city) activeFilters.push(`City: ${filters.city}`);
    if (filters.dateRange.from || filters.dateRange.to) {
      const from = filters.dateRange.from?.toLocaleDateString() || 'Start';
      const to = filters.dateRange.to?.toLocaleDateString() || 'End';
      activeFilters.push(`Date: ${from} - ${to}`);
    }
    return activeFilters;
  };

  return (
    <Card className="bg-blue-50 border-blue-200">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5 text-blue-600" />
            Advanced Filters
          </CardTitle>
          {hasActiveFilters && (
            <Button
              onClick={clearFilters}
              variant="outline"
              size="sm"
              className="flex items-center gap-2"
            >
              <X className="h-4 w-4" />
              Clear All
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {/* Gender Filter */}
          <div>
            <label className="text-sm font-medium mb-2 block">Gender</label>
            <Select
              value={filters.gender}
              onValueChange={(value) => handleFilterChange('gender', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All genders" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All genders</SelectItem>
                <SelectItem value="Male">Male</SelectItem>
                <SelectItem value="Female">Female</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Membership Filter */}
          <div>
            <label className="text-sm font-medium mb-2 block">Membership Status</label>
            <Select
              value={filters.membershipStatus}
              onValueChange={(value) => handleFilterChange('membershipStatus', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All customers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All customers</SelectItem>
                <SelectItem value="member">Members only</SelectItem>
                <SelectItem value="non-member">Non-members only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Visit Range Filter */}
          <div>
            <label className="text-sm font-medium mb-2 block">Visit Count</label>
            <Select
              value={filters.visitRange}
              onValueChange={(value) => handleFilterChange('visitRange', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All visit counts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All visit counts</SelectItem>
                <SelectItem value="0">0 visits (New)</SelectItem>
                <SelectItem value="1-5">1-5 visits</SelectItem>
                <SelectItem value="6-15">6-15 visits</SelectItem>
                <SelectItem value="16+">16+ visits</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* City Filter */}
          <div>
            <label className="text-sm font-medium mb-2 block">City</label>
            <Select
              value={filters.city}
              onValueChange={(value) => handleFilterChange('city', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All cities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All cities</SelectItem>
                {uniqueCities.map(city => (
                  <SelectItem key={city} value={city}>{city}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Date Range Filter */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Registration Date From</label>
            <Input
              type="date"
              value={filters.dateRange.from?.toISOString().split('T')[0] || ''}
              onChange={(e) => handleDateRangeChange('from', e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-2 block">Registration Date To</label>
            <Input
              type="date"
              value={filters.dateRange.to?.toISOString().split('T')[0] || ''}
              onChange={(e) => handleDateRangeChange('to', e.target.value)}
            />
          </div>
        </div>

        {/* Active Filters Summary */}
        {hasActiveFilters && (
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium mb-2">Active Filters:</h4>
            <div className="flex flex-wrap gap-2">
              {getFilterSummary().map((filter, index) => (
                <Badge key={index} variant="secondary" className="bg-blue-100 text-blue-800">
                  {filter}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Quick Filter Buttons */}
        <div className="border-t pt-4">
          <h4 className="text-sm font-medium mb-3">Quick Filters:</h4>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleFilterChange('membershipStatus', 'member')}
              className="flex items-center gap-1"
            >
              <Star className="h-3 w-3" />
              Members Only
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleFilterChange('visitRange', '0')}
              className="flex items-center gap-1"
            >
              <Users className="h-3 w-3" />
              New Customers
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleFilterChange('visitRange', '16+')}
              className="flex items-center gap-1"
            >
              <TrendingUp className="h-3 w-3" />
              VIP customers
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                handleFilterChange('dateRange', { from: thirtyDaysAgo, to: new Date() });
              }}
              className="flex items-center gap-1"
            >
              <Calendar className="h-3 w-3" />
              Last 30 Days
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}