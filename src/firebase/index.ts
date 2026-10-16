// Firebase: gated by COSTA_FIREBASE_OFF_V1 (pilot). Flip flag false to restore init.
import * as Firestore from "firebase/firestore";
import { initializeApp, type FirebaseApp } from "firebase/app";
import { firebaseConfig, isFirebaseConfigComplete } from "../config/firebaseConfig";
import { COSTA_FIREBASE_OFF_V1 } from "../utils/costaFirebaseFlags";

export const isFirebaseDisconnected = COSTA_FIREBASE_OFF_V1;

let app: FirebaseApp | null = null;
let firestoreDB: Firestore.Firestore | null = null;

if (!COSTA_FIREBASE_OFF_V1) {
  if (!isFirebaseConfigComplete()) {
    console.warn(
      "[Costa] Firebase enabled but VITE_FIREBASE_* env vars are missing. Skipping init."
    );
  } else {
    app = initializeApp(firebaseConfig);
    firestoreDB = Firestore.getFirestore(app);
  }
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
