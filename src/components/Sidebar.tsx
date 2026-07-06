import { motion, AnimatePresence } from 'motion/react';
import { LayoutDashboard, Search, Globe, Target, FileText, Activity, BarChart3, Upload, PieChart, Settings, HelpCircle, X, User, ShieldAlert, Folder, Layers } from 'lucide-react';
import { TabType } from '../App';
import { useAuth } from '../contexts/AuthContext';

const navItems: { icon: any, label: string, id: TabType, adminOnly?: boolean }[] = [
 { icon: LayoutDashboard, label: 'Dashboard', id: 'dashboard' },
 { icon: Search, label: 'Keyword Research', id: 'keyword-research' },
 { icon: Globe, label: 'Website Analyzer', id: 'website-analyzer' },
 { icon: Layers, label: 'Keyword Clusters', id: 'keyword-clusters' },
 { icon: Target, label: 'Competitor Gap', id: 'competitor-gap' },
 { icon: FileText, label: 'Content Briefs', id: 'content-briefs' },
 { icon: Activity, label: 'SEO Audit', id: 'seo-audit' },
 { icon: BarChart3, label: 'Rank Tracker', id: 'rank-tracker' },
 { icon: Upload, label: 'Imports', id: 'imports' },
 { icon: PieChart, label: 'Reports', id: 'reports' },
];

interface SidebarProps {
 isOpen: boolean;
 onClose: () => void;
 activeTab: TabType;
 setActiveTab: (tab: TabType) => void;
}

export default function Sidebar({ isOpen, onClose, activeTab, setActiveTab }: SidebarProps) {
 const { user } = useAuth();
 
 const filteredNavItems = navItems.filter(item => !item.adminOnly || user?.role === 'admin');

 return (
 <>
 {/* Mobile overlay */}
 <AnimatePresence>
 {isOpen && (
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 onClick={onClose}
 className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
 />
 )}
 </AnimatePresence>

 {/* Sidebar */}
 <AnimatePresence>
 {isOpen && (
 <motion.aside
 initial={{ width: 0, opacity: 0, x: -20 }}
 animate={{ width: 256, opacity: 1, x: 0 }}
 exit={{ width: 0, opacity: 0, x: -20 }}
 transition={{ duration: 0.3, ease: 'easeInOut' }}
 className="fixed lg:sticky top-16 left-0 z-50 h-[calc(100vh-4rem)] bg-card border-r border-border flex flex-col overflow-hidden whitespace-nowrap shadow-sm"
 >
 <div className="p-6 flex-1 w-64">
 <div className="flex items-center justify-between mb-6">
 <div className="text-xs font-bold text-muted-foreground">
 SEO Toolkit
 </div>
 <button onClick={onClose} className="lg:hidden p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors">
 <X className="w-4 h-4"/>
 </button>
 </div>
 <nav className="space-y-1.5">
 {filteredNavItems.map((item) => {
 const isActive = activeTab === item.id;
 return (
 <button
 key={item.id}
 onClick={() => {
 setActiveTab(item.id);
 if (window.innerWidth < 1024) onClose();
 }}
 className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
 isActive 
 ? 'bg-accent/10 text-accent font-bold shadow-sm shadow-accent/5' 
 : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 font-medium'
 }`}
 >
 <item.icon className={`w-5 h-5 ${isActive ? 'text-accent' : 'text-muted-foreground'}`} />
 {item.label}
 </button>
 );
 })}
 </nav>
 </div>

 <div className="p-6 border-t border-border w-64">
 <nav className="space-y-1">
 <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
 <Settings className="w-5 h-5"/>
 Settings
 </button>
 <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
 <HelpCircle className="w-5 h-5"/>
 Help & Support
 </button>
 </nav>
 </div>
 </motion.aside>
 )}
 </AnimatePresence>
 </>
 );
}
