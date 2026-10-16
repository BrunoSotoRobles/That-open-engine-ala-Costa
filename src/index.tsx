import * as React from "react"
import * as ReactDOM from "react-dom/client"
import * as Router from "react-router-dom"
import { Sidebar } from "./react-components/Sidebar"
import { ProjectsPage } from "./react-components/ProjectsPage"
import { ProjectDetailsPage } from "./react-components/ProjectDetailsPage"
import { ProjectsManager } from "./class/ProjectsManager"
import { UsersPage } from "./react-components/UserPage"
import { MaterialsPage } from "./react-components/MaterialsPage"
import { CostPage } from "./react-components/CostPage"
import { HomePage } from "./react-components/HomePage"
import { StandaloneViewerPage } from "./react-components/StandaloneViewerPage"
import { AboutPage } from "./react-components/AboutPage"
import { Footer } from "./react-components/Footer"
import { COSTA_FIREBASE_OFF_V1 } from "./utils/costaFirebaseFlags"
import * as BUI from "@thatopen/ui"
import * as OBC from "@thatopen/components"
import "./styles/style.css";
BUI.Manager.init()

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "bim-grid": any;
      "bim-text-input": any;
      "bim-button": any;
      "bim-label": any;
      "bim-panel": any;
      "bim-panel-section": any;
      "bim-table": any;
      "bim-dropdown": any;
      "bim-option": any;
      "bim-toolbar": any;
      "bim-toolbar-section": any;
      "bim-toolbar-group": any;
      "bim-viewport": any;
    }
  }
}

const projectsManager = new ProjectsManager()
const components = new OBC.Components()

const rootElement = document.getElementById("app") as HTMLDivElement
const appRoot = ReactDOM.createRoot(rootElement)
appRoot.render(
  <>
    <Router.BrowserRouter>
      <div className="app-layout">
        <Sidebar />
        <div style={{ 
          gridArea: 'content',
          display: 'flex', 
          flexDirection: 'column',
          minHeight: '100vh',
          minWidth: 0,
          paddingBottom: '30px' /* Space for fixed footer (30px) */
        }}>
          <Router.Routes>
            <Router.Route path="/" element={<HomePage />}></Router.Route>
            <Router.Route path="/home" element={<HomePage />}></Router.Route>
            <Router.Route path="/viewer" element={<StandaloneViewerPage />}></Router.Route>
            <Router.Route
              path="/projects"
              element={
                COSTA_FIREBASE_OFF_V1 ? (
                  <Router.Navigate to="/viewer" replace />
                ) : (
                  <ProjectsPage projectsManager={projectsManager} />
                )
              }
            ></Router.Route>
            <Router.Route
              path="/project/:id"
              element={
                COSTA_FIREBASE_OFF_V1 ? (
                  <Router.Navigate to="/viewer" replace />
                ) : (
                  <ProjectDetailsPage projectsManager={projectsManager} />
                )
              }
            ></Router.Route>
            <Router.Route path="/materials" element={<MaterialsPage />}></Router.Route>
            <Router.Route path="/users" element={<UsersPage />}></Router.Route>
            <Router.Route path="/costs" element={<CostPage />}></Router.Route>
            <Router.Route path="/costs-alt" element={<Router.Navigate to="/costs" replace />}></Router.Route>
            <Router.Route path="/about" element={<AboutPage />}></Router.Route>
          </Router.Routes>
        </div>
      </div>
      <Footer />
    </Router.BrowserRouter>
  </>
)
