import { useState } from"react";
import { useAuth } from"../contexts/AuthContext";
import { motion } from"motion/react";
import { Lock, Mail, Loader2, ShieldCheck, X } from"lucide-react";

export default function Login({ onToggle, onClose }: { onToggle: () => void, onClose?: () => void }) {
 const [email, setEmail] = useState("");
 const [password, setPassword] = useState("");
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const { login } = useAuth();

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 setLoading(true);
 setError(null);
 try {
 await login(email, password);
 } catch (err: any) {
 setError(err.message);
 } finally {
 setLoading(false);
 }
 };

 return (
 <motion.div
 initial={{ opacity: 0, scale: 0.95 }}
 animate={{ opacity: 1, scale: 1 }}
 className="w-full max-w-md bg-card border border-border rounded-3xl p-8 shadow-2xl relative"
 >
 {onClose && (
 <button 
 onClick={onClose}
 className="absolute top-4 right-4 p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full transition-colors"
 >
 <X className="w-5 h-5"/>
 </button>
 )}
 <div className="flex flex-col items-center mb-8">
 <div className="p-3 bg-blue-500/10 rounded-2xl text-blue-500 mb-4">
 <ShieldCheck className="w-8 h-8"/>
 </div>
 <h1 className="text-2xl font-bold text-foreground">Welcome Back</h1>
 <p className="text-muted-foreground text-sm mt-1">Sign in to access SEO Insights</p>
 </div>

 <form onSubmit={handleSubmit} className="space-y-6">
 <div className="space-y-2">
 <label className="text-sm font-medium text-foreground ml-1">Email</label>
 <div className="relative">
 <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground"/>
 <input
 type="email"
 value={email}
 onChange={(e) => setEmail(e.target.value)}
 className="w-full bg-background border border-border rounded-xl py-3 pl-11 pr-4 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
 placeholder="Enter your email"
 required
 />
 </div>
 </div>

 <div className="space-y-2">
 <label className="text-sm font-medium text-foreground ml-1">Password</label>
 <div className="relative">
 <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground"/>
 <input
 type="password"
 value={password}
 onChange={(e) => setPassword(e.target.value)}
 className="w-full bg-background border border-border rounded-xl py-3 pl-11 pr-4 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
 placeholder="••••••••"
 required
 />
 </div>
 </div>

 {error && (
 <motion.div
 initial={{ opacity: 0, y: -10 }}
 animate={{ opacity: 1, y: 0 }}
 className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center"
 >
 {error}
 </motion.div>
 )}

 <button
 type="submit"
 disabled={loading}
 className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white font-semibold py-3 rounded-xl transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2"
 >
 {loading ? <Loader2 className="w-5 h-5 animate-spin"/> :"Sign In"}
 </button>
 </form>

 <div className="mt-8 pt-6 border-t border-border text-center">
 <p className="text-muted-foreground text-sm">
 Don't have an account?{""}
 <button
 onClick={onToggle}
 className="text-blue-500 hover:text-blue-600 font-medium transition-colors"
 >
 Create one
 </button>
 </p>
 </div>
 </motion.div>
 );
}
