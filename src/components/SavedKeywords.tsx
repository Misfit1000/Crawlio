import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Bookmark, Plus, Loader2, Trash2, X, Search, Folder, FolderOpen, ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getSavedKeywords, addSavedKeyword, deleteSavedKeyword, SavedKeyword, getProjects, Project } from '../services/firestoreService';

export default function SavedKeywords() {
 const { user } = useAuth();
 const [keywords, setKeywords] = useState<SavedKeyword[]>([]);
 const [projects, setProjects] = useState<Project[]>([]);
 const [loading, setLoading] = useState(true);
 const [isModalOpen, setIsModalOpen] = useState(false);
 const [isSubmitting, setIsSubmitting] = useState(false);
 
 const [term, setTerm] = useState('');
 const [searchVolume, setSearchVolume] = useState('');
 const [keywordDifficulty, setKeywordDifficulty] = useState('');
 const [cpc, setCpc] = useState('');
 const [intent, setIntent] = useState('');
 const [projectId, setProjectId] = useState('');
 const [groupName, setGroupName] = useState('');

 // Grouping state
 const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['Ungrouped']));

 useEffect(() => {
 if (user) {
 loadData();
 }
 }, [user]);

 const loadData = async () => {
 try {
 if (!user) return;
 const [kwData, projData] = await Promise.all([
 getSavedKeywords(user.id),
 getProjects(user.id)
 ]);
 setKeywords(kwData);
 setProjects(projData);
 
 // Auto-expand all groups initially
 const groups = new Set(kwData.map(k => k.group || 'Ungrouped'));
 setExpandedGroups(groups);
 } catch (error) {
 console.error("Failed to load saved keywords", error);
 } finally {
 setLoading(false);
 }
 };

 const handleAddKeyword = async (e: React.FormEvent) => {
 e.preventDefault();
 if (!user || !term.trim()) return;

 const sv = parseInt(searchVolume, 10);
 const kd = parseInt(keywordDifficulty, 10);
 
 if (isNaN(sv) || sv < 0) {
 alert("Please enter a valid search volume.");
 return;
 }
 
 if (isNaN(kd) || kd < 0 || kd > 100) {
 alert("Please enter a valid keyword difficulty (0-100).");
 return;
 }

 setIsSubmitting(true);
 try {
 const keywordData: any = {
 term: term.trim(), 
 searchVolume: sv,
 keywordDifficulty: kd,
 group: groupName.trim() || 'Ungrouped'
 };
 
 if (cpc) {
 const cpcVal = parseFloat(cpc);
 if (!isNaN(cpcVal) && cpcVal >= 0) {
 keywordData.cpc = cpcVal;
 }
 }
 
 if (intent) {
 keywordData.intent = intent;
 }
 
 if (projectId) {
 keywordData.projectId = projectId;
 }

 const newKeyword = await addSavedKeyword(user.id, keywordData);
 setKeywords([newKeyword, ...keywords]);
 
 // Ensure the group is expanded
 setExpandedGroups(prev => new Set(prev).add(keywordData.group));
 
 setIsModalOpen(false);
 setTerm('');
 setSearchVolume('');
 setKeywordDifficulty('');
 setCpc('');
 setIntent('');
 setProjectId('');
 setGroupName('');
 } catch (error) {
 console.error("Failed to add keyword", error);
 } finally {
 setIsSubmitting(false);
 }
 };

 const handleDelete = async (id: string) => {
 if (!user) return;
 try {
 await deleteSavedKeyword(user.id, id);
 setKeywords(keywords.filter(k => k.id !== id));
 } catch (error) {
 console.error("Failed to delete keyword", error);
 }
 };

 const getProjectName = (id?: string) => {
 if (!id) return '-';
 const project = projects.find(p => p.id === id);
 return project ? project.name : '-';
 };

 const toggleGroup = (group: string) => {
 setExpandedGroups(prev => {
 const next = new Set(prev);
 if (next.has(group)) {
 next.delete(group);
 } else {
 next.add(group);
 }
 return next;
 });
 };

 // Group keywords
 const groupedKeywords = useMemo(() => {
 const groups: Record<string, SavedKeyword[]> = {};
 keywords.forEach(kw => {
 const group = kw.group || 'Ungrouped';
 if (!groups[group]) {
 groups[group] = [];
 }
 groups[group].push(kw);
 });
 
 // Sort groups: Ungrouped last, others alphabetically
 return Object.entries(groups).sort(([a], [b]) => {
 if (a === 'Ungrouped') return 1;
 if (b === 'Ungrouped') return -1;
 return a.localeCompare(b);
 });
 }, [keywords]);

 // Get unique existing groups for the datalist
 const existingGroups = useMemo(() => {
 const groups = new Set(keywords.map(k => k.group).filter(Boolean));
 groups.delete('Ungrouped');
 return Array.from(groups);
 }, [keywords]);

 return (
 <div className="space-y-6">
 <div className="flex items-center justify-between">
 <h3 className="text-2xl font-bold text-foreground flex items-center gap-2">
 <Bookmark className="w-6 h-6 text-accent"/>
 Saved Keywords
 </h3>
 <button
 onClick={() => setIsModalOpen(true)}
 className="flex items-center gap-2 px-4 py-2 bg-accent/10 hover:bg-accent/20 text-accent border border-accent/20 shadow-sm rounded-xl text-sm font-bold transition-colors"
 >
 <Plus className="w-4 h-4"/>
 Add Keyword
 </button>
 </div>

 {loading ? (
 <div className="flex justify-center py-8">
 <Loader2 className="w-8 h-8 text-accent animate-spin"/>
 </div>
 ) : keywords.length === 0 ? (
 <div className="bg-card/30 border border-border border-dashed rounded-2xl p-8 text-center">
 <Bookmark className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-50"/>
 <p className="text-muted-foreground">No saved keywords yet. Track your target terms here.</p>
 </div>
 ) : (
 <div className="space-y-4">
 {groupedKeywords.map(([group, groupKeywords]) => {
 const isExpanded = expandedGroups.has(group);
 
 return (
 <div key={group} className="bg-card border border-border rounded-xl overflow-hidden shadow-lg">
 {/* Group Header */}
 <button
 onClick={() => toggleGroup(group)}
 className="w-full flex items-center justify-between p-4 bg-card hover:bg-muted/50 transition-colors text-left"
 >
 <div className="flex items-center gap-3">
 {isExpanded ? (
 <FolderOpen className="w-5 h-5 text-accent"/>
 ) : (
 <Folder className="w-5 h-5 text-accent"/>
 )}
 <span className="font-bold text-foreground">{group}</span>
 <span className="px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-xs font-bold text-accent">
 {groupKeywords.length}
 </span>
 </div>
 {isExpanded ? (
 <ChevronDown className="w-5 h-5 text-muted-foreground"/>
 ) : (
 <ChevronRight className="w-5 h-5 text-muted-foreground"/>
 )}
 </button>

 {/* Group Content */}
 <AnimatePresence initial={false}>
 {isExpanded && (
 <motion.div
 initial={{ height: 0, opacity: 0 }}
 animate={{ height: 'auto', opacity: 1 }}
 exit={{ height: 0, opacity: 0 }}
 transition={{ duration: 0.2 }}
 className="overflow-hidden"
 >
 <div className="overflow-x-auto border-t border-border">
 <table className="w-full text-sm text-left">
 <thead className="text-xs text-muted-foreground font-bold bg-muted/20 border-b border-border">
 <tr>
 <th className="px-6 py-3">Keyword</th>
 <th className="px-6 py-3">Volume</th>
 <th className="px-6 py-3">KD %</th>
 <th className="px-6 py-3">CPC</th>
 <th className="px-6 py-3">Intent</th>
 <th className="px-6 py-3">Project</th>
 <th className="px-6 py-3 text-right">Actions</th>
 </tr>
 </thead>
 <tbody>
 {groupKeywords.map((kw) => (
 <tr
 key={kw.id}
 className="border-b border-border/50 hover:bg-muted/30 transition-colors group last:border-0"
 >
 <td className="px-6 py-3 font-bold text-foreground flex items-center gap-2">
 <Search className="w-3.5 h-3.5 text-accent"/>
 {kw.term}
 </td>
 <td className="px-6 py-3 text-muted-foreground font-bold">{kw.searchVolume.toLocaleString()}</td>
 <td className="px-6 py-3">
 <div className="flex items-center gap-2">
 <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]">
 <div 
 className={`h-full rounded-full shadow-sm ${
 kw.keywordDifficulty > 70 ? 'bg-orange-500 shadow-orange-500/50' : 
 kw.keywordDifficulty > 40 ? 'bg-amber-500 shadow-amber-500/50' : 'bg-emerald-500 shadow-[#00FF00]/50'
 }`}
 style={{ width: `${kw.keywordDifficulty}%` }}
 />
 </div>
 <span className="text-xs font-bold text-foreground">{kw.keywordDifficulty}</span>
 </div>
 </td>
 <td className="px-6 py-3 text-muted-foreground font-bold">
 {kw.cpc !== undefined ? `$${kw.cpc.toFixed(2)}` : '-'}
 </td>
 <td className="px-6 py-3">
 {kw.intent ? (
 <span className={`inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold border ${
 kw.intent === 'informational' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' :
 kw.intent === 'commercial' ? 'bg-purple-500/10 text-purple-500 border-purple-500/20' :
 kw.intent === 'transactional' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
 'bg-gray-500/10 text-gray-500 border-gray-500/20'
 }`}>
 {kw.intent}
 </span>
 ) : (
 <span className="text-muted-foreground/50">-</span>
 )}
 </td>
 <td className="px-6 py-3 text-muted-foreground">
 {kw.projectId ? (
 <span className="inline-flex items-center px-2 py-1 rounded-md bg-accent/10 text-accent border border-accent/20 text-[10px] font-bold">
 {getProjectName(kw.projectId)}
 </span>
 ) : (
 <span className="text-muted-foreground/50">-</span>
 )}
 </td>
 <td className="px-6 py-3 text-right">
 <button
 onClick={() => handleDelete(kw.id)}
 className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-md opacity-0 group-hover:opacity-100 transition-all"
 >
 <Trash2 className="w-4 h-4"/>
 </button>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </motion.div>
 )}
 </AnimatePresence>
 </div>
 );
 })}
 </div>
 )}

 {/* Modal */}
 <AnimatePresence>
 {isModalOpen && (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
 <motion.div
 initial={{ opacity: 0, y: 20 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0, y: 20 }}
 className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl"
 >
 <div className="flex items-center justify-between mb-4">
 <h3 className="text-2xl font-bold text-foreground">Add Keyword</h3>
 <button onClick={() => setIsModalOpen(false)} className="text-muted-foreground hover:text-foreground">
 <X className="w-5 h-5"/>
 </button>
 </div>
 <form onSubmit={handleAddKeyword} className="space-y-4">
 <div>
 <label className="block text-sm font-bold text-muted-foreground mb-1">Keyword Term</label>
 <input
 type="text"
 value={term}
 onChange={(e) => setTerm(e.target.value)}
 className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
 placeholder="e.g., best seo tools"
 required
 autoFocus
 />
 </div>

 <div className="grid grid-cols-2 gap-4">
 <div>
 <label className="block text-sm font-bold text-muted-foreground mb-1">Search Volume</label>
 <input
 type="number"
 min="0"
 value={searchVolume}
 onChange={(e) => setSearchVolume(e.target.value)}
 className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
 placeholder="e.g., 1000"
 required
 />
 </div>
 <div>
 <label className="block text-sm font-bold text-muted-foreground mb-1">KD (0-100)</label>
 <input
 type="number"
 min="0"
 max="100"
 value={keywordDifficulty}
 onChange={(e) => setKeywordDifficulty(e.target.value)}
 className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
 placeholder="e.g., 45"
 required
 />
 </div>
 </div>

 <div className="grid grid-cols-2 gap-4">
 <div>
 <label className="block text-sm font-bold text-muted-foreground mb-1">CPC ($) (Optional)</label>
 <input
 type="number"
 min="0"
 step="0.01"
 value={cpc}
 onChange={(e) => setCpc(e.target.value)}
 className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
 placeholder="e.g., 2.50"
 />
 </div>
 <div>
 <label className="block text-sm font-bold text-muted-foreground mb-1">Intent (Optional)</label>
 <select
 value={intent}
 onChange={(e) => setIntent(e.target.value)}
 className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent appearance-none"
 >
 <option value="">Select Intent</option>
 <option value="informational">Informational</option>
 <option value="navigational">Navigational</option>
 <option value="commercial">Commercial</option>
 <option value="transactional">Transactional</option>
 </select>
 </div>
 </div>
 
 <div>
 <label className="block text-sm font-bold text-muted-foreground mb-1">Group (Optional)</label>
 <input
 type="text"
 value={groupName}
 onChange={(e) => setGroupName(e.target.value)}
 list="existing-groups"
 className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
 placeholder="e.g., Competitors, High Intent"
 />
 <datalist id="existing-groups">
 {existingGroups.map(g => (
 <option key={g} value={g} />
 ))}
 </datalist>
 </div>

 <div>
 <label className="block text-sm font-bold text-muted-foreground mb-1">Project (Optional)</label>
 <select
 value={projectId}
 onChange={(e) => setProjectId(e.target.value)}
 className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent appearance-none"
 >
 <option value="">No Project</option>
 {projects.map(p => (
 <option key={p.id} value={p.id}>{p.name}</option>
 ))}
 </select>
 </div>
 <div className="flex justify-end gap-3 pt-2">
 <button
 type="button"
 onClick={() => setIsModalOpen(false)}
 className="px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
 >
 Cancel
 </button>
 <button
 type="submit"
 disabled={isSubmitting || !term.trim()}
 className="flex items-center gap-2 px-6 py-2 bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-50 rounded-xl text-sm font-bold transition-all shadow-lg shadow-accent/20"
 >
 {isSubmitting && <Loader2 className="w-4 h-4 animate-spin"/>}
 Save Keyword
 </button>
 </div>
 </form>
 </motion.div>
 </div>
 )}
 </AnimatePresence>
 </div>
 );
}
