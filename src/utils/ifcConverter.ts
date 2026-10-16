import { 
  IfcAPI, 
  IFCPROJECT, 
  IFCTASK, 
  IFCWORKSCHEDULE, 
  IFCRELASSIGNSTOPRODUCT,
  IFCOWNERHISTORY,
  IFCPERSON,
  IFCORGANIZATION,
  IFCAPPLICATION,
  IFCPROPERTYSET,
  IFCRELDEFINESBYPROPERTIES
} from 'web-ifc';

interface IFCScheduleData {
  GlobalId: string;
  Name: string;
  Description: string;
  ObjectType: string;
  Identification: string;
  StartTime: string;
  FinishTime: string;
  Duration: number;
  WorkingTime: number;
  Status: string;
  Priority: number;
  IsCritical: boolean;
  Resources: {
    Labor: {
      Count: number;
      Cost: number;
      Hours: number;
      Type: string;
      UnitCost: number;
    };
    Equipment: {
      Count: number;
      Cost: number;
      Type: string;
      UnitCost: number;
    };
    Material: {
      Cost: number;
      Type: string;
      Quantity: number;
      UnitCost: number;
    };
  };
  ProjectProperties: {
    BuildingType: string;
    Location: string;
    ConstructionMethod: string;
    TotalArea: number;
    ExpectedDuration: number;
  };
  relatedElements: Array<{
    GlobalId: string;
    Name: string;
    ObjectType: string;
    TaloCode: string;
    PropertySets: Array<{
      name: string;
      properties: Array<{
        name: string;
        value: number | string;
        unit?: string;
      }>;
    }>;
  }>;
}

export class IFCConverter {
  private ifcApi: IfcAPI;
  private modelID: number;

  constructor() {
    this.ifcApi = new IfcAPI();
    this.modelID = -1;
  }

  async initialize() {
    await this.ifcApi.Init();
    this.modelID = this.ifcApi.CreateModel();
  }

  private createOwnerHistory() {
    const person = this.ifcApi.CreateIfcEntity(this.modelID, IFCPERSON, {
      FamilyName: "Project",
      GivenName: "Manager"
    });

    const organization = this.ifcApi.CreateIfcEntity(this.modelID, IFCORGANIZATION, {
      Name: "Construction Company",
      Description: "Main contractor"
    });

    const application = this.ifcApi.CreateIfcEntity(this.modelID, IFCAPPLICATION, {
      ApplicationDeveloper: "Cost Analysis App",
      Version: "1.0",
      ApplicationFullName: "Construction Cost Analysis Application"
    });

    return this.ifcApi.CreateIfcEntity(this.modelID, IFCOWNERHISTORY, {
      OwningUser: person,
      OwningApplication: application,
      CreationDate: new Date().getTime()
    });
  }

  private createProject(ownerHistory: number) {
    return this.ifcApi.CreateIfcEntity(this.modelID, IFCPROJECT, {
      GlobalId: this.ifcApi.CreateGuid(),
      Name: "Construction Project",
      Description: "Construction project with cost analysis",
      OwnerHistory: ownerHistory,
      ObjectType: "PROJECT"
    });
  }

  private createWorkSchedule(ownerHistory: number, projectId: number) {
    return this.ifcApi.CreateIfcEntity(this.modelID, IFCWORKSCHEDULE, {
      GlobalId: this.ifcApi.CreateGuid(),
      OwnerHistory: ownerHistory,
      Name: "Construction Schedule",
      Description: "Detailed construction schedule with cost information",
      ObjectType: "WORKSCHEDULE",
      CreationDate: new Date().getTime()
    });
  }

  private createTask(taskData: IFCScheduleData, ownerHistory: number) {
    const taskId = this.ifcApi.CreateIfcEntity(this.modelID, IFCTASK, {
      GlobalId: taskData.GlobalId,
      OwnerHistory: ownerHistory,
      Name: taskData.Name,
      Description: taskData.Description,
      ObjectType: taskData.ObjectType,
      Identification: taskData.Identification,
      IsMilestone: false,
      Priority: taskData.Priority,
      Status: taskData.Status,
      WorkMethod: taskData.ProjectProperties.ConstructionMethod
    });

    // Crear PropertySet para recursos
    const resourcesPropertySet = this.ifcApi.CreateIfcEntity(this.modelID, IFCPROPERTYSET, {
      GlobalId: this.ifcApi.CreateGuid(),
      OwnerHistory: ownerHistory,
      Name: "Resources",
      Description: "Resource information for task",
      HasProperties: [
        { Name: "LaborCount", Value: taskData.Resources.Labor.Count },
        { Name: "LaborCost", Value: taskData.Resources.Labor.Cost },
        { Name: "EquipmentCount", Value: taskData.Resources.Equipment.Count },
        { Name: "EquipmentCost", Value: taskData.Resources.Equipment.Cost },
        { Name: "MaterialCost", Value: taskData.Resources.Material.Cost }
      ]
    });

    // Crear PropertySet para tiempos
    const timePropertySet = this.ifcApi.CreateIfcEntity(this.modelID, IFCPROPERTYSET, {
      GlobalId: this.ifcApi.CreateGuid(),
      OwnerHistory: ownerHistory,
      Name: "TimeProperties",
      Description: "Time information for task",
      HasProperties: [
        { Name: "StartTime", Value: taskData.StartTime },
        { Name: "FinishTime", Value: taskData.FinishTime },
        { Name: "Duration", Value: taskData.Duration },
        { Name: "WorkingTime", Value: taskData.WorkingTime },
        { Name: "IsCritical", Value: taskData.IsCritical }
      ]
    });

    // Relacionar PropertySets con la tarea
    this.ifcApi.CreateIfcEntity(this.modelID, IFCRELDEFINESBYPROPERTIES, {
      GlobalId: this.ifcApi.CreateGuid(),
      OwnerHistory: ownerHistory,
      RelatedObjects: [taskId],
      RelatingPropertyDefinition: resourcesPropertySet
    });

    this.ifcApi.CreateIfcEntity(this.modelID, IFCRELDEFINESBYPROPERTIES, {
      GlobalId: this.ifcApi.CreateGuid(),
      OwnerHistory: ownerHistory,
      RelatedObjects: [taskId],
      RelatingPropertyDefinition: timePropertySet
    });

    return taskId;
  }

  async convertToIFC(scheduleData: IFCScheduleData[]) {
    await this.initialize();

    const ownerHistory = this.createOwnerHistory();
    const projectId = this.createProject(ownerHistory);
    const workScheduleId = this.createWorkSchedule(ownerHistory, projectId);

    // Crear tareas y sus relaciones
    for (const taskData of scheduleData) {
      const taskId = this.createTask(taskData, ownerHistory);

      // Relacionar la tarea con elementos
      if (taskData.relatedElements.length > 0) {
        this.ifcApi.CreateIfcEntity(this.modelID, IFCRELASSIGNSTOPRODUCT, {
          GlobalId: this.ifcApi.CreateGuid(),
          OwnerHistory: ownerHistory,
          RelatingProduct: taskId,
          RelatedObjects: taskData.relatedElements.map(element => element.GlobalId)
        });
      }
    }

    // Exportar el modelo IFC
    const data = this.ifcApi.SaveModel(this.modelID);
    return new Blob([data], { type: 'application/x-step' });
  }
}

export async function convertScheduleToIFC(scheduleData: IFCScheduleData[]): Promise<Blob> {
  const converter = new IFCConverter();
  return await converter.convertToIFC(scheduleData);
} 