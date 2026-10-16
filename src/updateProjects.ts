const { initializeApp } = require('firebase/app');
const { getFirestore, doc, updateDoc } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyBzfdQ2BycVvR_ea6c_1k0p_JwdsYheLiE",
  authDomain: "bim-dev-app.firebaseapp.com",
  projectId: "bim-dev-app",
  storageBucket: "bim-dev-app.firebasestorage.app",
  messagingSenderId: "989909983763",
  appId: "1:989909983763:web:0f4963dca3daa9927bd5e6"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function updateProjects() {
  try {
    // Actualizar el proyecto de oficina
    const officeDocRef = doc(db, 'projects', 'H3gu8a8WGRck1BZ0PiLp');
    await updateDoc(officeDocRef, {
      ifcFilePath: '/assets/IFC example/ARK_NordicLCA_Office_Concrete_IFC4RAVA.ifc'
    });
    console.log('Office project updated successfully');

    // Actualizar el proyecto de vivienda
    const housingDocRef = doc(db, 'projects', 'NP2MddybUjl0ldV7R4nx');
    await updateDoc(housingDocRef, {
      ifcFilePath: '/assets/IFC example/ARK_NordicLCA_Housing_Timber_IFC4RAVA.ifc'
    });
    console.log('Housing project updated successfully');

  } catch (error) {
    console.error('Error updating projects:', error);
  }
}

updateProjects(); 