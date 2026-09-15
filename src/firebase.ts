import { initializeApp } from 'firebase/app';
import { getAnalytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: "AIzaSyBrpZBYg3Lz0LHw_e3wccNGcylnlvnqaQo",
  authDomain: "dcintelligenceio.firebaseapp.com",
  projectId: "dcintelligenceio",
  storageBucket: "dcintelligenceio.firebasestorage.app",
  messagingSenderId: "385771681318",
  appId: "1:385771681318:web:25d97fc50324d128c958e7",
  measurementId: "G-ZTFME87CHF"
};

export const app = initializeApp(firebaseConfig);
export const analytics = typeof window !== 'undefined' ? getAnalytics(app) : null;
