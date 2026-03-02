import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Folder, Plus, Loader2, Trash2, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getProjects, addProject, deleteProject, Project } from '../services/firestoreService';

export default function KeywordProjects() {
 const { user } = useAuth();
 const [projects, setProjects] = useState<Project[]>([]);
 const [loading, setLoading] = useState(true);
 const [isModalOpen, setIsModalOpen] = useState(false);
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [name, setName] = useState('');
 const [description, setDescription] = useState('');

 useEffect(() => {
 if (user) {
 loadProjects();
 }
 }, [user]);

 const loadProjects = async () => {
 try {
 if (!user) return;
 const data = await getProjects(user.id);
 setProjects(data);
 } catch (error) {
 console.error("Failed to load projects", error);
 } finally {
 setLoading(false);
 }
 };

 const handleAddProject = async (e: React.FormEvent) => {
 e.preventDefault();
 if (!user || !name.trim()) return;

 setIsSubmitting(true);
 try {
 const projectData: any = {
 name: name.trim()
 };
 
 if (description.trim()) {
 projectData.description = description.trim();
 }

 const newProject = await addProject(user.id, projectData);
 setProjects([newProject, ...projects]);
 setIsModalOpen(false);
 setName('');
 setDescription('');
 } catch (error) {
 console.error("Failed to add project", error);
 } finally {
 setIsSubmitting(false);
 }
 };

 const handleDelete = async (id: string) => {
 if (!user) return;
 try {
 await deleteProject(user.id, id);
 setProjects(projects.filter(p => p.id !== id));
 } catch (error) {
 console.error("Failed to delete project", error);
 }
 };

 return (
 <div className="space-y-6">
 <div className="flex items-center justify-between">
 <h3 className="text-2xl font-bold text-foreground flex items-center gap-2">
 <Folder className="w-6 h-6 text-accent"/>
 Keyword Projects
 </h3>
 <button
 onClick={() => setIsModalOpen(true)}
 className="flex items-center gap-2 px-4 py-2 bg-accent/10 hover:bg-accent/20 text-accent border border-accent/20 shadow-sm rounded-xl text-sm font-bold transition-colors"
 >
 <Plus className="w-4 h-4"/>
 New Project
 </button>
 </div>

 {loading ? (
 <div className="flex justify-center py-8">
 <Loader2 className="w-8 h-8 text-accent animate-spin"/>
 </div>
 ) : projects.length === 0 ? (
 <div className="bg-card/30 border border-border border-dashed rounded-2xl p-8 text-center">
 <Folder className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-50"/>
 <p className="text-muted-foreground">No projects yet. Create one to organize your keywords.</p>
 </div>
 ) : (
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
 <AnimatePresence>
 {projects.map(project => (
 <motion.div
 key={project.id}
 initial={{ opacity: 0, scale: 0.95 }}
 animate={{ opacity: 1, scale: 1 }}
 exit={{ opacity: 0, scale: 0.95 }}
 className="bg-card border border-border rounded-xl p-5 relative group shadow-lg hover:shadow-accent/10 hover:border-accent/30 transition-all"
 >
 <button
 onClick={() => handleDelete(project.id)}
 className="absolute top-3 right-3 p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-md opacity-0 group-hover:opacity-100 transition-all"
 >
 <Trash2 className="w-4 h-4"/>
 </button>
 <h4 className="font-semibold text-foreground mb-1 pr-8">{project.name}</h4>
 {project.description && (
 <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{project.description}</p>
 )}
 <div className="text-xs text-muted-foreground mt-auto pt-3 border-t border-border/50">
 Created {new Date(project.createdAt?.seconds ? project.createdAt.seconds * 1000 : project.createdAt).toLocaleDateString()}
 </div>
 </motion.div>
 ))}
 </AnimatePresence>
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
 <h3 className="text-lg font-bold text-foreground">New Project</h3>
 <button onClick={() => setIsModalOpen(false)} className="text-muted-foreground hover:text-foreground">
 <X className="w-5 h-5"/>
 </button>
 </div>
 <form onSubmit={handleAddProject} className="space-y-4">
 <div>
 <label className="block text-sm font-medium text-muted-foreground mb-1">Project Name</label>
 <input
 type="text"
 value={name}
 onChange={(e) => setName(e.target.value)}
 className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
 placeholder="e.g., Q3 Content Strategy"
 required
 autoFocus
 />
 </div>
 <div>
 <label className="block text-sm font-medium text-muted-foreground mb-1">Description (Optional)</label>
 <textarea
 value={description}
 onChange={(e) => setDescription(e.target.value)}
 className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent resize-none h-24"
 placeholder="Brief description of this project..."
 />
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
 disabled={isSubmitting || !name.trim()}
 className="flex items-center gap-2 px-6 py-2 bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-50 rounded-xl text-sm font-bold transition-all shadow-lg shadow-accent/20"
 >
 {isSubmitting && <Loader2 className="w-4 h-4 animate-spin"/>}
 Create Project
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
