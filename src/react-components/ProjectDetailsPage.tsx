import * as React from "react";
import * as Router from "react-router-dom";
import { ProjectsManager, ProjectStatus, UserRole } from "../class/ProjectsManager";
import { IFCViewer } from "./IFCViewer";
import { deleteDocument, updateDocument } from "../firebase";
import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import { TodoCreator, todoTool } from "../bim_components/TodoCreator/"; // Runtime JS import
// @ts-expect-error - runtime import only, TS types live outside current config
import type { TodoData } from "../bim_components/TodoCreator/src/base-types";
import { isProjectProtected, getProtectionMessage } from "../config/protectedData";
import { IFCMeasurementPanel } from "./IFCMeasurementPanel";

interface Props {
  projectsManager: ProjectsManager;
}

export function ProjectDetailsPage(props: Props) {
  const routeParams = Router.useParams<{ id: string }>();
  if (!routeParams.id) {
    return <p>Project ID is needed to see this page</p>;
  }

  const project = props.projectsManager.getProject(routeParams.id);
  if (!project) {
    return <p>The project with ID {routeParams.id} wasn't found.</p>;
  }

  const components: OBC.Components = new OBC.Components();
  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);
  const dashboard = React.useRef<HTMLDivElement>(null);
  const todoContainer = React.useRef<HTMLDivElement>(null);
  const [isViewerExpanded, setIsViewerExpanded] = React.useState(false);

  const navigateTo = Router.useNavigate();
  props.projectsManager.onProjectDeleted = async (id) => {
    await deleteDocument("/projects", id);
    navigateTo("/");
  };

  const onRowCreated = (event: any) => {
    event.stopImmediatePropagation();
    const { row } = event.detail;
    row.addEventListener("click", async () => {
      todoCreator.highlightTodo({
        name: row.data.Name,
        task: row.data.Task,
        priority: row.data.Priority,
        ifcGuids: JSON.parse(row.data.Guids),
        camera: JSON.parse(row.data.Camera),
      });
    });
  };

  const todoTable = BUI.Component.create<BUI.Table>(() => {
    return BUI.html`
      <bim-table @rowcreated=${onRowCreated}></bim-table>`;
  });

  const addTodo = (data: TodoData) => {
    const newData = {
      data: {
        Name: data.name,
        Task: data.task,
        Date: new Date().toDateString(),
        Guids: JSON.stringify(data.ifcGuids),
        Camera: data.camera ? JSON.stringify(data.camera) : "",
        Actions: "",
      },
    };
    todoTable.data = [...todoTable.data, newData];

    todoTable.dataTransform = {
      Actions: () => {
        return BUI.html`
          <div>
            <button style="background-color: red; color: white;">Delete</button>
          </div>
          <div>
            <button style="background-color: green; color: white;" @click=${() =>
              todoCreator.addTodoMarker(data)}>
              Navigate
            </button>
          </div>
        `;
      },
    };
    todoTable.hiddenColumns = ["Guids", "Camera"];
  };

  const todoCreator = components.get(TodoCreator);
  todoCreator.onTodoCreated.add((data) => addTodo(data));

  React.useEffect(() => {
    dashboard.current?.appendChild(todoTable);
    const [todoButton, todoPriorityButton] = todoTool({ components });
    todoContainer.current?.appendChild(todoButton);
    todoContainer.current?.appendChild(todoPriorityButton);

    todoCreator.onDisposed.add(() => {
      todoTable.data = [];
      todoTable.remove();
    });
  }, []);

  React.useEffect(() => {
    const handleToggleFullscreen = () => {
      setIsViewerExpanded(!isViewerExpanded);
    };

    window.addEventListener('toggleFullscreen', handleToggleFullscreen);
    return () => {
      window.removeEventListener('toggleFullscreen', handleToggleFullscreen);
    };
  }, [isViewerExpanded]);

  const onEditFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const editForm = document.getElementById("edit-project-form") as HTMLFormElement;
    const formData = new FormData(editForm);

    const updatedProject = {
      name: formData.get("name") as string,
      description: formData.get("description") as string,
      status: formData.get("status") as ProjectStatus,
      userRole: formData.get("userRole") as UserRole, // Cast correcto
      finishDate: new Date(formData.get("finishDate") as string),
      cost: Number(formData.get("cost")),
      progress: Number(formData.get("progress")) / 100,
    };

    try {
      await updateDocument("projects", project.id, updatedProject);
      props.projectsManager.updateProject(project.id, updatedProject);
      setIsEditModalOpen(false);
    } catch (err) {
      alert(err);
    }
  };

  const initials = project.name.substring(0, 2).toUpperCase();

  return (
    <div className="page" id="project-details">
      <header>
        <div>
          <h2 data-project-info="name">{project.name}</h2>
          <p style={{ color: "#969696" }}>{project.description}</p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={() => setIsViewerExpanded(!isViewerExpanded)}
            style={{
              backgroundColor: "transparent",
              border: "1px solid #404040",
              padding: "8px 16px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span className="material-icons-round">
              {isViewerExpanded ? "fullscreen_exit" : "fullscreen"}
            </span>
            {isViewerExpanded ? "Exit Fullscreen" : "Fullscreen"}
          </button>
          {!isViewerExpanded && !isProjectProtected(project.id) && (
            <button
              onClick={() => {
                if (window.confirm('Are you sure you want to delete this project?')) {
                  props.projectsManager.deleteProject(project.id);
                }
              }}
              style={{ backgroundColor: "red" }}
            >
              Delete project
            </button>
          )}
        </div>
      </header>
      <div className="main-page-content">
        <div 
          className="project-details-sidebar"
          style={{ 
            display: isViewerExpanded ? "none" : "flex", 
            flexDirection: "column", 
            rowGap: 30, 
            width: "100%",
            maxWidth: "420px",
            transition: "all 0.3s ease-in-out"
          }}
        >
          <div className="dashboard-card" style={{ padding: "30px 0", backgroundColor: "transparent", flexShrink: 0 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0px 30px",
                marginBottom: 30,
              }}
            >
              <p
                style={{
                  fontSize: 20,
                  backgroundColor: "#ca8134",
                  aspectRatio: 1,
                  borderRadius: "100%",
                  padding: 12,
                }}
              >
                {initials}
              </p>
              <button
                className="btn-secondary"
                onClick={() => setIsEditModalOpen(true)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  padding: "8px 16px",
                }}
              >
                Edit
              </button>
            </div>
            <div className="bim-project-info">
              <div>
                <h5>{project.name}</h5>
                <p>{project.description}</p>
              </div>
              <div
                style={{
                  display: "flex",
                  columnGap: 30,
                  padding: "30px 0px",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <p style={{ color: "#969696", fontSize: "var(--font-sm)" }}>
                    Status
                  </p>
                  <p>{project.status}</p>
                </div>
                <div>
                  <p style={{ color: "#969696", fontSize: "var(--font-sm)" }}>
                    Cost
                  </p>
                  <p>€{project.cost}</p>
                </div>
                <div>
                  <p style={{ color: "#969696", fontSize: "var(--font-sm)" }}>
                    Role
                  </p>
                  <p>{project.userRole}</p>
                </div>
                <div>
                  <p style={{ color: "#969696", fontSize: "var(--font-sm)" }}>
                    Finish Date
                  </p>
                  <p>{project.finishDate.toDateString()}</p>
                </div>
              </div>
              <div
                style={{
                  backgroundColor: "#404040",
                  borderRadius: 9999,
                  overflow: "auto",
                }}
              >
                <div
                  style={{
                    width: `${project.progress * 100}%`,
                    backgroundColor: "green",
                    padding: "4px 0",
                    textAlign: "center",
                  }}
                >
                  {project.progress * 100}%
                </div>
              </div>
            </div>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <IFCMeasurementPanel />
          </div>
          {/* BCF Manager removed - not needed for Costa Laskenta project */}
        </div>
        <div 
          className={`ifc-viewer-container ${isViewerExpanded ? "fullscreen-mode" : ""}`}
          style={{ 
            flexGrow: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            borderRadius: isViewerExpanded ? "0" : "8px", 
            overflow: "hidden",
            transition: "all 0.3s ease-in-out",
            marginLeft: isViewerExpanded ? "0" : "16px",
            width: isViewerExpanded ? "100%" : "auto"
          }}
        >
          <IFCViewer 
            components={components} 
            isExpanded={isViewerExpanded}
            ifcFilePath={project?.ifcFilePath}
          />
        </div>
      </div>

      {isEditModalOpen && (
        <>
          <div
            className="overlay"
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              backdropFilter: "blur(3px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
            }}
            onClick={() => setIsEditModalOpen(false)}
          >
            <dialog
              open
              className="edit-project-modal"
              style={{
                width: "80%",
                maxWidth: "400px",
                backgroundColor: "white",
                border: "none",
                borderRadius: "8px",
                boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                zIndex: 1001,
                margin: "auto",
                padding: 0,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <form
                id="edit-project-form"
                onSubmit={onEditFormSubmit}
                style={{
                  maxHeight: "400px",
                  overflowY: "auto",
                  padding: "20px",
                }}
              >
                <h2>Edit Project</h2>
                <div className="input-list">
                  <div className="form-field-container">
                    <label>
                      <span className="material-icons-round">apartment</span>Name
                    </label>
                    <input
                      name="name"
                      type="text"
                      defaultValue={project.name}
                    />
                    <p
                      style={{
                        color: "gray",
                        fontSize: "var(--font-sm)",
                        marginTop: 5,
                        fontStyle: "italic",
                      }}
                    >
                      TIP: Give it a short name
                    </p>
                  </div>
                  <div className="form-field-container">
                    <label>
                      <span className="material-icons-round">subject</span>Description
                    </label>
                    <textarea
                      name="description"
                      cols={30}
                      rows={5}
                      defaultValue={project.description}
                    />
                  </div>
                  <div className="form-field-container">
                    <label>
                      <span className="material-icons-round">person</span>Role
                    </label>
                    <select name="userRole" defaultValue={project.userRole}>
                      <option value="Architect">Architect</option>
                      <option value="Engineer">Engineer</option>
                      <option value="Developer">Developer</option>
                    </select>
                  </div>
                  <div className="form-field-container">
                    <label>
                      <span className="material-icons-round">not_listed_location</span>Status
                    </label>
                    <select name="status" defaultValue={project.status}>
                      <option value="Pending">Pending</option>
                      <option value="Active">Active</option>
                      <option value="Finished">Finished</option>
                    </select>
                  </div>
                  <div className="form-field-container">
                    <label htmlFor="finishDate">
                      <span className="material-icons-round">calendar_month</span>Finish Date
                    </label>
                    <input
                      name="finishDate"
                      type="date"
                      defaultValue={project.finishDate.toISOString().split("T")[0]}
                    />
                  </div>
                  <div className="form-field-container">
                    <label>
                      <span className="material-icons-round">euro</span>Cost
                    </label>
                    <input
                      name="cost"
                      type="number"
                      defaultValue={project.cost}
                    />
                  </div>
                  <div className="form-field-container">
                    <label>
                      <span className="material-icons-round">percent</span>Progress
                    </label>
                    <input
                      name="progress"
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      defaultValue={project.progress * 100} // Multiply by 100 to show as percentage
                    />
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    marginTop: 20,
                    justifyContent: "flex-end",
                    gap: 10,
                  }}
                >
                  <button
                    type="button"
                    style={{
                      backgroundColor: "transparent",
                    }}
                    onClick={() => setIsEditModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    style={{
                      backgroundColor: "rgb(18, 145, 18)"
                    }}
                  >
                    Save
                  </button>
                </div>
              </form>
            </dialog>
          </div>
        </>
      )}
    </div>
  );
}
