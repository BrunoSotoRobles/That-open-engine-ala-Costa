import * as React from "react";
import * as Router from "react-router-dom";
import * as Firestore from "firebase/firestore";
import { IProject, Project, ProjectStatus, UserRole } from "../class/Project";
import { ProjectsManager } from "../class/ProjectsManager";
import { ProjectCard } from "./ProjectCard";
import { getDocument } from "../firebase";

interface Props {
  projectsManager: ProjectsManager;
}

// ID del proyecto de prueba que está permitido mostrar
const TEST_PROJECT_ID = 'aedReHfEmmXLfQohxZve';

const LoadingState = () => (
  <div className="loading-container">
    <div className="spinner"></div>
    <p>Loading test project...</p>
  </div>
);

export function ProjectsPage(props: Props) {
  const [projects, setProjects] = React.useState<Project[]>(props.projectsManager.list);
  const [loading, setLoading] = React.useState<boolean>(true);

  props.projectsManager.onProjectCreated = () => {
    setProjects([...props.projectsManager.list]);
  };

  const getTestProject = async () => {
    try {
      setLoading(true);
      // Cargar únicamente el proyecto de prueba
      const result = await getDocument<IProject>("/projects", TEST_PROJECT_ID);
      
      if (result) {
        const data = result.data;
        const project: IProject = {
          ...data,
          finishDate: (data.finishDate as unknown as Firestore.Timestamp).toDate(),
        };
        
        try {
          props.projectsManager.newProject(project, result.id);
        } catch (error) {
          console.error("Error loading test project:", error);
        }
      }
    } catch (error) {
      console.error("Error fetching test project:", error);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    getTestProject();
  }, []);

  const projectCards = projects.map((project) => {
    return (
      <Router.Link to={`/project/${project.id}`} key={project.id}>
        <ProjectCard project={project} />
      </Router.Link>
    );
  });

  return (
    <div className="page" id="projects-page">
      <header style={{ 
        padding: '1rem 2rem',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: '24px'
      }}>
        <h2 style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          margin: 0,
          fontSize: '1.5rem'
        }}>
          <span className="material-icons-round">apartment</span>
          Projects (Demo)
        </h2>
      </header>
      <div className="main-page-content" style={{ padding: '2rem' }}>
        {loading ? (
          <LoadingState />
        ) : projects.length > 0 ? (
          <div id="projects-list">{projectCards}</div>
        ) : (
          <div style={{
            textAlign: 'center',
            padding: '2rem',
            color: 'var(--text-2)'
          }}>
            <p>No se encontró el proyecto de prueba</p>
          </div>
        )}
      </div>
    </div>
  );
}
