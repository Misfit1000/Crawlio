import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBYXPrVH3iuOHKlrDwcij-4VnIcvi7bvG0",
  authDomain: "keywordsintel.firebaseapp.com",
  projectId: "keywordsintel",
  storageBucket: "keywordsintel.firebasestorage.app",
  messagingSenderId: "971881776225",
  appId: "1:971881776225:web:321d1841095d65a8e41620",
  measurementId: "G-N7S1JMRY9N"
};

const app = initializeApp(firebaseConfig);

// Safely initialize analytics only if supported
export let analytics: any = null;
if (typeof window !== "undefined") {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(console.error);
}

export const auth = getAuth(app);
export const db = getFirestore(app);
