import * as React from "react";
import { Project } from "../class/Project";

interface Props {
  project: Project;
}

export function ProjectCard(props: Props) {
  return (
    <div className="project-card" style={{ maxWidth: "100%" }}>
      <div className="card-header">
        <p
          style={{
            fontSize: 20,
            backgroundColor: "#ca8134", // Color de fondo
            color: "#fff", // Texto blanco
            aspectRatio: 1,
            borderRadius: "100%",
            padding: 12,
            margin: 0, // Eliminar márgenes predeterminados
            textAlign: "center", // Centrar el texto
          }}
        >
          {props.project.name.substring(0, 2).toUpperCase()}
        </p>
        <div style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
          <bim-label
            style={{
              fontSize: "16px",
              color: "#fff",
              fontWeight: "bold",
              wordBreak: "break-word", // Asegura el ajuste del texto
              overflowWrap: "break-word", // Asegura el ajuste del texto
              maxWidth: "100%", // Evitar que el texto se desborde
              display: "block", // Salto de línea cuando sea necesario
            }}
          >
            {props.project.name}
          </bim-label>
          <bim-label
            style={{
              color: "#fff",
              wordBreak: "break-word", // Salto en palabras largas
              overflowWrap: "break-word", // Salto en palabras largas
              maxWidth: "100%", // Limitar el ancho al contenedor
              display: "block", // Salto de línea para texto largo
              whiteSpace: "normal", // Permitir saltos de línea normales
            }}
          >
            {props.project.description}
          </bim-label>
        </div>
      </div>
      <div className="card-content">
        <div className="card-property">
          <bim-label>Status</bim-label>
          <bim-label style={{ color: "#fff" }}>
            {props.project.status}
          </bim-label>
        </div>
        <div className="card-property">
          <bim-label>Role</bim-label>
          <bim-label style={{ color: "#fff" }}>
            {props.project.userRole}
          </bim-label>
        </div>
        <div className="card-property">
          <bim-label>Cost</bim-label>
          <bim-label style={{ color: "#fff" }}>
            $ {props.project.cost}
          </bim-label>
        </div>
        <div className="card-property">
          <bim-label>Estimated Progress</bim-label>
          <bim-label style={{ color: "#fff" }}>
            {props.project.progress} %
          </bim-label>
        </div>
      </div>
    </div>
  );
}
