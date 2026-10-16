const { initializeApp } = require("firebase/app");
const { getFirestore, doc, updateDoc } = require("firebase/firestore");

function firebaseConfigFromEnv() {
  return {
    apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || "",
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.VITE_FIREBASE_PROJECT_ID || "",
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.VITE_FIREBASE_APP_ID || "",
  };
}

const firebaseConfig = firebaseConfigFromEnv();
if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error(
    "Missing Firebase env vars. Copy .env.example → .env.local and set VITE_FIREBASE_* (see Firebase console)."
  );
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function updateProjects() {
  try {
    const officeDocRef = doc(db, "projects", "H3gu8a8WGRck1BZ0PiLp");
    await updateDoc(officeDocRef, {
      ifcFilePath: "/assets/IFC example/ARK_NordicLCA_Office_Concrete_IFC4RAVA.ifc",
    });
    console.log("Office project updated successfully");

    const housingDocRef = doc(db, "projects", "NP2MddybUjl0ldV7R4nx");
    await updateDoc(housingDocRef, {
      ifcFilePath: "/assets/IFC example/ARK_NordicLCA_Housing_Timber_IFC4RAVA.ifc",
    });
    console.log("Housing project updated successfully");
  } catch (error) {
    console.error("Error updating projects:", error);
  }
}

updateProjects();
