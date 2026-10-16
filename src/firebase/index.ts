// Firebase: gated by COSTA_FIREBASE_OFF_V1 (pilot). Flip flag false to restore init.
import * as Firestore from "firebase/firestore";
import { initializeApp, type FirebaseApp } from "firebase/app";
import { COSTA_FIREBASE_OFF_V1 } from "../utils/costaFirebaseFlags";

const firebaseConfig = {
  apiKey: "AIzaSyBzfdQ2BycVvR_ea6c_1k0p_JwdsYheLiE",
  authDomain: "bim-dev-app.firebaseapp.com",
  projectId: "bim-dev-app",
  storageBucket: "bim-dev-app.firebasestorage.app",
  messagingSenderId: "989909983763",
  appId: "1:989909983763:web:0f4963dca3daa9927bd5e6",
};

export const isFirebaseDisconnected = COSTA_FIREBASE_OFF_V1;

let app: FirebaseApp | null = null;
let firestoreDB: Firestore.Firestore | null = null;

if (!COSTA_FIREBASE_OFF_V1) {
  app = initializeApp(firebaseConfig);
  firestoreDB = Firestore.getFirestore(app);
} else if (typeof window !== "undefined") {
  console.info(
    "[Costa] Firebase disconnected (COSTA_FIREBASE_OFF_V1=true). Project catalog offline; CostaBIM viewer unaffected."
  );
  (window as any).__COSTA_FIREBASE_OFF__ = true;
}

export { firestoreDB };

export function getCollection<T>(path: string) {
  if (COSTA_FIREBASE_OFF_V1 || !firestoreDB) {
    console.warn(`[Costa] Firebase off: getCollection("${path}") skipped`);
    return null as unknown as Firestore.CollectionReference<T>;
  }
  return Firestore.collection(firestoreDB, path) as Firestore.CollectionReference<T>;
}

export async function getDocument<T>(collectionPath: string, id: string) {
  if (COSTA_FIREBASE_OFF_V1 || !firestoreDB) {
    console.warn(
      `[Costa] Firebase off: getDocument("${collectionPath}/${id}") → null`
    );
    return null;
  }
  try {
    const docRef = Firestore.doc(firestoreDB, `${collectionPath}/${id}`);
    const docSnap = await Firestore.getDoc(docRef);
    if (docSnap.exists()) {
      return { id: docSnap.id, data: docSnap.data() as T };
    }
    return null;
  } catch (error) {
    console.error("Error getting document: ", error);
    return null;
  }
}

export async function deleteDocument(collectionPath: string, id: string) {
  if (COSTA_FIREBASE_OFF_V1) {
    console.warn(`[Costa] Firebase off: deleteDocument skipped`);
    return;
  }
  console.warn("Document deletion is disabled in demo mode");
}

export async function updateDocument<T extends Record<string, any>>(
  collectionPath: string,
  id: string,
  data: T
) {
  if (COSTA_FIREBASE_OFF_V1) {
    console.warn(`[Costa] Firebase off: updateDocument skipped`);
    return;
  }
  console.warn("Document updates are disabled in demo mode");
}

export async function addDocument<T extends Record<string, any>>(
  collectionPath: string,
  data: T
): Promise<string> {
  if (COSTA_FIREBASE_OFF_V1) {
    console.warn(`[Costa] Firebase off: addDocument skipped`);
    return "";
  }
  console.warn("Document creation is disabled in demo mode");
  return "";
}
