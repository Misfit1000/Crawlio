import React, { createContext, useContext, useState, useEffect } from "react";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  sendEmailVerification,
  updateProfile,
  User as FirebaseUser
} from "firebase/auth";
import { auth } from "../firebase";
import { initUserProfile, getUserProfile, updateUserProfileData } from "../services/firestoreService";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        try {
          // Ensure user profile exists in Firestore
          await initUserProfile(firebaseUser.uid, {
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'User'),
          });

          // Load extra data from Firestore
          const extraData = await getUserProfile(firebaseUser.uid) || {};
          
          setUser({
            id: firebaseUser.uid,
            username: extraData.username || firebaseUser.email?.split('@')[0] || 'User',
            email: firebaseUser.email || '',
            fullName: firebaseUser.displayName || extraData.fullName || extraData.displayName || '',
            bio: extraData.bio || '',
            photoURL: firebaseUser.photoURL || extraData.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${firebaseUser.uid}`,
            creationTime: firebaseUser.metadata.creationTime || new Date().toISOString(),
            lastSignInTime: firebaseUser.metadata.lastSignInTime || new Date().toISOString(),
            role: extraData.role || 'member',
          });
        } catch (err) {
          console.error("Error loading user profile:", err);
          // Fallback to basic user info if Firestore fails
          setUser({
            id: firebaseUser.uid,
            username: firebaseUser.email?.split('@')[0] || 'User',
            email: firebaseUser.email || '',
            fullName: firebaseUser.displayName || '',
            bio: '',
            photoURL: firebaseUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${firebaseUser.uid}`,
            creationTime: firebaseUser.metadata.creationTime || new Date().toISOString(),
            lastSignInTime: firebaseUser.metadata.lastSignInTime || new Date().toISOString(),
            role: 'member',
          });
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async (email: string, password: string) => {
    setError(null);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      // Removed email verification check to allow login
    } catch (err: any) {
      if (err.message === "Please verify your email before logging in.") {
        throw err;
      }
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        throw new Error("Email or password is incorrect");
      }
      throw new Error(err.message || "Login failed");
    }
  };

  const register = async (email: string, password: string) => {
    setError(null);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      // Optional: sendEmailVerification(userCredential.user);
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        throw new Error("User already exists. Please sign in");
      }
      throw new Error(err.message || "Registration failed");
    }
  };

  const updateUserProfile = async (data: Partial<User>) => {
    if (!auth.currentUser || !user) throw new Error("Not authenticated");
    
    // Update Firebase Auth profile
    if (data.fullName !== undefined || data.photoURL !== undefined) {
      await updateProfile(auth.currentUser, {
        displayName: data.fullName !== undefined ? data.fullName : auth.currentUser.displayName,
        photoURL: data.photoURL !== undefined ? data.photoURL : auth.currentUser.photoURL,
      });
    }

    // Save extra data to Firestore
    await updateUserProfileData(user.id, data);

    // Update local state
    setUser(prev => prev ? { ...prev, ...data } : null);
  };

  const logout = async () => {
    await signOut(auth);
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
