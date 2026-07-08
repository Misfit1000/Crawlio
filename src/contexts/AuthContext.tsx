import React, { createContext, useContext, useEffect, useState } from "react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "../lib/supabase/client";
import { getUserProfile, initUserProfile, updateUserProfileData } from "../services/supabaseDataService";

export interface User {
  id: string;
  username: string;
  email: string;
  fullName: string;
  bio: string;
  photoURL: string;
  creationTime: string;
  lastSignInTime: string;
  role: 'admin' | 'staff' | 'member';
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUserProfile: (data: Partial<User>) => Promise<void>;
  error: string | null;
  unverifiedEmail: string | null;
  setUnverifiedEmail: (email: string | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function fallbackAvatar(userId: string) {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`;
}

async function mapSupabaseUser(supabaseUser: SupabaseUser): Promise<User> {
  const email = supabaseUser.email || '';
  const metadata = supabaseUser.user_metadata || {};

  try {
    await initUserProfile(supabaseUser.id, {
      email,
      displayName: metadata.display_name || metadata.full_name || (email ? email.split('@')[0] : 'User'),
    });
    const extraData = await getUserProfile(supabaseUser.id) || {};

    return {
      id: supabaseUser.id,
      username: extraData.username || email.split('@')[0] || 'User',
      email,
      fullName: metadata.full_name || extraData.fullName || extraData.displayName || '',
      bio: extraData.bio || '',
      photoURL: metadata.avatar_url || extraData.photoURL || fallbackAvatar(supabaseUser.id),
      creationTime: supabaseUser.created_at || new Date().toISOString(),
      lastSignInTime: supabaseUser.last_sign_in_at || new Date().toISOString(),
      role: extraData.role || 'member',
    };
  } catch (err) {
    console.error("Error loading user profile:", err);
    return {
      id: supabaseUser.id,
      username: email.split('@')[0] || 'User',
      email,
      fullName: metadata.full_name || '',
      bio: '',
      photoURL: metadata.avatar_url || fallbackAvatar(supabaseUser.id),
      creationTime: supabaseUser.created_at || new Date().toISOString(),
      lastSignInTime: supabaseUser.last_sign_in_at || new Date().toISOString(),
      role: 'member',
    };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) {
      setUser(null);
      setLoading(false);
      return;
    }

    let active = true;
    client.auth.getUser()
      .then(async ({ data }) => {
        if (!active) return;
        setUser(data.user ? await mapSupabaseUser(data.user) : null);
      })
      .catch((err) => {
        if (active) console.error("Error loading auth session:", err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const { data: subscription } = client.auth.onAuthStateChange(async (_event, session) => {
      if (!active) return;
      setUser(session?.user ? await mapSupabaseUser(session.user) : null);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string) => {
    setError(null);
    const client = getSupabaseBrowserClient();
    if (!client) throw new Error("Supabase is not configured");

    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) {
      if (signInError.message.toLowerCase().includes('invalid')) {
        throw new Error("Email or password is incorrect");
      }
      throw new Error(signInError.message || "Login failed");
    }
  };

  const register = async (email: string, password: string) => {
    setError(null);
    const client = getSupabaseBrowserClient();
    if (!client) throw new Error("Supabase is not configured");

    const { data, error: signUpError } = await client.auth.signUp({ email, password });
    if (signUpError) {
      if (signUpError.message.toLowerCase().includes('already')) {
        throw new Error("User already exists. Please sign in");
      }
      throw new Error(signUpError.message || "Registration failed");
    }

    if (data.user) {
      await initUserProfile(data.user.id, {
        email,
        displayName: email.split('@')[0] || 'User',
      });
    }
  };

  const updateUserProfile = async (data: Partial<User>) => {
    if (!user) throw new Error("Not authenticated");
    const client = getSupabaseBrowserClient();
    if (!client) throw new Error("Supabase is not configured");

    if (data.fullName !== undefined || data.photoURL !== undefined) {
      const { error: updateError } = await client.auth.updateUser({
        data: {
          full_name: data.fullName !== undefined ? data.fullName : user.fullName,
          avatar_url: data.photoURL !== undefined ? data.photoURL : user.photoURL,
        },
      });
      if (updateError) throw updateError;
    }

    await updateUserProfileData(user.id, data);
    setUser((prev) => prev ? { ...prev, ...data } : null);
  };

  const logout = async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { error: signOutError } = await client.auth.signOut();
    if (signOutError) throw signOutError;
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateUserProfile, error, unverifiedEmail, setUnverifiedEmail }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
