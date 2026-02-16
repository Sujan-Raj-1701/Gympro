import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Users, 
  Receipt, 
  CreditCard,
  ArrowUp,
  ArrowDown,
  Minus
} from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: {
    value: number;
    isPositive?: boolean;
    period?: string;
  };
  icon?: React.ReactNode;
  variant?: 'default' | 'income' | 'expense' | 'neutral';
  className?: string;
}

export function MetricCard({ 
  title, 
  value, 
  subtitle, 
  trend, 
  icon, 
  variant = 'default',
  className = '' 
}: MetricCardProps) {
  const getVariantStyles = () => {
    switch (variant) {
      case 'income':
        return {
          valueColor: 'text-green-600',
          iconBg: 'bg-green-100',
          iconColor: 'text-green-600'
        };
      case 'expense':
        return {
          valueColor: 'text-red-600',
          iconBg: 'bg-red-100',
          iconColor: 'text-red-600'
        };
      case 'neutral':
        return {
          valueColor: 'text-blue-600',
          iconBg: 'bg-blue-100',
          iconColor: 'text-blue-600'
        };
      default:
        return {
          valueColor: 'text-gray-900',
          iconBg: 'bg-gray-100',
          iconColor: 'text-gray-600'
        };
    }
  };

  const styles = getVariantStyles();

  const formatValue = (val: string | number) => {
    if (typeof val === 'number') {
      return `₹${val.toLocaleString('en-IN')}`;
    }
    return val;
  };

  return (
    <Card className={className}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-600">{title}</p>
            <div>
              <p className={`text-2xl font-bold ${styles.valueColor}`}>
                {formatValue(value)}
              </p>
              {subtitle && (
                <p className="text-sm text-gray-500">{subtitle}</p>
              )}
            </div>
            {trend && (
              <div className="flex items-center space-x-1">
                {trend.value > 0 ? (
                  <ArrowUp className="h-3 w-3 text-green-500" />
                ) : trend.value < 0 ? (
                  <ArrowDown className="h-3 w-3 text-red-500" />
                ) : (
                  <Minus className="h-3 w-3 text-gray-400" />
                )}
                <span className={`text-xs font-medium ${
                  trend.value > 0 ? 'text-green-600' :
                  trend.value < 0 ? 'text-red-600' : 'text-gray-500'
                }`}>
                  {Math.abs(trend.value).toFixed(1)}%
                </span>
                {trend.period && (
                  <span className="text-xs text-gray-500">{trend.period}</span>
                )}
              </div>
            )}
          </div>
          {icon && (
            <div className={`p-3 rounded-lg ${styles.iconBg}`}>
              <div className={styles.iconColor}>
                {icon}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface SummaryGridProps {
  data: {
    totalIncome: number;
    totalExpenses: number;
    netAmount: number;
    totalTransactions: number;
    appointmentRevenue: number;
    billingRevenue: number;
    cashPayments: number;
    digitalPayments: number;
  };
  trends?: {
    income?: number;
    expenses?: number;
    transactions?: number;
  };
  className?: string;
}

export function FinancialSummaryGrid({ data, trends, className = '' }: SummaryGridProps) {
  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 ${className}`}>
      <MetricCard
        title="Total Income"
        value={data.totalIncome}
        icon={<TrendingUp className="h-6 w-6" />}
        variant="income"
        trend={trends?.income ? {
          value: trends.income,
          isPositive: trends.income > 0,
          period: 'vs last period'
        } : undefined}
      />
      
      <MetricCard
        title="Total Expenses"
        value={data.totalExpenses}
        icon={<TrendingDown className="h-6 w-6" />}
        variant="expense"
        trend={trends?.expenses ? {
          value: trends.expenses,
          isPositive: trends.expenses < 0,
          period: 'vs last period'
        } : undefined}
      />
      
      <MetricCard
        title="Net Amount"
        value={data.netAmount}
        icon={<DollarSign className="h-6 w-6" />}
        variant={data.netAmount >= 0 ? 'income' : 'expense'}
      />
      
      <MetricCard
        title="Total Transactions"
        value={data.totalTransactions.toString()}
        icon={<Receipt className="h-6 w-6" />}
        variant="neutral"
        trend={trends?.transactions ? {
          value: trends.transactions,
          isPositive: trends.transactions > 0,
          period: 'vs last period'
        } : undefined}
      />
    </div>
  );
}

interface PaymentBreakdownProps {
  cash: number;
  digital: number;
  credit?: number;
  className?: string;
}

export function PaymentBreakdown({ cash, digital, credit = 0, className = '' }: PaymentBreakdownProps) {
  const total = cash + digital + credit;
  
  const payments = [
    { label: 'Cash', amount: cash, color: 'bg-green-500', percentage: total > 0 ? (cash / total) * 100 : 0 },
    { label: 'Digital', amount: digital, color: 'bg-blue-500', percentage: total > 0 ? (digital / total) * 100 : 0 },
    { label: 'Credit', amount: credit, color: 'bg-purple-500', percentage: total > 0 ? (credit / total) * 100 : 0 }
  ].filter(payment => payment.amount > 0);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg flex items-center">
          <CreditCard className="h-5 w-5 mr-2" />
          Payment Methods
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {payments.map(payment => (
          <div key={payment.label} className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{payment.label}:</span>
              <div className="text-right">
                <div>₹{payment.amount.toLocaleString('en-IN')}</div>
                <div className="text-xs text-gray-500">{payment.percentage.toFixed(1)}%</div>
              </div>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${payment.color}`}
                style={{ width: `${payment.percentage}%` }}
              />
            </div>
          </div>
        ))}
        {payments.length === 0 && (
          <div className="text-center text-gray-500 py-4">
            No payment data available
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default {
  MetricCard,
  FinancialSummaryGrid,
  PaymentBreakdown
};