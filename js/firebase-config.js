// ─────────────────────────────────────────────────────────────
// js/firebase-config.js — Firebase initialization
// Loaded after Firebase SDK CDN scripts, before storage.js
// ─────────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey:            'AIzaSyCgVFqMhGkU01UVUKk8li0IWaZBCdGXbzM',
  authDomain:        'reportes-woodconcept.firebaseapp.com',
  projectId:         'reportes-woodconcept',
  storageBucket:     'reportes-woodconcept.firebasestorage.app',
  messagingSenderId: '829521788025',
  appId:             '1:829521788025:web:20e6215a9a834bc24fe8a8',
  measurementId:     'G-L8CYBSSQQ6',
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
