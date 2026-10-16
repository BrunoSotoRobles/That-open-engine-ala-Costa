import { IProject, Project } from "./Project";
import { isProjectProtected, getProtectionMessage } from "../config/protectedData";

export type ProjectStatus = "Pending" | "Active" | "Finished";
export type UserRole = "Architect" | "Engineer" | "Developer";

export class ProjectsManager {
  list: Project[] = [];

  // Funciones de callback para cuando se crea o elimina un proyecto
  onProjectCreated: (project: Project) => void = () => {};
  onProjectDeleted: (id: string) => void = () => {};
  onProjectUpdated: (id: string, updatedProject: Project) => void = () => {};

  // Filtra proyectos por nombre
  filterProjects(value: string): Project[] {
    return this.list.filter((project) =>
      project.name.toLowerCase().includes(value.toLowerCase())
    );
  }

  // Crea un nuevo proyecto
  newProject(data: IProject, id?: string): Project {
    // Verificación de nombre de proyecto duplicado
    const nameInUse = this.list.some((project) => project.name === data.name);
    if (nameInUse) {
      throw new Error(`Project with name "${data.name}" already exists.`);
    }

    // Crear y añadir el proyecto
    const project = new Project(
      {
        ...data,
        cost: Number(data.cost) || 0,
        progress: Number(data.progress) || 0,
      },
      id
    );
    this.list.push(project);

    // Llamar al callback
    this.onProjectCreated(project);

    return project;
  }

  // Exporta la lista de proyectos a un archivo JSON
  exportToJSON(fileName: string = "projects"): void {
    const json = JSON.stringify(this.list, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileName}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Importa proyectos desde un archivo JSON
  importFromJSON(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const projects = JSON.parse(reader.result as string) as IProject[];

          // Añadir proyectos, manejando duplicados
          projects.forEach((projectData) => {
            try {
              this.newProject(projectData);
            } catch (error) {
              console.error(`Error importing project: ${error.message}`);
            }
          });
        } catch (err) {
          alert("Invalid JSON format.");
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  // Obtiene un proyecto por ID
  getProject(id: string): Project | undefined {
    return this.list.find((project) => project.id === id);
  }

  // Elimina un proyecto por ID
  deleteProject(id: string): void {
    // Verificar si es un proyecto protegido
    if (isProjectProtected(id)) {
      alert(getProtectionMessage('project'));
      return;
    }

    const projectIndex = this.list.findIndex((project) => project.id === id);
    if (projectIndex === -1) {
      return; // Proyecto no encontrado
    }

    // Eliminar el proyecto
    const [deletedProject] = this.list.splice(projectIndex, 1);

    // Llamar al callback
    this.onProjectDeleted(deletedProject.id);
  }

  // Actualiza un proyecto por ID
  updateProject(id: string, updatedData: IProject): void {
    const project = this.getProject(id);
    if (!project) {
      throw new Error(`Project with ID "${id}" not found.`);
    }

    // Actualizar el proyecto con los nuevos datos
    project.name = updatedData.name;
    project.description = updatedData.description;
    project.status = updatedData.status;
    project.userRole = updatedData.userRole;
    project.finishDate = updatedData.finishDate;
    project.cost = Number(updatedData.cost) || 0;
    project.progress = Number(updatedData.progress) || 0;

    // Llamar al callback para actualizar el proyecto
    this.onProjectUpdated(id, project);
  }
}
