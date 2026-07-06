import React, { useState } from 'react';
import { Search, Activity, Target, Layers, FileText, Upload, Download, Globe, PieChart, BarChart3, TrendingUp, AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';

export default function Dashboard(props: any) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-2 px-4 py-2 bg-muted rounded-xl hover:bg-muted/80 transition-colors">
            <Upload className="w-4 h-4" /> Import Data
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-xl hover:bg-accent/90 transition-colors font-medium shadow-sm shadow-accent/20">
            <Search className="w-4 h-4" /> New Research
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Projects', value: '4', icon: Folder, color: 'text-blue-500' },
          { label: 'Keywords Analyzed', value: '12,403', icon: Search, color: 'text-green-500' },
          { label: 'Total Clusters', value: '142', icon: Layers, color: 'text-purple-500' },
          { label: 'Avg Opp. Score', value: '72/100', icon: TrendingUp, color: 'text-orange-500' }
        ].map((stat, i) => (
          <motion.div 
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-card border border-border rounded-2xl p-6 shadow-sm"
          >
            <div className="flex items-center gap-4">
              <div className={`p-3 bg-muted rounded-xl ${stat.color}`}>
                <stat.icon className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground font-medium">{stat.label}</p>
                <p className="text-2xl font-bold">{stat.value}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><Target className="w-5 h-5 text-accent" /> Top Keyword Opportunities</h2>
          <div className="space-y-4">
            {[
              { kw: 'local seo for plumbers', opp: 92, intent: 'Transactional' },
              { kw: 'how to do keyword research', opp: 88, intent: 'Informational' },
              { kw: 'best seo software', opp: 85, intent: 'Commercial' }
            ].map((kw, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-muted/30 rounded-xl border border-border/50">
                <div>
                  <p className="font-medium">{kw.kw}</p>
                  <p className="text-xs text-muted-foreground">{kw.intent}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-green-500">{kw.opp} Opp</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><Activity className="w-5 h-5 text-red-500" /> Recent Site Audits</h2>
          <div className="space-y-4">
            {[
              { url: 'example.com', score: 65, issues: 12 },
              { url: 'competitor.com', score: 82, issues: 4 },
            ].map((audit, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-muted/30 rounded-xl border border-border/50">
                <div>
                  <p className="font-medium truncate max-w-[200px]">{audit.url}</p>
                  <p className="text-xs text-muted-foreground">{audit.issues} issues found</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${audit.score > 80 ? 'text-green-500' : 'text-orange-500'}`}>{audit.score}/100</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Just creating a mock icon since we mapped `Folder` in the loop above and I didn't import it. 
import { Folder } from 'lucide-react';
