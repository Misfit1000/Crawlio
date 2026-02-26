import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Bookmark, Plus, Loader2, Trash2, X, Search } from 'lucide-react';
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
  const [projectId, setProjectId] = useState('');

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
    } catch (error) {
      console.error("Failed to load saved keywords", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !term.trim()) return;

    setIsSubmitting(true);
    try {
      // Generate mock data for search volume and KD
      const searchVolume = Math.floor(Math.random() * 10000) + 100;
      const keywordDifficulty = Math.floor(Math.random() * 100);

      const keywordData: any = {
        term: term.trim(), 
        searchVolume,
        keywordDifficulty
      };
      
      if (projectId) {
        keywordData.projectId = projectId;
      }

      const newKeyword = await addSavedKeyword(user.id, keywordData);
      setKeywords([newKeyword, ...keywords]);
      setIsModalOpen(false);
      setTerm('');
      setProjectId('');
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Bookmark className="w-5 h-5 text-emerald-500" />
          Saved Keywords
        </h3>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Keyword
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
        </div>
      ) : keywords.length === 0 ? (
        <div className="bg-card/30 border border-border border-dashed rounded-2xl p-8 text-center">
          <Bookmark className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-50" />
          <p className="text-muted-foreground">No saved keywords yet. Track your target terms here.</p>
        </div>
      ) : (
        <div className="bg-card/50 backdrop-blur-sm border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b border-border">
                <tr>
                  <th className="px-6 py-4 font-semibold">Keyword</th>
                  <th className="px-6 py-4 font-semibold">Volume</th>
                  <th className="px-6 py-4 font-semibold">KD %</th>
                  <th className="px-6 py-4 font-semibold">Project</th>
                  <th className="px-6 py-4 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {keywords.map((kw) => (
                    <motion.tr
                      key={kw.id}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="border-b border-border/50 hover:bg-muted/30 transition-colors group"
                    >
                      <td className="px-6 py-4 font-medium text-foreground flex items-center gap-2">
                        <Search className="w-3.5 h-3.5 text-muted-foreground" />
                        {kw.term}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">{kw.searchVolume.toLocaleString()}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full ${
                                kw.keywordDifficulty > 70 ? 'bg-red-500' : 
                                kw.keywordDifficulty > 40 ? 'bg-yellow-500' : 'bg-emerald-500'
                              }`}
                              style={{ width: `${kw.keywordDifficulty}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium text-muted-foreground">{kw.keywordDifficulty}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {kw.projectId ? (
                          <span className="inline-flex items-center px-2 py-1 rounded-md bg-blue-500/10 text-blue-400 text-xs font-medium">
                            {getProjectName(kw.projectId)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => handleDelete(kw.id)}
                          className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-md opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
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
                <h3 className="text-lg font-bold text-foreground">Add Keyword</h3>
                <button onClick={() => setIsModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleAddKeyword} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Keyword Term</label>
                  <input
                    type="text"
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                    placeholder="e.g., best seo tools"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Project (Optional)</label>
                  <select
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/50 appearance-none"
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
                    className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !term.trim()}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
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
