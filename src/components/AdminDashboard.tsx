import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users, Activity, Settings, Database, ShieldAlert, Loader2, Search, Edit2, Trash2, Plus, X, MoreVertical, Shield } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getAllUsers, updateUserRole, deleteUserDoc } from '../services/firestoreService';

type AdminTab = 'overview' | 'users' | 'content' | 'settings';

export default function AdminDashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  
  if (!user || user.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center py-32 space-y-6">
        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center">
          <ShieldAlert className="w-8 h-8 text-red-500" />
        </div>
        <div className="text-center">
          <h3 className="text-xl font-bold text-foreground mb-2">Access Denied</h3>
          <p className="text-muted-foreground max-w-md">You do not have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row gap-6 min-h-[80vh]">
      {/* Admin Sidebar */}
      <div className="w-full md:w-64 shrink-0 space-y-2">
        <div className="px-4 py-3 mb-4 bg-card/50 backdrop-blur-sm border border-border rounded-xl">
          <h2 className="font-bold text-foreground flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-500" />
            Admin Panel
          </h2>
          <p className="text-xs text-muted-foreground mt-1">Manage users and content</p>
        </div>
        
        <nav className="space-y-1">
          {[
            { id: 'overview', label: 'Overview', icon: Activity },
            { id: 'users', label: 'Users Management', icon: Users },
            { id: 'content', label: 'Content Data', icon: Database },
            { id: 'settings', label: 'Settings', icon: Settings },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as AdminTab)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left ${
                  isActive 
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' 
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Admin Content Area */}
      <div className="flex-1 bg-card/30 backdrop-blur-sm border border-border rounded-2xl p-6 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="h-full"
          >
            {activeTab === 'overview' && <AdminOverview />}
            {activeTab === 'users' && <AdminUsers />}
            {activeTab === 'content' && <AdminContent />}
            {activeTab === 'settings' && <AdminSettings />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function AdminOverview() {
  return (
    <div className="space-y-6">
      <h3 className="text-2xl font-bold text-foreground">Dashboard Overview</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="text-muted-foreground text-sm font-medium mb-1">Total Users</div>
          <div className="text-3xl font-bold text-foreground">1,248</div>
          <div className="text-emerald-500 text-xs mt-2 flex items-center gap-1">
            <Activity className="w-3 h-3" /> +12% this week
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="text-muted-foreground text-sm font-medium mb-1">Active Projects</div>
          <div className="text-3xl font-bold text-foreground">342</div>
          <div className="text-emerald-500 text-xs mt-2 flex items-center gap-1">
            <Activity className="w-3 h-3" /> +5% this week
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="text-muted-foreground text-sm font-medium mb-1">System Status</div>
          <div className="text-3xl font-bold text-emerald-500">Healthy</div>
          <div className="text-muted-foreground text-xs mt-2">All services operational</div>
        </div>
      </div>
      
      <div className="bg-card border border-border rounded-xl p-6 mt-6">
        <h4 className="font-semibold text-foreground mb-4">Recent Activity</h4>
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-4 pb-4 border-b border-border/50 last:border-0 last:pb-0">
              <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">New user registered</p>
                <p className="text-xs text-muted-foreground">user{i}@example.com joined the platform</p>
              </div>
              <div className="ml-auto text-xs text-muted-foreground">{i}h ago</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdminUsers() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingUser, setEditingUser] = useState<any | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const data = await getAllUsers();
      setUsers(data);
    } catch (error) {
      console.error("Failed to load users", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await updateUserRole(userId, newRole);
      setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
      setEditingUser(null);
    } catch (error) {
      console.error("Failed to update role", error);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm("Are you sure you want to delete this user?")) return;
    try {
      await deleteUserDoc(userId);
      setUsers(users.filter(u => u.id !== userId));
    } catch (error) {
      console.error("Failed to delete user", error);
    }
  };

  const filteredUsers = users.filter(u => 
    u.email?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.displayName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h3 className="text-2xl font-bold text-foreground">Users Management</h3>
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search users..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-background border border-border rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b border-border">
                <tr>
                  <th className="px-6 py-4 font-semibold">User</th>
                  <th className="px-6 py-4 font-semibold">Role</th>
                  <th className="px-6 py-4 font-semibold">Joined</th>
                  <th className="px-6 py-4 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-500 font-bold">
                          {u.displayName?.charAt(0)?.toUpperCase() || u.email?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <div className="font-medium text-foreground">{u.displayName || 'No Name'}</div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${
                        u.role === 'admin' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
                        u.role === 'staff' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                        'bg-slate-500/10 text-slate-400 border-slate-500/20'
                      }`}>
                        {u.role || 'member'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {u.createdAt ? new Date(u.createdAt.seconds * 1000).toLocaleDateString() : 'Unknown'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setEditingUser(u)}
                          className="p-1.5 text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10 rounded-md transition-colors"
                          title="Edit Role"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteUser(u.id)}
                          className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors"
                          title="Delete User"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Role Modal */}
      <AnimatePresence>
        {editingUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-foreground">Edit User Role</h3>
                <button onClick={() => setEditingUser(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="mb-4">
                <p className="text-sm text-muted-foreground mb-1">User: <span className="text-foreground font-medium">{editingUser.email}</span></p>
              </div>
              <div className="space-y-2">
                {['admin', 'staff', 'member'].map(role => (
                  <button
                    key={role}
                    onClick={() => handleRoleChange(editingUser.id, role)}
                    className={`w-full text-left px-4 py-3 rounded-xl border ${
                      editingUser.role === role 
                        ? 'bg-blue-500/10 border-blue-500/50 text-blue-500' 
                        : 'bg-background border-border text-foreground hover:bg-muted/50'
                    } transition-colors capitalize font-medium`}
                  >
                    {role}
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AdminContent() {
  return (
    <div className="space-y-6">
      <h3 className="text-2xl font-bold text-foreground">Content Management</h3>
      <div className="bg-card border border-border rounded-xl p-8 text-center">
        <Database className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
        <h4 className="text-lg font-medium text-foreground mb-2">Data Explorer</h4>
        <p className="text-muted-foreground max-w-md mx-auto mb-6">
          View and manage all user-generated content including keyword projects, saved keywords, and tracked competitors across the platform.
        </p>
        <button className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-colors">
          Browse All Data
        </button>
      </div>
    </div>
  );
}

function AdminSettings() {
  return (
    <div className="space-y-6">
      <h3 className="text-2xl font-bold text-foreground">Platform Settings</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-6">
          <h4 className="font-semibold text-foreground mb-4 flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-500" />
            General Configuration
          </h4>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Platform Name</label>
              <input type="text" defaultValue="KeywordIntel" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground" />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Support Email</label>
              <input type="email" defaultValue="support@keywordintel.com" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground" />
            </div>
            <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">
              Save Settings
            </button>
          </div>
        </div>
        
        <div className="bg-card border border-border rounded-xl p-6">
          <h4 className="font-semibold text-foreground mb-4 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-500" />
            Security & Access
          </h4>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-background border border-border rounded-lg">
              <div>
                <div className="font-medium text-foreground text-sm">Require Email Verification</div>
                <div className="text-xs text-muted-foreground">Users must verify email before login</div>
              </div>
              <div className="w-10 h-5 bg-blue-600 rounded-full relative cursor-pointer">
                <div className="absolute right-1 top-1 w-3 h-3 bg-white rounded-full"></div>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-background border border-border rounded-lg">
              <div>
                <div className="font-medium text-foreground text-sm">Public Registration</div>
                <div className="text-xs text-muted-foreground">Allow new users to sign up</div>
              </div>
              <div className="w-10 h-5 bg-blue-600 rounded-full relative cursor-pointer">
                <div className="absolute right-1 top-1 w-3 h-3 bg-white rounded-full"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
