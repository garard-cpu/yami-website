// Firebase settings for Yami accounts.
// Paste the web app config from Firebase console > Project settings > Your apps.
// These values are public by design; firestore.rules is what protects each person's data.
// While apiKey is empty, Yami runs without accounts and saves everything on the phone only.
window.YAMI_FIREBASE = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  appId: "",
  google: true, // turn on Google in Firebase console > Authentication > Sign-in method
  apple: false, // set to true once Sign in with Apple is set up (needs the Apple Developer account)
};
