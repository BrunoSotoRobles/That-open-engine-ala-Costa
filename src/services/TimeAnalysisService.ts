import type { BaseCostElement, ConstructionSchedule, ConstructionPhase, TimeEstimates } from '../types/cost';
import { 
  BASE_TIME_ESTIMATES, 
  TIME_ADJUSTMENT_FACTORS, 
  PHASE_DEPENDENCIES,
  BASE_RESOURCE_REQUIREMENTS,
  ELEMENT_INSTALLATION_TIMES 
} from '../data/constructionTimeDatabase';

export class TimeAnalysisService {
  private static instance: TimeAnalysisService;

  private constructor() {}

  public static getInstance(): TimeAnalysisService {
    if (!TimeAnalysisService.instance) {
      TimeAnalysisService.instance = new TimeAnalysisService();
    }
    return TimeAnalysisService.instance;
  }

  public calculateConstructionSchedule(
    elements: BaseCostElement[],
    buildingType: string,
    area: number,
    constructionMethod: string,
    startDate: Date = new Date()
  ): ConstructionSchedule {
    // Get base time estimates
    const baseEstimates = BASE_TIME_ESTIMATES[buildingType.toLowerCase()] || BASE_TIME_ESTIMATES.residential;
    
    // Calculate adjustment factors
    const sizeCategory = area < 1000 ? 'small' : area > 5000 ? 'large' : 'medium';
    const sizeFactor = TIME_ADJUSTMENT_FACTORS.size[sizeCategory];
    const methodFactor = TIME_ADJUSTMENT_FACTORS.constructionMethod[constructionMethod as keyof typeof TIME_ADJUSTMENT_FACTORS.constructionMethod] || 1;
    
    // Calculate season factor based on start date
    const startMonth = startDate.getMonth();
    const seasonFactor = startMonth >= 5 && startMonth <= 7 ? TIME_ADJUSTMENT_FACTORS.season.summer :
                        startMonth >= 2 && startMonth <= 4 ? TIME_ADJUSTMENT_FACTORS.season.spring :
                        startMonth >= 8 && startMonth <= 10 ? TIME_ADJUSTMENT_FACTORS.season.fall :
                        TIME_ADJUSTMENT_FACTORS.season.winter;

    // Adjust durations based on factors
    const adjustedEstimates: TimeEstimates = {
      preparation: Math.round(baseEstimates.preparation * sizeFactor * methodFactor * seasonFactor),
      foundation: Math.round(baseEstimates.foundation * sizeFactor * methodFactor * seasonFactor),
      structure: Math.round(baseEstimates.structure * sizeFactor * methodFactor * seasonFactor),
      envelope: Math.round(baseEstimates.envelope * sizeFactor * methodFactor * seasonFactor),
      interior: Math.round(baseEstimates.interior * sizeFactor * methodFactor * seasonFactor),
      mep: Math.round(baseEstimates.mep * sizeFactor * methodFactor * seasonFactor),
      finishes: Math.round(baseEstimates.finishes * sizeFactor * methodFactor * seasonFactor),
      total: 0 // Will be calculated
    };

    // Calculate element-specific installation times
    const elementTimes = this.calculateElementInstallationTimes(elements);
    
    // Create phases with dependencies
    const phases: ConstructionPhase[] = [];
    let currentDate = new Date(startDate);
    
    // Helper function to add days to a date
    const addDays = (date: Date, days: number): Date => {
      const result = new Date(date);
      result.setDate(result.getDate() + days);
      return result;
    };

    // Create phases
    Object.entries(adjustedEstimates).forEach(([phaseName, duration]) => {
      if (phaseName === 'total') return;

      const dependencies = PHASE_DEPENDENCIES[phaseName as keyof typeof PHASE_DEPENDENCIES] || [];
      const resources = BASE_RESOURCE_REQUIREMENTS[phaseName as keyof typeof BASE_RESOURCE_REQUIREMENTS];
      
      // Calculate start date based on dependencies
      let phaseStartDate = new Date(currentDate);
      if (dependencies.length > 0) {
        const dependencyEndDates = dependencies.map(dep => {
          const dependencyPhase = phases.find(p => p.name === dep);
          return dependencyPhase ? dependencyPhase.endDate : currentDate;
        });
        phaseStartDate = new Date(Math.max(...dependencyEndDates.map(d => d.getTime())));
      }

      const phase: ConstructionPhase = {
        name: phaseName,
        startDate: phaseStartDate,
        endDate: addDays(phaseStartDate, duration),
        duration,
        dependencies,
        progress: 0,
        resources: {
          labor: Math.ceil(resources.labor * (area / 1000)),
          equipment: Math.ceil(resources.equipment * (area / 1000))
        }
      };

      phases.push(phase);
      currentDate = phase.endDate;
    });

    // Calculate critical path
    const criticalPath = this.calculateCriticalPath(phases);
    
    // Mark critical path phases
    phases.forEach(phase => {
      phase.isCritical = criticalPath.includes(phase.name);
    });

    // Calculate total duration
    const totalDuration = Math.max(...phases.map(p => {
      const endTime = p.endDate.getTime();
      const startTime = startDate.getTime();
      return Math.ceil((endTime - startTime) / (1000 * 60 * 60 * 24));
    }));

    return {
      startDate,
      endDate: addDays(startDate, totalDuration),
      totalDuration,
      phases,
      criticalPath
    };
  }

  private calculateElementInstallationTimes(elements: BaseCostElement[]): number {
    return elements.reduce((total, element) => {
      const elementType = element.type as keyof typeof ELEMENT_INSTALLATION_TIMES;
      const times = ELEMENT_INSTALLATION_TIMES[elementType] || ELEMENT_INSTALLATION_TIMES.default;
      
      const installationTime = (times.preparation + times.installation + (times.curing || 0)) * 
                             (element.quantity || 1);
      
      return total + installationTime;
    }, 0);
  }

  private calculateCriticalPath(phases: ConstructionPhase[]): string[] {
    // Simple critical path calculation
    // In reality, you might want to use a more sophisticated algorithm
    const path: string[] = [];
    let currentPhase = phases[phases.length - 1];
    
    while (currentPhase) {
      path.unshift(currentPhase.name);
      
      // Find the dependency with the latest end date
      const dependencies = currentPhase.dependencies;
      if (dependencies.length === 0) break;
      
      const latestDependency = phases
        .filter(p => dependencies.includes(p.name))
        .reduce((latest, current) => 
          latest.endDate > current.endDate ? latest : current
        );
      
      currentPhase = latestDependency;
    }
    
    return path;
  }
} 