import { 
  collection, 
  doc, 
  getDocs, 
  addDoc, 
  deleteDoc, 
  query, 
  orderBy, 
  serverTimestamp,
  setDoc,
  getDoc
} from 'firebase/firestore';
import { db } from '../firebase';

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: any;
}

export interface SavedKeyword {
  id: string;
  term: string;
  projectId?: string;
  searchVolume: number;
  keywordDifficulty: number;
  createdAt: any;
}

export interface Competitor {
  id: string;
  domainUrl: string;
  niche?: string;
  createdAt: any;
}

// User Profile
export const initUserProfile = async (uid: string, data: any) => {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  
  if (!userSnap.exists()) {
    await setDoc(userRef, {
      ...data,
      plan: 'free',
      role: 'member',
      createdAt: serverTimestamp()
    });
  }
};

export const getUserProfile = async (uid: string) => {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  return userSnap.exists() ? userSnap.data() : null;
};

export const updateUserProfileData = async (uid: string, data: any) => {
  const userRef = doc(db, 'users', uid);
  await setDoc(userRef, data, { merge: true });
};

export const makeUserAdmin = async (uid: string) => {
  const userRef = doc(db, 'users', uid);
  await setDoc(userRef, { role: 'admin' }, { merge: true });
};

// Admin Functions
export const getAllUsers = async () => {
  const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const updateUserRole = async (uid: string, role: string) => {
  const userRef = doc(db, 'users', uid);
  await setDoc(userRef, { role }, { merge: true });
};

export const deleteUserDoc = async (uid: string) => {
  await deleteDoc(doc(db, 'users', uid));
};

// Projects
export const getProjects = async (uid: string): Promise<Project[]> => {
  const q = query(collection(db, `users/${uid}/projects`), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
};

export const addProject = async (uid: string, data: Omit<Project, 'id' | 'createdAt'>) => {
  const docRef = await addDoc(collection(db, `users/${uid}/projects`), {
    ...data,
    createdAt: serverTimestamp()
  });
  return { id: docRef.id, ...data, createdAt: new Date() } as Project;
};

export const deleteProject = async (uid: string, projectId: string) => {
  await deleteDoc(doc(db, `users/${uid}/projects`, projectId));
};

// Keywords
export const getSavedKeywords = async (uid: string): Promise<SavedKeyword[]> => {
  const q = query(collection(db, `users/${uid}/keywords`), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SavedKeyword));
};

export const addSavedKeyword = async (uid: string, data: Omit<SavedKeyword, 'id' | 'createdAt'>) => {
  const docRef = await addDoc(collection(db, `users/${uid}/keywords`), {
    ...data,
    createdAt: serverTimestamp()
  });
  return { id: docRef.id, ...data, createdAt: new Date() } as SavedKeyword;
};

export const deleteSavedKeyword = async (uid: string, keywordId: string) => {
  await deleteDoc(doc(db, `users/${uid}/keywords`, keywordId));
};

// Competitors
export const getCompetitors = async (uid: string): Promise<Competitor[]> => {
  const q = query(collection(db, `users/${uid}/competitors`), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Competitor));
};

export const addCompetitor = async (uid: string, data: Omit<Competitor, 'id' | 'createdAt'>) => {
  const docRef = await addDoc(collection(db, `users/${uid}/competitors`), {
    ...data,
    createdAt: serverTimestamp()
  });
  return { id: docRef.id, ...data, createdAt: new Date() } as Competitor;
};

export const deleteCompetitor = async (uid: string, competitorId: string) => {
  await deleteDoc(doc(db, `users/${uid}/competitors`, competitorId));
};
