import React, { useMemo } from 'react';
import { format, eachDayOfInterval, startOfWeek, endOfWeek } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  TrendingUp, 
  TrendingDown, 
  BarChart3, 
  PieChart,
  Calendar,
  Users,
  Receipt,
  CreditCard,
  Target,
  ArrowUp,
  ArrowDown,
  Clock
} from 'lucide-react';

interface AnalyticsProps {
  data: Array<{
    id: string;
    type: 'appointment' | 'billing' | 'income' | 'expense';
    date: Date;
    amount: number;
    payment_mode?: string;
    status: string;
  }>;
  dateRange: { start: Date; end: Date };
}

export default function SettlementAnalytics({ data, dateRange }: AnalyticsProps) {
  // Calculate trend data
  const trendAnalysis = useMemo(() => {
    const days = eachDayOfInterval({ start: dateRange.start, end: dateRange.end });
    const dailyData = days.map(day => {
      const dayData = data.filter(item => 
        format(item.date, 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd')
      );
      
      const income = dayData
        .filter(item => ['appointment', 'billing', 'income'].includes(item.type))
        .reduce((sum, item) => sum + item.amount, 0);
        
      const expenses = dayData
        .filter(item => item.type === 'expense')
        .reduce((sum, item) => sum + item.amount, 0);
        
      return {
        date: day,
        income,
        expenses,
        net: income - expenses,
        transactions: dayData.length
      };
    });

    // Calculate weekly comparison
    const currentWeek = dailyData.slice(-7);
    const previousWeek = dailyData.slice(-14, -7);
    
    const currentWeekIncome = currentWeek.reduce((sum, day) => sum + day.income, 0);
    const previousWeekIncome = previousWeek.reduce((sum, day) => sum + day.income, 0);
    
    const incomeGrowth = previousWeekIncome > 0 ? 
      ((currentWeekIncome - previousWeekIncome) / previousWeekIncome) * 100 : 0;

    return {
      dailyData,
      weeklyComparison: {
        currentWeek: currentWeekIncome,
        previousWeek: previousWeekIncome,
        growth: incomeGrowth
      }
    };
  }, [data, dateRange]);

  // Payment method analysis
  const paymentAnalysis = useMemo(() => {
    const paymentGroups = data.reduce((acc, item) => {
      if (item.type === 'expense') return acc;
      
      const mode = (item.payment_mode || 'cash').toLowerCase();
      let category = 'others';
      
      if (mode.includes('cash')) category = 'cash';
      else if (mode.includes('card') || mode.includes('visa') || mode.includes('mastercard')) category = 'card';
      else if (mode.includes('upi') || mode.includes('gpay') || mode.includes('phonepe') || mode.includes('paytm')) category = 'upi';
      else if (mode.includes('net') || mode.includes('bank') || mode.includes('transfer')) category = 'netbanking';
      
      acc[category] = (acc[category] || 0) + item.amount;
      return acc;
    }, {} as Record<string, number>);

    const total = Object.values(paymentGroups).reduce((sum, amount) => sum + amount, 0);
    
    return Object.entries(paymentGroups).map(([method, amount]) => ({
      method: method.charAt(0).toUpperCase() + method.slice(1),
      amount,
      percentage: total > 0 ? (amount / total) * 100 : 0
    })).sort((a, b) => b.amount - a.amount);
  }, [data]);

  // Service performance
  const serviceAnalysis = useMemo(() => {
    const appointmentData = data.filter(item => item.type === 'appointment');
    const billingData = data.filter(item => item.type === 'billing');
    
    return {
      appointments: {
        count: appointmentData.length,
        revenue: appointmentData.reduce((sum, item) => sum + item.amount, 0),
        avgValue: appointmentData.length > 0 ? 
          appointmentData.reduce((sum, item) => sum + item.amount, 0) / appointmentData.length : 0
      },
      billing: {
        count: billingData.length,
        revenue: billingData.reduce((sum, item) => sum + item.amount, 0),
        avgValue: billingData.length > 0 ? 
          billingData.reduce((sum, item) => sum + item.amount, 0) / billingData.length : 0
      }
    };
  }, [data]);

  // Peak hours analysis
  const timeAnalysis = useMemo(() => {
    const hourlyData = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      transactions: 0,
      revenue: 0
    }));

    data.forEach(item => {
      const hour = item.date.getHours();
      hourlyData[hour].transactions += 1;
      if (item.type !== 'expense') {
        hourlyData[hour].revenue += item.amount;
      }
    });

    const peakHour = hourlyData.reduce((max, curr) => 
      curr.revenue > max.revenue ? curr : max
    );

    return {
      hourlyData,
      peakHour: peakHour.hour,
      peakRevenue: peakHour.revenue
    };
  }, [data]);

  return (
    <div className="space-y-6">
      {/* Trend Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center">
              <TrendingUp className="h-4 w-4 mr-2" />
              Weekly Growth
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {trendAnalysis.weeklyComparison.growth.toFixed(1)}%
                </p>
                <p className="text-sm text-gray-500">vs last week</p>
              </div>
              <div className={`p-2 rounded-lg ${
                trendAnalysis.weeklyComparison.growth >= 0 ? 'bg-green-100' : 'bg-red-100'
              }`}>
                {trendAnalysis.weeklyComparison.growth >= 0 ? (
                  <ArrowUp className="h-5 w-5 text-green-600" />
                ) : (
                  <ArrowDown className="h-5 w-5 text-red-600" />
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center">
              <Clock className="h-4 w-4 mr-2" />
              Peak Hour
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {format(new Date().setHours(timeAnalysis.peakHour, 0, 0, 0), 'HH:mm')}
                </p>
                <p className="text-sm text-gray-500">
                  ₹{timeAnalysis.peakRevenue.toLocaleString('en-IN')} revenue
                </p>
              </div>
              <div className="p-2 bg-blue-100 rounded-lg">
                <Target className="h-5 w-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center">
              <Receipt className="h-4 w-4 mr-2" />
              Avg Transaction
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  ₹{((serviceAnalysis.appointments.avgValue + serviceAnalysis.billing.avgValue) / 2).toLocaleString('en-IN')}
                </p>
                <p className="text-sm text-gray-500">per transaction</p>
              </div>
              <div className="p-2 bg-purple-100 rounded-lg">
                <BarChart3 className="h-5 w-5 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Payment Methods Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <CreditCard className="h-5 w-5 mr-2" />
            Payment Method Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {paymentAnalysis.map((payment, index) => (
              <div key={payment.method} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className={`w-3 h-3 rounded-full mr-3 ${
                      index === 0 ? 'bg-blue-500' :
                      index === 1 ? 'bg-green-500' :
                      index === 2 ? 'bg-purple-500' :
                      index === 3 ? 'bg-orange-500' : 'bg-gray-500'
                    }`} />
                    <span className="font-medium">{payment.method}</span>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">₹{payment.amount.toLocaleString('en-IN')}</div>
                    <div className="text-sm text-gray-500">{payment.percentage.toFixed(1)}%</div>
                  </div>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${
                      index === 0 ? 'bg-blue-500' :
                      index === 1 ? 'bg-green-500' :
                      index === 2 ? 'bg-purple-500' :
                      index === 3 ? 'bg-orange-500' : 'bg-gray-500'
                    }`}
                    style={{ width: `${payment.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Service Performance */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Users className="h-5 w-5 mr-2" />
              Appointment Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Total Appointments</span>
                <Badge variant="secondary">{serviceAnalysis.appointments.count}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Total Revenue</span>
                <span className="font-medium text-green-600">
                  ₹{serviceAnalysis.appointments.revenue.toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Average Value</span>
                <span className="font-medium">
                  ₹{serviceAnalysis.appointments.avgValue.toLocaleString('en-IN')}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Receipt className="h-5 w-5 mr-2" />
              Billing Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Total Invoices</span>
                <Badge variant="secondary">{serviceAnalysis.billing.count}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Total Revenue</span>
                <span className="font-medium text-green-600">
                  ₹{serviceAnalysis.billing.revenue.toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Average Value</span>
                <span className="font-medium">
                  ₹{serviceAnalysis.billing.avgValue.toLocaleString('en-IN')}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Daily Trend Graph (Simple visualization) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <BarChart3 className="h-5 w-5 mr-2" />
            Daily Revenue Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {trendAnalysis.dailyData.slice(-7).map((day, index) => {
              const maxRevenue = Math.max(...trendAnalysis.dailyData.map(d => d.income));
              const barWidth = maxRevenue > 0 ? (day.income / maxRevenue) * 100 : 0;
              
              return (
                <div key={index} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{format(day.date, 'dd MMM')}</span>
                    <span className="font-medium">₹{day.income.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full"
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Performance Insights */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Target className="h-5 w-5 mr-2" />
            Key Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="font-medium text-gray-900">Revenue Insights</h4>
              <ul className="space-y-1 text-sm text-gray-600">
                <li>• Peak business hour: {format(new Date().setHours(timeAnalysis.peakHour, 0, 0, 0), 'HH:mm')}</li>
                <li>• {trendAnalysis.weeklyComparison.growth >= 0 ? 'Growing' : 'Declining'} weekly trend: {Math.abs(trendAnalysis.weeklyComparison.growth).toFixed(1)}%</li>
                <li>• Most popular payment: {paymentAnalysis[0]?.method || 'N/A'}</li>
                <li>• {serviceAnalysis.appointments.count > serviceAnalysis.billing.count ? 'Appointment' : 'Billing'} revenue is dominant</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium text-gray-900">Recommendations</h4>
              <ul className="space-y-1 text-sm text-gray-600">
                <li>• Focus marketing during peak hours ({format(new Date().setHours(timeAnalysis.peakHour, 0, 0, 0), 'HH:mm')})</li>
                <li>• {paymentAnalysis[0]?.percentage < 50 ? 'Diversify' : 'Optimize'} payment options</li>
                <li>• {trendAnalysis.weeklyComparison.growth < 0 ? 'Implement retention strategies' : 'Scale successful practices'}</li>
                <li>• Target average transaction increase by 10%</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}