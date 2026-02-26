import React, { useState } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { User, Mail, Calendar, Clock, Edit2, Save, X, Camera, Loader2 } from 'lucide-react';

export default function UserProfile() {
  const { user, updateUserProfile } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    fullName: user?.fullName || '',
    username: user?.username || '',
    bio: user?.bio || '',
    photoURL: user?.photoURL || '',
  });

  React.useEffect(() => {
    if (user) {
      setFormData({
        fullName: user.fullName || '',
        username: user.username || '',
        bio: user.bio || '',
        photoURL: user.photoURL || '',
      });
    }
  }, [user]);

  if (!user) return null;

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    try {
      await updateUserProfile(formData);
      setIsEditing(false);
    } catch (err: any) {
      setError(err.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-3xl font-bold text-foreground flex items-center gap-3">
            Profile Settings
          </h2>
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-colors shadow-lg shadow-blue-500/20"
            >
              <Edit2 className="w-4 h-4" />
              Edit Profile
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setIsEditing(false);
                  setFormData({
                    fullName: user.fullName || '',
                    username: user.username || '',
                    bio: user.bio || '',
                    photoURL: user.photoURL || '',
                  });
                  setError(null);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-colors"
                disabled={loading}
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl transition-colors shadow-lg shadow-emerald-500/20"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left Column - Avatar & Quick Info */}
          <div className="md:col-span-1 space-y-6">
            <div className="bg-card/50 backdrop-blur-xl border border-border rounded-3xl p-6 shadow-sm flex flex-col items-center text-center">
              <div className="relative mb-4 group">
                <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-card shadow-xl bg-slate-800">
                  <img
                    src={isEditing ? formData.photoURL : user.photoURL}
                    alt={user.username}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`;
                    }}
                  />
                </div>
                {isEditing && (
                  <div className="absolute inset-0 bg-black/50 rounded-full flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera className="w-6 h-6 text-white mb-1" />
                    <span className="text-xs text-white font-medium">Change</span>
                  </div>
                )}
              </div>

              {isEditing && (
                <div className="w-full mb-4">
                  <label className="block text-xs font-medium text-muted-foreground mb-1 text-left">Avatar URL</label>
                  <input
                    type="text"
                    value={formData.photoURL}
                    onChange={(e) => setFormData({ ...formData, photoURL: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg py-2 px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    placeholder="https://..."
                  />
                </div>
              )}

              <h3 className="text-xl font-bold text-foreground">
                {isEditing ? (
                  <input
                    type="text"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg py-1 px-2 text-center focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    placeholder="Full Name"
                  />
                ) : (
                  user.fullName || user.username
                )}
              </h3>
              <p className="text-muted-foreground text-sm mt-1">@{user.username}</p>
            </div>

            <div className="bg-card/50 backdrop-blur-xl border border-border rounded-3xl p-6 shadow-sm space-y-4">
              <div className="flex items-center gap-3 text-sm">
                <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Joined</p>
                  <p className="text-foreground font-medium">{formatDate(user.creationTime)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-500">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Last Active</p>
                  <p className="text-foreground font-medium">{formatTime(user.lastSignInTime)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Details */}
          <div className="md:col-span-2 space-y-6">
            <div className="bg-card/50 backdrop-blur-xl border border-border rounded-3xl p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-foreground mb-6 flex items-center gap-2">
                <User className="w-5 h-5 text-blue-500" />
                Account Details
              </h3>
              
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">Username</label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={formData.username}
                        onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                        className="w-full bg-background border border-border rounded-xl py-2.5 px-4 text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        placeholder="Username"
                      />
                    ) : (
                      <div className="w-full bg-background/50 border border-border/50 rounded-xl py-2.5 px-4 text-foreground">
                        {user.username}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">Email Address</label>
                    <div className="relative">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">
                        <Mail className="w-4 h-4" />
                      </div>
                      <div className="w-full bg-background/50 border border-border/50 rounded-xl py-2.5 pl-11 pr-4 text-foreground opacity-70 cursor-not-allowed">
                        {user.email}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Email cannot be changed</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Bio / About</label>
                  {isEditing ? (
                    <textarea
                      value={formData.bio}
                      onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                      className="w-full bg-background border border-border rounded-xl py-3 px-4 text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50 min-h-[120px] resize-y"
                      placeholder="Tell us a bit about yourself..."
                    />
                  ) : (
                    <div className="w-full bg-background/50 border border-border/50 rounded-xl py-3 px-4 text-foreground min-h-[120px] whitespace-pre-wrap">
                      {user.bio || <span className="text-muted-foreground italic">No bio provided yet.</span>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
