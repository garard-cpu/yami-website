// Firebase settings for Yami accounts.
// Paste the web app config from Firebase console > Project settings > Your apps.
// These values are public by design; firestore.rules is what protects each person's data.
// While apiKey is empty, Yami runs without accounts and saves everything on the phone only.
window.YAMI_FIREBASE = {
  apiKey: "AIzaSyAZ66_dWwwwCiZaHeaRWBdyQYc9CXSObU8",
  authDomain: "yami-80e44.firebaseapp.com",
  projectId: "yami-80e44",
  appId: "1:130177012338:web:914f4f21fd1ffee25028eb",
  google: true, // turn on Google in Firebase console > Authentication > Sign-in method
  apple: false, // set to true once Sign in with Apple is set up (needs the Apple Developer account)
};
