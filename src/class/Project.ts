import { ReactNode } from 'react'
import { v4 as uuidv4 } from 'uuid'

export type ProjectStatus = "Pending" | "Active" | "Finished"
export type UserRole = "Architect" | "Engineer" | "Developer"

export interface IProject {
  cost: string | number | readonly string[] | undefined
  progress: string | number | readonly string[] | undefined
  name: string
	description: string
	status: ProjectStatus
	userRole: UserRole
	finishDate: Date
  ifcFilePath?: string
}

export class Project implements IProject {
	//To satisfy IProject
  name: string
	description: string
	status: "Pending" | "Active" | "Finished"
	userRole: "Architect" | "Engineer" | "Developer"
  finishDate: Date
  ifcFilePath?: string
  
  //Class internals
  cost: number = 0
  progress: number = 0
  id: string
  role: ReactNode

  constructor(data: IProject, id = uuidv4()) {
    for (const key in data) {
      this[key] = data[key]
    }
    this.id = id
  }
}