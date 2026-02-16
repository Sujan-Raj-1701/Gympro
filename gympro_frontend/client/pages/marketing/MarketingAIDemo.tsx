import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Sparkles, 
  Target, 
  Users, 
  TrendingUp, 
  MessageSquare, 
  Calendar,
  Play,
  Pause,
  BarChart3,
  DollarSign
} from 'lucide-react';

interface Campaign {
  id: string;
  title: string;
  description: string;
  status: 'active' | 'paused' | 'completed';
  target: string;
  budget: string;
  spent: string;
  reach: string;
  conversions: string;
  roi: string;
}

export default function MarketingAIDemo() {
  const [campaigns] = useState<Campaign[]>([
    {
      id: '1',
      title: 'Festive Bridal Package',
      description: 'Premium bridal services for wedding season with early bird discounts',
      status: 'active',
      target: 'Brides-to-be',
      budget: '₹25,000',
      spent: '₹18,500',
      reach: '12,500',
      conversions: '185',
      roi: '280%'
    },
    {
      id: '2',
      title: 'VIP Membership Drive',
      description: 'Exclusive membership offers for high-value customers',
      status: 'active',
      target: 'Premium Customers',
      budget: '₹15,000',
      spent: '₹12,200',
      reach: '8,200',
      conversions: '95',
      roi: '220%'
    },
    {
      id: '3',
      title: 'Student Special Offers',
      description: 'Discounted services and packages for students and young professionals',
      status: 'paused',
      target: 'Students (18-25)',
      budget: '₹10,000',
      spent: '₹7,800',
      reach: '15,600',
      conversions: '234',
      roi: '180%'
    }
  ]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'paused':
        return 'bg-yellow-100 text-yellow-800';
      case 'completed':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const toggleCampaignStatus = (id: string) => {
    // This would typically update the campaign status
    console.log('Toggle campaign status for:', id);
  };

  return (
    <div className="p-6 space-y-6 bg-gradient-to-br from-blue-50 to-indigo-50 min-h-screen">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Campaign Dashboard</h1>
          <p className="text-gray-600">Monitor and manage your AI-generated marketing campaigns</p>
        </div>
        <Button className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700">
          <Sparkles className="w-4 h-4 mr-2" />
          Create New Campaign
        </Button>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-white/80 backdrop-blur border-0 shadow-lg">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Campaigns</p>
                <p className="text-2xl font-bold text-gray-900">12</p>
              </div>
              <BarChart3 className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-white/80 backdrop-blur border-0 shadow-lg">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Campaigns</p>
                <p className="text-2xl font-bold text-green-600">8</p>
              </div>
              <Target className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-white/80 backdrop-blur border-0 shadow-lg">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Reach</p>
                <p className="text-2xl font-bold text-purple-600">48.2K</p>
              </div>
              <Users className="w-8 h-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-white/80 backdrop-blur border-0 shadow-lg">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Average ROI</p>
                <p className="text-2xl font-bold text-orange-600">245%</p>
              </div>
              <TrendingUp className="w-8 h-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Campaign List */}
      <Card className="bg-white/80 backdrop-blur border-0 shadow-lg">
        <CardHeader>
          <CardTitle>Active Campaigns</CardTitle>
          <CardDescription>Monitor performance and manage your marketing campaigns</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {campaigns.map((campaign) => (
              <div key={campaign.id} className="border rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <h3 className="font-semibold text-gray-900">{campaign.title}</h3>
                      <Badge className={getStatusColor(campaign.status)}>
                        {campaign.status}
                      </Badge>
                    </div>
                    <p className="text-gray-600 text-sm">{campaign.description}</p>
                    <p className="text-xs text-gray-500 mt-1">Target: {campaign.target}</p>
                  </div>
                  <div className="flex space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleCampaignStatus(campaign.id)}
                    >
                      {campaign.status === 'active' ? (
                        <>
                          <Pause className="w-3 h-3 mr-1" />
                          Pause
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 mr-1" />
                          Resume
                        </>
                      )}
                    </Button>
                    <Button size="sm" variant="ghost">
                      <MessageSquare className="w-3 h-3 mr-1" />
                      Edit
                    </Button>
                  </div>
                </div>

                {/* Campaign Metrics */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500 font-medium">Budget</p>
                    <p className="text-gray-900">{campaign.budget}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 font-medium">Spent</p>
                    <p className="text-gray-900">{campaign.spent}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 font-medium">Reach</p>
                    <p className="text-gray-900">{campaign.reach}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 font-medium">Conversions</p>
                    <p className="text-gray-900">{campaign.conversions}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 font-medium">ROI</p>
                    <p className="text-green-600 font-semibold">{campaign.roi}</p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Budget Utilization</span>
                    <span>{Math.round((parseFloat(campaign.spent.replace('₹', '').replace(',', '')) / parseFloat(campaign.budget.replace('₹', '').replace(',', ''))) * 100)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full" 
                      style={{ 
                        width: `${Math.round((parseFloat(campaign.spent.replace('₹', '').replace(',', '')) / parseFloat(campaign.budget.replace('₹', '').replace(',', ''))) * 100)}%` 
                      }}
                    ></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0 shadow-lg">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">AI Campaign Builder</h3>
                <p className="text-sm opacity-90">Generate smart campaigns</p>
              </div>
              <Sparkles className="w-8 h-8 opacity-80" />
            </div>
            <Button variant="secondary" size="sm" className="mt-3 w-full">
              Get Started
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white border-0 shadow-lg">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Performance Analytics</h3>
                <p className="text-sm opacity-90">Detailed campaign insights</p>
              </div>
              <BarChart3 className="w-8 h-8 opacity-80" />
            </div>
            <Button variant="secondary" size="sm" className="mt-3 w-full">
              View Analytics
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-r from-green-500 to-emerald-500 text-white border-0 shadow-lg">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Revenue Tracker</h3>
                <p className="text-sm opacity-90">Monitor campaign ROI</p>
              </div>
              <DollarSign className="w-8 h-8 opacity-80" />
            </div>
            <Button variant="secondary" size="sm" className="mt-3 w-full">
              View Revenue
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}