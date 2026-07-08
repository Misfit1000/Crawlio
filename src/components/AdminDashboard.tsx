import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users, Activity, Settings, Database, ShieldAlert, Loader2, Search, Edit2, Trash2, Plus, X, MoreVertical, Shield, Folder, Key, Globe } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getAllUsers, updateUserRole, deleteUserDoc, getAllProjects, getAllKeywords, getAllCompetitors, deleteAnyDocument, getPlatformSettings, updatePlatformSettings } from '../services/supabaseDataService';

type AdminTab = 'overview' | 'users' | 'content' | 'settings';

export default function AdminDashboard() {
 const { user } = useAuth();
 const [activeTab, setActiveTab] = useState<AdminTab>('overview');
 
 if (!user || user.role !== 'admin') {
 return (
 <div className="flex flex-col items-center justify-center py-32 space-y-6">
 <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center shadow-sm">
 <ShieldAlert className="w-8 h-8 text-red-500"/>
 </div>
 <div className="text-center">
 <h3 className="text-2xl font-bold text-foreground mb-2">Access Denied</h3>
 <p className="text-muted-foreground max-w-md mb-6">You do not have permission to view this page.</p>
 {!user && (
   <button
     onClick={() => window.dispatchEvent(new CustomEvent('open-login'))}
     className="px-6 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
   >
     Log In
   </button>
 )}
 </div>
 </div>
 );
 }

 return (
 <div className="flex flex-col md:flex-row gap-6 min-h-[80vh]">
 {/* Admin Sidebar */}
 <div className="w-full md:w-64 shrink-0 space-y-2">
 <div className="px-4 py-3 mb-4 bg-card border border-border rounded-xl shadow-lg">
 <h2 className="font-bold text-foreground flex items-center gap-2">
 <Shield className="w-5 h-5 text-accent"/>
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
 className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left font-bold text-sm ${
 isActive 
 ? 'bg-accent/10 text-accent shadow-sm border border-accent/20' 
 : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
 }`}
 >
 <Icon className="w-5 h-5"/>
 <span>{item.label}</span>
 </button>
 );
 })}
 </nav>
 </div>

 {/* Admin Content Area */}
 <div className="flex-1 bg-card border border-border rounded-3xl p-6 overflow-hidden shadow-lg">
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
 const [stats, setStats] = useState({ users: 0, projects: 0, keywords: 0 });
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 const loadStats = async () => {
 try {
 const [users, projects, keywords] = await Promise.all([
 getAllUsers(),
 getAllProjects(),
 getAllKeywords()
 ]);
 setStats({
 users: users.length,
 projects: projects.length,
 keywords: keywords.length
 });
 } catch (error) {
 console.error("Failed to load stats", error);
 } finally {
 setLoading(false);
 }
 };
 loadStats();
 }, []);

 if (loading) {
 return (
 <div className="flex justify-center py-12">
 <Loader2 className="w-8 h-8 text-accent animate-spin"/>
 </div>
 );
 }

 return (
 <div className="space-y-6">
 <h3 className="text-2xl font-bold text-foreground">Dashboard Overview</h3>
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 <div className="bg-card border border-border rounded-2xl p-5 shadow-lg hover:shadow-accent/10 hover:border-accent/30 transition-all group">
 <div className="text-muted-foreground text-xs font-bold mb-1">Total Users</div>
 <div className="text-4xl font-bold text-foreground drop-shadow-sm">{stats.users}</div>
 <div className="text-emerald-500 text-xs mt-2 flex items-center gap-1 font-bold">
 <Activity className="w-3 h-3"/> Live
 </div>
 </div>
 <div className="bg-card border border-border rounded-2xl p-5 shadow-lg hover:shadow-purple-500/10 hover:border-purple-500/30 transition-all group">
 <div className="text-muted-foreground text-xs font-bold mb-1">Active Projects</div>
 <div className="text-4xl font-bold text-foreground drop-shadow-sm">{stats.projects}</div>
 <div className="text-emerald-500 text-xs mt-2 flex items-center gap-1 font-bold">
 <Activity className="w-3 h-3"/> Live
 </div>
 </div>
 <div className="bg-card border border-border rounded-2xl p-5 shadow-lg hover:shadow-emerald-500/10 hover:border-emerald-500/30 transition-all group">
 <div className="text-muted-foreground text-xs font-bold mb-1">Saved Keywords</div>
 <div className="text-4xl font-bold text-emerald-500 drop-shadow-sm">{stats.keywords}</div>
 <div className="text-muted-foreground text-xs mt-2">Across all users</div>
 </div>
 </div>
 
 <div className="bg-card border border-border rounded-2xl p-6 mt-6 shadow-lg">
 <h4 className="font-bold text-foreground mb-4">System Status</h4>
 <div className="space-y-4">
 <div className="flex items-center gap-4 pb-4 border-b border-border/50">
 <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500 shadow-sm">
 <Shield className="w-5 h-5"/>
 </div>
 <div>
 <p className="text-sm font-bold text-foreground">Database Connection</p>
 <p className="text-xs text-muted-foreground">Supabase is connected and operational</p>
 </div>
 <div className="ml-auto text-xs text-emerald-500 font-bold">Healthy</div>
 </div>
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
 <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/>
 <input
 type="text"
 placeholder="Search users..."
 value={searchTerm}
 onChange={(e) => setSearchTerm(e.target.value)}
 className="w-full bg-background/50 border border-border rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
 />
 </div>
 </div>

 {loading ? (
 <div className="flex justify-center py-12">
 <Loader2 className="w-8 h-8 text-accent animate-spin"/>
 </div>
 ) : (
 <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-lg">
 <div className="overflow-x-auto">
 <table className="w-full text-sm text-left">
 <thead className="text-xs text-muted-foreground font-bold bg-muted/20 border-b border-border">
 <tr>
 <th className="px-6 py-4">User</th>
 <th className="px-6 py-4">Role</th>
 <th className="px-6 py-4">Joined</th>
 <th className="px-6 py-4 text-right">Actions</th>
 </tr>
 </thead>
 <tbody>
 {filteredUsers.map((u) => (
 <tr key={u.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
 <td className="px-6 py-4">
 <div className="flex items-center gap-3">
 <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold shadow-sm">
 {u.displayName?.charAt(0)?.toUpperCase() || u.email?.charAt(0)?.toUpperCase() || '?'}
 </div>
 <div>
 <div className="font-bold text-foreground">{u.displayName || 'No Name'}</div>
 <div className="text-xs text-muted-foreground">{u.email}</div>
 </div>
 </div>
 </td>
 <td className="px-6 py-4">
 <span className={`inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold border ${
 u.role === 'admin' ? 'bg-purple-500/10 text-purple-500 border-purple-500/20 shadow-sm' :
 u.role === 'staff' ? 'bg-accent/10 text-accent border-accent/20 shadow-sm' :
 'bg-slate-500/10 text-slate-400 border-slate-500/20'
 }`}>
 {u.role || 'member'}
 </span>
 </td>
 <td className="px-6 py-4 text-muted-foreground font-bold">
 {u.createdAt ? new Date(u.createdAt.seconds ? u.createdAt.seconds * 1000 : u.createdAt).toLocaleDateString() : 'Unknown'}
 </td>
 <td className="px-6 py-4 text-right">
 <div className="flex items-center justify-end gap-2">
 <button
 onClick={() => setEditingUser(u)}
 className="p-1.5 text-muted-foreground hover:text-accent hover:bg-accent/10 rounded-md transition-colors"
 title="Edit Role"
 >
 <Edit2 className="w-4 h-4"/>
 </button>
 <button
 onClick={() => handleDeleteUser(u.id)}
 className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors"
 title="Delete User"
 >
 <Trash2 className="w-4 h-4"/>
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
 <h3 className="text-xl font-bold text-foreground">Edit User Role</h3>
 <button onClick={() => setEditingUser(null)} className="text-muted-foreground hover:text-foreground">
 <X className="w-5 h-5"/>
 </button>
 </div>
 <div className="mb-4">
 <p className="text-sm text-muted-foreground mb-1">User: <span className="text-foreground font-bold">{editingUser.email}</span></p>
 </div>
 <div className="space-y-2">
 {['admin', 'staff', 'member'].map(role => (
 <button
 key={role}
 onClick={() => handleRoleChange(editingUser.id, role)}
 className={`w-full text-left px-4 py-3 rounded-xl border ${
 editingUser.role === role 
 ? 'bg-accent/10 border-accent/50 text-accent shadow-sm' 
 : 'bg-background border-border text-foreground hover:bg-muted/50'
 } transition-colors font-bold text-sm`}
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
 const [activeTab, setActiveTab] = useState<'projects' | 'keywords' | 'competitors'>('projects');
 const [data, setData] = useState<any[]>([]);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 loadData();
 }, [activeTab]);

 const loadData = async () => {
 setLoading(true);
 try {
 let result: any[] = [];
 if (activeTab === 'projects') result = await getAllProjects();
 if (activeTab === 'keywords') result = await getAllKeywords();
 if (activeTab === 'competitors') result = await getAllCompetitors();
 setData(result);
 } catch (error) {
 console.error("Failed to load content", error);
 } finally {
 setLoading(false);
 }
 };

 const handleDelete = async (item: any) => {
 if (!window.confirm("Are you sure you want to delete this item?")) return;
 try {
 const path = `users/${item.userId}/${activeTab}/${item.id}`;
 await deleteAnyDocument(path);
 setData(data.filter(d => d.id !== item.id));
 } catch (error) {
 console.error("Failed to delete item", error);
 }
 };

 return (
 <div className="space-y-6">
 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
 <h3 className="text-2xl font-bold text-foreground">Content Management</h3>
 <div className="flex flex-wrap bg-muted/50 p-1 rounded-xl gap-1 border border-border">
 <button 
 onClick={() => setActiveTab('projects')}
 className={`px-4 py-1.5 text-sm font-bold rounded-lg transition-colors ${activeTab === 'projects' ? 'bg-accent/20 text-accent shadow-sm border border-accent/30' : 'text-muted-foreground hover:text-foreground'}`}
 >
 Projects
 </button>
 <button 
 onClick={() => setActiveTab('keywords')}
 className={`px-4 py-1.5 text-sm font-bold rounded-lg transition-colors ${activeTab === 'keywords' ? 'bg-accent/20 text-accent shadow-sm border border-accent/30' : 'text-muted-foreground hover:text-foreground'}`}
 >
 Keywords
 </button>
 <button 
 onClick={() => setActiveTab('competitors')}
 className={`px-4 py-1.5 text-sm font-bold rounded-lg transition-colors ${activeTab === 'competitors' ? 'bg-accent/20 text-accent shadow-sm border border-accent/30' : 'text-muted-foreground hover:text-foreground'}`}
 >
 Competitors
 </button>
 </div>
 </div>

 {loading ? (
 <div className="flex justify-center py-12">
 <Loader2 className="w-8 h-8 text-accent animate-spin"/>
 </div>
 ) : (
 <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-lg">
 <div className="overflow-x-auto">
 <table className="w-full text-sm text-left">
 <thead className="text-xs text-muted-foreground font-bold bg-muted/20 border-b border-border">
 <tr>
 <th className="px-6 py-4">ID</th>
 <th className="px-6 py-4">User ID</th>
 <th className="px-6 py-4">Details</th>
 <th className="px-6 py-4 text-right">Actions</th>
 </tr>
 </thead>
 <tbody>
 {data.map((item) => (
 <tr key={item.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
 <td className="px-6 py-4 text-xs text-muted-foreground font-bold">{item.id.slice(0, 8)}...</td>
 <td className="px-6 py-4 text-xs text-muted-foreground font-bold">{item.userId?.slice(0, 8)}...</td>
 <td className="px-6 py-4">
 {activeTab === 'projects' && <span className="font-bold text-foreground">{item.name}</span>}
 {activeTab === 'keywords' && <span className="font-bold text-foreground">{item.term}</span>}
 {activeTab === 'competitors' && <span className="font-bold text-foreground">{item.domainUrl}</span>}
 </td>
 <td className="px-6 py-4 text-right">
 <button
 onClick={() => handleDelete(item)}
 className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors"
 title="Delete Item"
 >
 <Trash2 className="w-4 h-4"/>
 </button>
 </td>
 </tr>
 ))}
 {data.length === 0 && (
 <tr>
 <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
 No {activeTab} found.
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </div>
 )}
 </div>
 );
}

function AdminSettings() {
 const [settings, setSettings] = useState({
 platformName: 'SEOIntel Audit',
 supportEmail: 'support@keywordintelligence.com',
 requireEmailVerification: false,
 publicRegistration: true
 });
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);

 useEffect(() => {
 const loadSettings = async () => {
 try {
 const data = await getPlatformSettings();
 setSettings(data as any);
 } catch (error) {
 console.error("Failed to load settings", error);
 } finally {
 setLoading(false);
 }
 };
 loadSettings();
 }, []);

 const handleSave = async () => {
 setSaving(true);
 try {
 await updatePlatformSettings(settings);
 alert('Settings saved successfully!');
 } catch (error) {
 console.error("Failed to save settings", error);
 alert('Failed to save settings.');
 } finally {
 setSaving(false);
 }
 };

 if (loading) {
 return (
 <div className="flex justify-center py-12">
 <Loader2 className="w-8 h-8 text-accent animate-spin"/>
 </div>
 );
 }

 return (
 <div className="space-y-6">
 <h3 className="text-2xl font-bold text-foreground">Platform Settings</h3>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 <div className="bg-card border border-border rounded-2xl p-6 shadow-lg">
 <h4 className="font-bold text-foreground mb-4 flex items-center gap-2">
 <Settings className="w-5 h-5 text-accent"/>
 General Configuration
 </h4>
 <div className="space-y-4">
 <div>
 <label className="block text-sm font-bold text-muted-foreground mb-1">Platform Name</label>
 <input 
 type="text"
 value={settings.platformName} 
 onChange={(e) => setSettings({...settings, platformName: e.target.value})}
 className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
 />
 </div>
 <div>
 <label className="block text-sm font-bold text-muted-foreground mb-1">Support Email</label>
 <input 
 type="email"
 value={settings.supportEmail} 
 onChange={(e) => setSettings({...settings, supportEmail: e.target.value})}
 className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
 />
 </div>
 <button 
 onClick={handleSave}
 disabled={saving}
 className="px-6 py-2 bg-accent text-accent-foreground hover:bg-accent/90 rounded-xl text-sm font-bold transition-all disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-accent/20"
 >
 {saving && <Loader2 className="w-4 h-4 animate-spin"/>}
 Save Settings
 </button>
 </div>
 </div>
 
 <div className="bg-card border border-border rounded-2xl p-6 shadow-lg">
 <h4 className="font-bold text-foreground mb-4 flex items-center gap-2">
 <ShieldAlert className="w-5 h-5 text-red-500"/>
 Security & Access
 </h4>
 <div className="space-y-4">
 <div className="flex items-center justify-between p-4 bg-background/50 border border-border rounded-xl">
 <div>
 <div className="font-bold text-foreground text-sm">Require Email Verification</div>
 <div className="text-xs text-muted-foreground">Users must verify email before login</div>
 </div>
 <div 
 onClick={() => setSettings({...settings, requireEmailVerification: !settings.requireEmailVerification})}
 className={`w-12 h-6 rounded-full relative cursor-pointer transition-colors ${settings.requireEmailVerification ? 'bg-accent shadow-sm' : 'bg-slate-600'}`}
 >
 <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings.requireEmailVerification ? 'right-1' : 'left-1'}`}></div>
 </div>
 </div>
 <div className="flex items-center justify-between p-4 bg-background/50 border border-border rounded-xl">
 <div>
 <div className="font-bold text-foreground text-sm">Public Registration</div>
 <div className="text-xs text-muted-foreground">Allow new users to sign up</div>
 </div>
 <div 
 onClick={() => setSettings({...settings, publicRegistration: !settings.publicRegistration})}
 className={`w-12 h-6 rounded-full relative cursor-pointer transition-colors ${settings.publicRegistration ? 'bg-accent shadow-sm' : 'bg-slate-600'}`}
 >
 <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings.publicRegistration ? 'right-1' : 'left-1'}`}></div>
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>
 );
}
