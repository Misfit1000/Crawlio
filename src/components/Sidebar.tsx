import { motion, AnimatePresence } from 'motion/react';
import { LayoutDashboard, Search, BarChart3, Link, Settings, HelpCircle, X, User } from 'lucide-react';
import { TabType } from '../App';

const navItems: { icon: any, label: string, id: TabType }[] = [
  { icon: LayoutDashboard, label: 'Dashboard', id: 'dashboard' },
  { icon: Search, label: 'Keyword Magic Tool', id: 'keyword-magic' },
  { icon: BarChart3, label: 'Position Tracking', id: 'position-tracking' },
  { icon: Link, label: 'Backlink Analytics', id: 'backlink-analytics' },
  { icon: User, label: 'User Profile', id: 'user-profile' },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
}

export default function Sidebar({ isOpen, onClose, activeTab, setActiveTab }: SidebarProps) {
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
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-40 lg:hidden"
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
            className="fixed lg:sticky top-[73px] left-0 z-50 h-[calc(100vh-73px)] bg-slate-900 border-r border-slate-800 flex flex-col overflow-hidden whitespace-nowrap"
          >
            <div className="p-6 flex-1 w-64">
              <div className="flex items-center justify-between mb-4">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  SEO Toolkit
                </div>
                <button onClick={onClose} className="lg:hidden p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <nav className="space-y-1">
                {navItems.map((item) => {
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveTab(item.id);
                        if (window.innerWidth < 1024) onClose();
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                        isActive 
                          ? 'bg-blue-500/10 text-blue-400 font-medium' 
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      <item.icon className={`w-5 h-5 ${isActive ? 'text-blue-400' : 'text-slate-400'}`} />
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="p-6 border-t border-slate-800 w-64">
              <nav className="space-y-1">
                <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors">
                  <Settings className="w-5 h-5 text-slate-400" />
                  Settings
                </button>
                <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors">
                  <HelpCircle className="w-5 h-5 text-slate-400" />
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
