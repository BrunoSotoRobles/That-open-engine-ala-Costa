import * as React from "react";
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title, PointElement, LineElement, RadialLinearScale } from 'chart.js';
import { Doughnut, Bar, Radar } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import { useCostStore } from '../stores/CostStore';
import type { Language } from '../stores/CostStore';
import type { BaseCostElement, BaseProjectInfo as StoreBaseProjectInfo, RTKorttiDetails, CostFactors, ModernCostValues, UnifiedCostValues, ConstructionPhase, ConstructionSchedule as StoreConstructionSchedule } from '../types/cost';
import { fromUnifiedCostValues } from '../types/cost';
import { costAnalysisTranslations, getTranslation } from '../locales/costAnalysis';
import { loadSampleCostData } from '../utils/loadSampleCostData';
import { STATFIN_COST_INDEX_CONFIG, getUpdateFactor } from '../data/statfinCostIndexConfig';
import { TALO_2000_MEASUREMENTS, expandTaloCode, isValidTalo2000Code } from '../constants/talo2000';
import { getCorrectUnit, getCorrectQuantity, getQuantityForLitteraCodeByType, litteraUnitToTalo2000Unit } from '../constants/talo2000';
import { Talo2000Unit } from '../types/talo2000';
import { TimeAnalysisService } from '../services/TimeAnalysisService';
import { BOQExportComponent } from './BOQExportComponent';
import { EnhancedBOQExportComponent } from './EnhancedBOQExportComponent';
import { CostTableExcelStyle } from './CostTableExcelStyle';
import { ProjectInfoCard, type ProjectInfoCardProps } from './ProjectInfoCard';
import { LanguageSelector } from './LanguageSelector';
import type { TaloSuggestion } from '../services/TaloSuggestionService';
import { suggestTaloAssignments } from '../services/TaloSuggestionService';
import { suggestLitteraAssignments } from '../services/LitteraSuggestionService';
import { useLitteraDict } from '../hooks/useLitteraDict';
import { getPriceForLittera } from '../services/litteraPrices';
import { LitteraValidationPanel } from './LitteraValidationPanel';
import { TaloLitteraMappingService } from '../services/TaloLitteraMappingService';
import { LitteraFilteringService } from '../services/LitteraFilteringService';
import { exposeValidationToConsole } from '../utils/exposeValidation';
import { normalizeRevitName, getUnitsForIFCType, buildGroupedData, calculateBaseQuantitiesByUnitForElements, stripExcelGroupNameSuffix, pickAssemblyGroupLead, assemblyHostCount, groupMaaraAreaM2, groupMaaraVolumeM3, groupMaaraLengthM } from '../utils/costTableGrouping';
import { contributesToMaara } from '../utils/layerAssemblyPolicy';
import { normalizeBuildingTypeKey, normalizeConstructionMethodKey } from '../utils/projectInfoNormalization';
import { MAIN_GROUPS, getMainGroupFromTaloCode, getMainGroupFromLitteraCode } from '../utils/costGroupUtils';
import { headerCase } from '../utils/textUtils';
import { SYNC_COLUMNS, SYNC_SHEET_NAME, type SyncImportResult } from '../constants/costSyncFormat';
import { useLibraryStore } from '../stores/LibraryStore';
import type { CostLibrary, LibraryEntry, CostPerUnit } from '../types/library';
import { validateCostLibrary } from '../utils/costLibraryValidation';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { setupMCPWebSocket } from '../bim_components/setup/websocket-client';
import {
  isConfirmedOntelolaattaElement,
  litteraCodesForConfirmedOntelolaatta,
} from '../utils/ontelolaattaLitteraPackage';

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  PointElement,
  LineElement,
  RadialLinearScale
);

interface Props {}

interface CostAnalysisResult {
  metrics: {
    costPerArea: number;
    costPerVolume?: number;
    percentageByCategory: { [category: string]: number };
  };
}

type ProjectType = 'residential' | 'commercial' | 'industrial' | 'infrastructure';

interface BaseProjectInfo {
  name: string;
  area: number;
  huoneistoala?: number;
  type: ProjectType;
  location: string;
  buildingType: string;
  constructionMethod: string;
}

interface ProjectInfo extends BaseProjectInfo {
  type: ProjectType;
  buildingType: string;
  constructionMethod: string;
  area: number;
  location: string;
}

interface ConstructionSchedule {
  startDate: Date;
  endDate: Date;
  totalDuration: number;
  phases: ConstructionPhase[];
  criticalPath: string[];
}

const LoadingState = ({ language }: { language: Language }) => (
  <div className="loading-container">
    <div className="spinner"></div>
    <p>{getTranslation(['emptyState', 'loading'], language)}</p>
  </div>
);

const EmptyState = ({ language }: { language: Language }) => {
  const t = (key: string) => getTranslation(['emptyState', key], language);
  return (
  <div className="main-page-content" style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
    <div className="empty-state-cost">
      <span className="material-icons-round empty-state-cost-icon">
        monetization_on
      </span>
      <h2 className="empty-state-cost-title">
        {headerCase(getTranslation(['noDataMessage'], language))}
      </h2>
      <p className="empty-state-cost-description">
        {t('intro')}
      </p>
      <div className="instructions-grid">
        <div className="instruction-card">
          <div className="instruction-header">
            <span className="material-icons-round instruction-icon">upload_file</span>
            <strong className="instruction-title">{t('step1Title')}</strong>
          </div>
          <p className="instruction-text">
            {t('step1Text')}
          </p>
        </div>
        <div className="instruction-card">
          <div className="instruction-header">
            <span className="material-icons-round instruction-icon">calculate</span>
            <strong className="instruction-title">{t('step2Title')}</strong>
          </div>
          <p className="instruction-text">
            {t('step2Text')}
          </p>
        </div>
        <div className="instruction-card">
          <div className="instruction-header">
            <span className="material-icons-round instruction-icon">analytics</span>
            <strong className="instruction-title">{t('step3Title')}</strong>
          </div>
          <p className="instruction-text">
            {t('step3Text')}
          </p>
        </div>
      </div>
      <div className="info-box">
        <h3 className="info-title">
          <span className="material-icons-round" style={{ fontSize: '18px' }}>info</span>
          {headerCase(t('infoTitle'))}
        </h3>
        <p className="info-text">
          {t('infoText')}
        </p>
      </div>
      <button 
        onClick={loadSampleCostData}
        className="action-button"
      >
        <span className="material-icons-round">dataset</span>
        {getTranslation(['actions', 'loadSample'], language)}
      </button>
    </div>
  </div>
  );
};

const CostSummaryCard = ({ 
  summary, 
  language 
}: { 
  summary: { 
    totalMaterial: number;
    totalLabor: number;
    totalSubcontract: number;
    grandTotal: number;
  };
  language: Language;
}) => (
    <div className="dashboard-card">
    <div className="card-header">
      <h3>{headerCase(getTranslation(['analysisSections', 'summary'], language) ?? '')}</h3>
    </div>
    <div className="data-cards-grid">
      <div className="data-card cost-material-card">
        <div className="data-card-header">
          <h4 className="data-card-title">{headerCase(getTranslation(['costTypes', 'material'], language) ?? '')}</h4>
        </div>
        <div className="data-card-content">
          <div className="metrics-container">
            <div className="metric-item">
              <div className="metric-label">Cost</div>
              <div className="metric-value">
                {summary.totalMaterial.toFixed(2)}
                <span className="metric-unit">€</span>
              </div>
            </div>
            <div className="metric-item">
              <div className="metric-label">Percentage</div>
              <div className="metric-value">
                {((summary.totalMaterial / summary.grandTotal) * 100).toFixed(1)}
                <span className="metric-unit">% of total</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="data-card cost-labor-card">
        <div className="data-card-header">
          <h4 className="data-card-title">{headerCase(getTranslation(['costTypes', 'labor'], language) ?? '')}</h4>
        </div>
        <div className="data-card-content">
          <div className="metrics-container">
            <div className="metric-item">
              <div className="metric-label">Cost</div>
              <div className="metric-value">
                {summary.totalLabor.toFixed(2)}
                <span className="metric-unit">€</span>
              </div>
            </div>
            <div className="metric-item">
              <div className="metric-label">Percentage</div>
              <div className="metric-value">
                {((summary.totalLabor / summary.grandTotal) * 100).toFixed(1)}
                <span className="metric-unit">% of total</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="data-card cost-subcontract-card">
        <div className="data-card-header">
          <h4 className="data-card-title">{headerCase(getTranslation(['costTypes', 'subcontract'], language) ?? '')}</h4>
        </div>
        <div className="data-card-content">
          <div className="metrics-container">
            <div className="metric-item">
              <div className="metric-label">Cost</div>
              <div className="metric-value">
                {summary.totalSubcontract.toFixed(2)}
                <span className="metric-unit">€</span>
              </div>
            </div>
            <div className="metric-item">
              <div className="metric-label">Percentage</div>
              <div className="metric-value">
                {((summary.totalSubcontract / summary.grandTotal) * 100).toFixed(1)}
                <span className="metric-unit">% of total</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="data-card cost-total-card">
        <div className="data-card-header">
          <h4 className="data-card-title">{headerCase('Total project cost')}</h4>
        </div>
        <div className="data-card-content">
          <div className="metrics-container">
            <div className="metric-item">
              <div className="metric-label">Grand Total</div>
              <div className="metric-value">
                {summary.grandTotal.toFixed(2)}
                <span className="metric-unit">€</span>
              </div>
            </div>
            <div className="metric-item">
              <div className="metric-label">Total Work Hours</div>
              <div className="metric-value">
                {summary.totalLabor > 0 ? (summary.totalLabor / 45).toFixed(1) : '0.0'}
                <span className="metric-unit">hours</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const OmaTyoVsSubcontractPanel = ({
  elements,
  costSummary,
  language,
  projectInfo,
}: {
  elements: BaseCostElement[];
  costSummary: {
    totalMaterial: number;
    totalLabor: number;
    totalSubcontract: number;
    grandTotal: number;
  };
  language: Language;
  projectInfo: ProjectInfo | null;
}) => {
  const totalLaborCost = costSummary.totalLabor;
  const totalSubcontractCost = costSummary.totalSubcontract;
  const laborAndSubTotal = totalLaborCost + totalSubcontractCost;

  const projectType: ProjectType = projectInfo?.type ?? 'residential';
  const defaultBuildingServicesPercent = (() => {
    switch (projectType) {
      case 'residential': return 18;
      case 'commercial': return 22;
      case 'industrial': return 25;
      case 'infrastructure': return 15;
      default: return 18;
    }
  })();
  const [buildingServicesPercent, setBuildingServicesPercent] = React.useState<number>(defaultBuildingServicesPercent);
  const buildingServicesTotal = costSummary.grandTotal > 0
    ? (costSummary.grandTotal * buildingServicesPercent) / 100
    : 0;
  const projectTypeLabel =
    getTranslation(['projectTypes', projectType], language) ?? headerCase(projectType);

  let areaLabor = 0;
  let areaSubcontract = 0;
  let volumeLabor = 0;
  let volumeSubcontract = 0;
  let countLabor = 0;
  let countSubcontract = 0;

  elements.forEach((el) => {
    const labor = el.costs.labor;
    const subcontract = el.costs.subcontract;
    const mixTotal = labor + subcontract;
    if (mixTotal <= 0) return;

    const laborShare = labor / mixTotal;
    const subcontractShare = subcontract / mixTotal;

    const area =
      el.baseQuantities?.Area?.value ??
      el.baseQuantities?.GrossArea?.value ??
      el.baseQuantities?.NetArea?.value ??
      0;
    const volume =
      el.baseQuantities?.Volume?.value ??
      el.baseQuantities?.GrossVolume?.value ??
      el.baseQuantities?.NetVolume?.value ??
      0;
    const length = el.baseQuantities?.Length?.value ?? 0;
    const count = el.quantity ?? 0;

    if (area > 0) {
      areaLabor += area * laborShare;
      areaSubcontract += area * subcontractShare;
    }
    if (volume > 0) {
      volumeLabor += volume * laborShare;
      volumeSubcontract += volume * subcontractShare;
    }
    if (length > 0 && area === 0 && volume === 0) {
      // Solo usar longitud cuando no hay área/volumen
      countLabor += length * laborShare;
      countSubcontract += length * subcontractShare;
    } else if (count > 0 && area === 0 && volume === 0 && length === 0) {
      countLabor += count * laborShare;
      countSubcontract += count * subcontractShare;
    }
  });

  const totalArea = areaLabor + areaSubcontract;
  const totalVolume = volumeLabor + volumeSubcontract;
  const totalCount = countLabor + countSubcontract;

  return (
    <div className="dashboard-card">
      <div className="card-header">
        <h3>
          {headerCase(
            getTranslation(['analysisSections', 'breakdown'], language) ??
              'Oma työ vs Subcontract'
          )}
        </h3>
        {projectInfo && (
          <p className="info-text">
            {projectInfo.buildingType} · {projectInfo.constructionMethod}
          </p>
        )}
      </div>
      <div
        className="data-cards-grid"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '16px',
          justifyContent: 'space-between'
        }}
      >
        <div className="data-card" style={{ maxWidth: 'none', flex: '1 1 0' }}>
          <div className="data-card-header">
            <h4 className="data-card-title">
              {headerCase(
                getTranslation(['metrics', 'laborCostRatio'], language) ??
                  'Labor vs Subcontract – Cost share'
              )}
            </h4>
          </div>
          <div className="data-card-content">
            <div className="metrics-container">
              <div className="metric-item">
                <div className="metric-label">
                  {getTranslation(['costTypes', 'labor'], language) ?? 'Labor'}
                </div>
                <div className="metric-value">
                  {laborAndSubTotal > 0
                    ? ((totalLaborCost / laborAndSubTotal) * 100).toFixed(1)
                    : '0.0'}
                  <span className="metric-unit">% of labor + subcontract cost</span>
                </div>
                <div className="metric-subvalue">
                  {totalLaborCost.toFixed(2)}
                  <span className="metric-unit">€</span>
                </div>
              </div>
              <div className="metric-item">
                <div className="metric-label">
                  {getTranslation(
                    ['costTypes', 'subcontract'],
                    language
                  ) ?? 'Subcontract'}
                </div>
                <div className="metric-value">
                  {laborAndSubTotal > 0
                    ? ((totalSubcontractCost / laborAndSubTotal) * 100).toFixed(1)
                    : '0.0'}
                  <span className="metric-unit">% of labor + subcontract cost</span>
                </div>
                <div className="metric-subvalue">
                  {totalSubcontractCost.toFixed(2)}
                  <span className="metric-unit">€</span>
                </div>
              </div>
            </div>
            <p
              style={{
                fontSize: '0.8em',
                color: 'var(--text-3)',
                marginTop: '0.75rem',
                marginBottom: 0
              }}
            >
              {getTranslation(['breakdownNotes', 'laborVsSubCost'], language) ??
                'Shows how total labor and subcontract costs are distributed within all work costs (labor + subcontract). External MEP / LVIS costs entered outside the model are not included.'}
            </p>
          </div>
        </div>

        <div className="data-card" style={{ maxWidth: 'none', flex: '1 1 0' }}>
          <div className="data-card-header">
            <h4 className="data-card-title">
              {headerCase(
                getTranslation(['metrics', 'subcontractCostRatio'], language) ??
                  'Labor vs Subcontract – Quantity share'
              )}
            </h4>
          </div>
          <div className="data-card-content">
            <div className="metrics-container">
              {totalArea > 0 && (
                <div className="metric-item">
                  <div className="metric-label">Area (m²)</div>
                  <div className="metric-value">
                    {((areaLabor / totalArea) * 100).toFixed(1)}%
                    <span className="metric-unit">
                      {' '}
                      {getTranslation(['costTypes', 'labor'], language) ??
                        'Labor'}
                    </span>
                  </div>
                  <div className="metric-subvalue">
                    {((areaSubcontract / totalArea) * 100).toFixed(1)}%{' '}
                    {getTranslation(
                      ['costTypes', 'subcontract'],
                      language
                    ) ?? 'Subcontract'}
                  </div>
                </div>
              )}
              {totalVolume > 0 && (
                <div className="metric-item">
                  <div className="metric-label">Volume (m³)</div>
                  <div className="metric-value">
                    {((volumeLabor / totalVolume) * 100).toFixed(1)}%
                    <span className="metric-unit">
                      {' '}
                      {getTranslation(['costTypes', 'labor'], language) ??
                        'Labor'}
                    </span>
                  </div>
                  <div className="metric-subvalue">
                    {((volumeSubcontract / totalVolume) * 100).toFixed(1)}%{' '}
                    {getTranslation(
                      ['costTypes', 'subcontract'],
                      language
                    ) ?? 'Subcontract'}
                  </div>
                </div>
              )}
              {totalCount > 0 && (
                <div className="metric-item">
                  <div className="metric-label">Count / length</div>
                  <div className="metric-value">
                    {((countLabor / totalCount) * 100).toFixed(1)}%
                    <span className="metric-unit">
                      {' '}
                      {getTranslation(['costTypes', 'labor'], language) ??
                        'Labor'}
                    </span>
                  </div>
                  <div className="metric-subvalue">
                    {((countSubcontract / totalCount) * 100).toFixed(1)}%{' '}
                    {getTranslation(
                      ['costTypes', 'subcontract'],
                      language
                    ) ?? 'Subcontract'}
                  </div>
                </div>
              )}
              {totalArea === 0 && totalVolume === 0 && totalCount === 0 && (
                <div className="metric-item">
                  <div className="metric-label">
                    No base quantities available to compute quantity share.
                  </div>
                </div>
              )}
            </div>
            <p
              style={{
                fontSize: '0.8em',
                color: 'var(--text-3)',
                marginTop: '0.75rem',
                marginBottom: 0
              }}
            >
              {getTranslation(['breakdownNotes', 'laborVsSubQty'], language) ??
                'Compares labor vs subcontract share based on measured quantities (area, volume, count), not on costs. External MEP / LVIS quantities outside the model are not included.'}
            </p>
          </div>
        </div>

        <div className="data-card" style={{ maxWidth: 'none', flex: '1 1 0' }}>
          <div className="data-card-header">
            <h4 className="data-card-title">
              {headerCase(
                getTranslation(['metrics', 'buildingServicesEstimate'], language) ??
                  'MEP / LVIS Cost (Estimate)'
              )}
            </h4>
          </div>
          <div className="data-card-content">
            <div className="metrics-container">
              <div className="metric-item">
                <div className="metric-label">
                  {getTranslation(['buildingServices', 'projectType'], language) ?? 'Project type'}
                </div>
                <div className="metric-value" style={{ fontSize: '0.9em', fontWeight: 'normal' }}>
                  {projectTypeLabel}
                </div>
              </div>
              {projectInfo?.area && projectInfo.area > 0 && (
                <div className="metric-item">
                  <div className="metric-label">
                    {getTranslation(['buildingServices', 'grossArea'], language) ?? 'Gross area'}
                  </div>
                  <div className="metric-value" style={{ fontSize: '0.9em', fontWeight: 'normal' }}>
                    {projectInfo.area.toFixed(1)} {getTranslation(['units', 'area'], language) ?? 'm²'}
                  </div>
                </div>
              )}
              <div className="metric-item">
                <div className="metric-label">
                  {getTranslation(['buildingServices', 'shareOfModel'], language) ?? 'Share of current model'}
                </div>
                <div
                  className="metric-value"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}
                >
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={buildingServicesPercent}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '') return;
                      const n = Number(v);
                      if (Number.isFinite(n) && n >= 0) setBuildingServicesPercent(n);
                    }}
                    style={{
                      width: '72px',
                      padding: '4px 6px',
                      borderRadius: '4px',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--surface-1)',
                      color: 'var(--text-1)',
                    }}
                  />
                  <span className="metric-unit">
                    % ({getTranslation(['buildingServices', 'roughEstimate'], language) ?? 'rough estimate'})
                  </span>
                </div>
              </div>
              <div className="metric-item">
                <div className="metric-label">
                  {getTranslation(['buildingServices', 'totalEstimated'], language) ??
                    'Total estimated building services'}
                </div>
                <div className="metric-value">
                  {buildingServicesTotal.toFixed(2)}
                  <span className="metric-unit">
                    {getTranslation(['units', 'currency'], language) ?? '€'}
                  </span>
                </div>
              </div>
            </div>
            <p style={{ fontSize: '0.8em', color: 'var(--text-3)', marginTop: '0.75rem', marginBottom: 0 }}>
              {getTranslation(['buildingServices', 'note'], language) ??
                'This card provides a rough estimate based on the current model. Adjust the percentage according to your own experience and project type.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const CostBreakdownChart = ({ 
  elements, 
  language 
}: { 
  elements: BaseCostElement[];
  language: Language;
}) => {
  const data = {
    labels: [
      getTranslation(['costTypes', 'material'], language),
      getTranslation(['costTypes', 'labor'], language),
      getTranslation(['costTypes', 'subcontract'], language)
    ],
    datasets: [{
      data: [
        elements.reduce((sum, el) => sum + el.costs.material, 0),
        elements.reduce((sum, el) => sum + el.costs.labor, 0),
        elements.reduce((sum, el) => sum + el.costs.subcontract, 0)
      ],
      backgroundColor: [
        'rgba(54, 162, 235, 0.8)',
        'rgba(75, 192, 192, 0.8)',
        'rgba(255, 99, 132, 0.8)'
      ]
    }]
  };

  const options: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right' as const,
        labels: {
          font: {
            size: 12
          },
          padding: 10
        }
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const value = context.raw as number;
            const total = (context.dataset.data as number[]).reduce((a, b) => a + b, 0);
            const percentage = ((value / total) * 100).toFixed(1);
            return `${context.label}: ${value.toFixed(2)}€ (${percentage}%)`;
          }
        }
      }
    }
  };

  return (
    <div style={{ height: '300px', position: 'relative' }}>
      <Doughnut data={data} options={options} />
    </div>
  );
};

interface GroupedElement {
  taloCode: string;
  name: string;
  normalizedName: string; // Nombre normalizado (sin sufijos numéricos de Revit)
  quantity: number;
  unit: string;
  baseQuantities: BaseCostElement['baseQuantities'];
  costs: BaseCostElement['costs'];
  items: BaseCostElement[];
}

// Factores de costo por defecto (usados por CostPage; definidos aquí para una sola fuente de verdad)
const DEFAULT_COST_FACTORS: CostFactors = {
  location: {
    helsinki: 1.15,
    espoo: 1.12,
    vantaa: 1.10,
    tampere: 1.05,
    turku: 1.03,
    oulu: 1.00,
    other: 0.95
  },
  buildingType: {
    residential: 1.00,
    office: 1.10,
    commercial: 1.15,
    industrial: 0.90,
    public: 1.05
  },
  constructionMethod: {
    traditional: 1.00,
    prefabricated: 0.95,
    modular: 0.90,
    renovation: 1.20
  },
  projectSize: {
    small: 1.15,    // < 1000m²
    medium: 1.00,   // 1000-5000m²
    large: 0.90     // > 5000m²
  }
};


const DatabaseInfo = ({ hasData }: { hasData: boolean }) => {
  const headerMsg = {
    fontSize: '0.9em',
    fontWeight: 500,
    color: 'var(--text-2)'
  } as React.CSSProperties;
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '5px 10px',
      borderRadius: '5px',
      backgroundColor: 'var(--surface-2)',
      ...headerMsg
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, lineHeight: 1.25, maxWidth: '200px', ...headerMsg }}>
        <span style={headerMsg}>Finnish Construction Cost Database · COSTA Laskenta Oy</span>
        <span style={{ ...headerMsg, color: 'var(--text-3)', fontSize: '0.95em' }}>
          Base {STATFIN_COST_INDEX_CONFIG.basePeriod}
          {STATFIN_COST_INDEX_CONFIG.lastFetchedAt ? ` · Index ${STATFIN_COST_INDEX_CONFIG.lastFetchedAt.slice(0, 7)}` : ''}
        </span>
      </div>
      {hasData && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          marginLeft: '4px',
          paddingLeft: '8px',
          borderLeft: '1px solid var(--border)',
          fontSize: '0.9em',
          fontWeight: 500,
          color: 'var(--success)'
        }}>
          <span className="material-icons-round" style={{ fontSize: '0.9em' }}>check_circle</span>
          <span style={{ fontSize: '0.9em', fontWeight: 500 }}>Data Active</span>
        </div>
      )}
    </div>
  );
};

// Componente para seleccionar factores de costo
const CostFactorsSelector = ({ 
  factors, 
  onChange 
}: { 
  factors: CostFactors, 
  onChange: (factors: CostFactors) => void 
}) => (
  <div className="cost-factors">
    <div className="factor-group">
      <span className="factor-label">Location:</span>
      <select 
        onChange={(e) => onChange({
          ...factors,
          location: { ...factors.location, selected: e.target.value }
        })}
      >
        {Object.keys(factors.location).map(city => (
          <option key={city} value={city}>
            {city.charAt(0).toUpperCase() + city.slice(1)}
          </option>
        ))}
      </select>
      </div>
    <div className="factor-group">
      <span className="factor-label">Building Type:</span>
      <select
        onChange={(e) => onChange({
          ...factors,
          buildingType: { ...factors.buildingType, selected: e.target.value }
        })}
      >
        {Object.keys(factors.buildingType).map(type => (
          <option key={type} value={type}>
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </option>
        ))}
      </select>
    </div>
    <div className="factor-group">
      <span className="factor-label">Construction Method:</span>
      <select
        onChange={(e) => onChange({
          ...factors,
          constructionMethod: { ...factors.constructionMethod, selected: e.target.value }
        })}
      >
        {Object.keys(factors.constructionMethod).map(method => (
          <option key={method} value={method}>
            {method.charAt(0).toUpperCase() + method.slice(1)}
          </option>
        ))}
      </select>
      </div>
    </div>
  );

// Función para calcular el costo total con factores
const calculateAdjustedCost = (baseCost: number, factors: CostFactors, area: number) => {
  const locationFactor = Number(factors.location[factors.location.selected as keyof typeof factors.location] ?? factors.location.oulu);
  const typeFactor = Number(factors.buildingType[factors.buildingType.selected as keyof typeof factors.buildingType] ?? factors.buildingType.residential);
  const methodFactor = Number(factors.constructionMethod[factors.constructionMethod.selected as keyof typeof factors.constructionMethod] ?? factors.constructionMethod.traditional);
  const sizeFactor = area < 1000 ? factors.projectSize.small :
                    area > 5000 ? factors.projectSize.large :
                    factors.projectSize.medium;
  
  return baseCost * locationFactor * typeFactor * methodFactor * sizeFactor;
};

const BuildingTypeSelector = ({ value, onChange, language }: { 
  value: string;
  onChange: (value: string) => void;
  language: Language;
}) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: 'var(--surface-2)',
    padding: '8px 16px',
    borderRadius: '8px'
  }}>
    <span className="material-icons-round" style={{ fontSize: '20px' }}>apartment</span>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: 'transparent',
        border: 'none',
        color: 'var(--text-2)',
        fontSize: '0.9em',
        cursor: 'pointer'
      }}
    >
      <option value="residential">Residential</option>
      <option value="commercial">Commercial</option>
      <option value="industrial">Industrial</option>
      <option value="infrastructure">Infrastructure</option>
    </select>
  </div>
);

const ConstructionMethodSelector = ({ value, onChange, language }: { 
  value: string;
  onChange: (value: string) => void;
  language: Language;
}) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: 'var(--surface-2)',
    padding: '8px 16px',
    borderRadius: '8px'
  }}>
    <span className="material-icons-round" style={{ fontSize: '20px' }}>construction</span>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: 'transparent',
        border: 'none',
        color: 'var(--text-2)',
        fontSize: '0.9em',
        cursor: 'pointer'
      }}
    >
      <option value="traditional">{getTranslation(['constructionMethods', 'traditional'], language)}</option>
      <option value="prefabricated">{getTranslation(['constructionMethods', 'prefabricated'], language)}</option>
      <option value="modular">{getTranslation(['constructionMethods', 'modular'], language)}</option>
      <option value="renovation">{getTranslation(['constructionMethods', 'renovation'], language)}</option>
    </select>
  </div>
);

const FINNISH_BUILDING_BENCHMARKS = {
  residential: {
    material: { avg: 1250, min: 1000, max: 1500 },
    labor: { avg: 850, min: 700, max: 1000 },
    subcontract: { avg: 350, min: 250, max: 450 },
    total: { avg: 2300, min: 1850, max: 2750 }
  },
  commercial: {
    material: { avg: 1400, min: 1200, max: 1600 },
    labor: { avg: 950, min: 800, max: 1100 },
    subcontract: { avg: 450, min: 350, max: 550 },
    total: { avg: 2600, min: 2200, max: 3000 }
  },
  industrial: {
    material: { avg: 1000, min: 800, max: 1200 },
    labor: { avg: 700, min: 600, max: 800 },
    subcontract: { avg: 480, min: 400, max: 550 },
    total: { avg: 2000, min: 1650, max: 2350 }
  }
};

const REGIONAL_BENCHMARKS = {
  capital: {
    material: 1300,
    labor: 900,
    subcontract: 370
  }
};

/** Cost breakdown by main group (pääryhmä) - €/hm² or €/m² per group (Kauppinen thesis style) */
const CostByGroupChart = ({
  costData,
  costSummary,
  projectInfo,
  language
}: {
  costData: BaseCostElement[];
  costSummary: { grandTotal: number };
  projectInfo: ProjectInfo | null;
  language: Language;
}) => {
  const projectArea = projectInfo?.area || 1;
  const projectHm2 = (projectInfo as { huoneistoala?: number })?.huoneistoala;
  const divisor = projectHm2 && projectHm2 > 0 ? projectHm2 : projectArea;
  const unitLabel = projectHm2 && projectHm2 > 0 ? '€/hm²' : '€/m²';

  const byGroup = React.useMemo(() => {
    const map = new Map<number, number>();
    for (const el of costData) {
      let g = getMainGroupFromTaloCode(el.taloCode || '');
      if (g < 0 && el.litteraCodes?.length) {
        g = getMainGroupFromLitteraCode(el.litteraCodes[0]?.litteraCode || '');
      }
      if (g < 0) g = 10; // "Other"
      const prev = map.get(g) ?? 0;
      map.set(g, prev + (el.costs?.total ?? 0));
    }
    return map;
  }, [costData]);

  const rows = MAIN_GROUPS.map((mg) => ({
    ...mg,
    total: byGroup.get(mg.id) ?? 0
  })).concat(
    (byGroup.get(10) ?? 0) > 0 ? [{ id: 10, nameFi: 'Muu', nameEn: 'Other', total: byGroup.get(10) ?? 0 }] : []
  ).filter((r) => r.total > 0);

  if (rows.length === 0) return null;

  return (
    <div className="dashboard-card">
      <div className="card-header">
        <h3>{language === 'fi' ? 'Kustannusjakauma pääryhmittäin' : 'Cost breakdown by main group'}</h3>
      </div>
      <div style={{ padding: '1rem' }}>
        <p style={{ fontSize: '0.9em', color: 'var(--text-2)', marginBottom: '1rem' }}>
          {language === 'fi'
            ? 'Kustannukset ryhmiteltynä Talo 80 -tyylin pääryhmien mukaan. Vertailuyksikkö: ' + unitLabel
            : 'Costs grouped by Talo 80-style main groups. Comparison unit: ' + unitLabel}
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '8px' }}>#</th>
                <th style={{ textAlign: 'left', padding: '8px' }}>{language === 'fi' ? 'Ryhmä' : 'Group'}</th>
                <th style={{ textAlign: 'right', padding: '8px' }}>€</th>
                <th style={{ textAlign: 'right', padding: '8px' }}>{unitLabel}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px' }}>{r.id === 10 ? '–' : r.id}</td>
                  <td style={{ padding: '8px' }}>{language === 'fi' ? r.nameFi : r.nameEn}</td>
                  <td style={{ textAlign: 'right', padding: '8px' }}>{r.total.toFixed(0)}</td>
                  <td style={{ textAlign: 'right', padding: '8px' }}>{(r.total / divisor).toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const CostComparisonChart = ({ 
  costSummary,
  projectInfo,
  language 
}: { 
  costSummary: {
    totalMaterial: number;
    totalLabor: number;
    totalSubcontract: number;
    grandTotal: number;
  };
  projectInfo: ProjectInfo | null;
  language: Language;
}) => {
  const buildingType = projectInfo?.buildingType?.toLowerCase() || 'residential';
  const benchmarkBase = FINNISH_BUILDING_BENCHMARKS[buildingType as keyof typeof FINNISH_BUILDING_BENCHMARKS] || FINNISH_BUILDING_BENCHMARKS.residential;
  const btKey = buildingType as keyof typeof STATFIN_COST_INDEX_CONFIG.byBuildingType;
  const indexEntry = STATFIN_COST_INDEX_CONFIG.byBuildingType[btKey] ?? STATFIN_COST_INDEX_CONFIG.byBuildingType.residential;
  const benchmarkFactor = getUpdateFactor(indexEntry);
  const benchmark = {
    material: { avg: benchmarkBase.material.avg * benchmarkFactor, min: benchmarkBase.material.min * benchmarkFactor, max: benchmarkBase.material.max * benchmarkFactor },
    labor: { avg: benchmarkBase.labor.avg * benchmarkFactor, min: benchmarkBase.labor.min * benchmarkFactor, max: benchmarkBase.labor.max * benchmarkFactor },
    subcontract: { avg: benchmarkBase.subcontract.avg * benchmarkFactor, min: benchmarkBase.subcontract.min * benchmarkFactor, max: benchmarkBase.subcontract.max * benchmarkFactor },
    total: { avg: benchmarkBase.total.avg * benchmarkFactor, min: benchmarkBase.total.min * benchmarkFactor, max: benchmarkBase.total.max * benchmarkFactor },
  };
  const capitalAdjusted = {
    material: REGIONAL_BENCHMARKS.capital.material * benchmarkFactor,
    labor: REGIONAL_BENCHMARKS.capital.labor * benchmarkFactor,
    subcontract: REGIONAL_BENCHMARKS.capital.subcontract * benchmarkFactor,
  };
  const projectArea = projectInfo?.area || 1;
  const projectHm2 = (projectInfo as { huoneistoala?: number })?.huoneistoala;
  const divisorHm2 = projectHm2 && projectHm2 > 0 ? projectHm2 : null;

  // Calcular costos por m² (3 conceptos: Material, Labor, Subcontract)
  const projectCosts = {
    material: costSummary.totalMaterial / projectArea,
    labor: costSummary.totalLabor / projectArea,
    subcontract: costSummary.totalSubcontract / projectArea,
  };

  const data = {
    labels: [
      getTranslation(['costTypes', 'material'], language),
      getTranslation(['costTypes', 'labor'], language),
      getTranslation(['costTypes', 'subcontract'], language),
    ],
    datasets: [
      {
        label: getTranslation(['comparison', 'yourProject'], language),
        data: [
          projectCosts.material,
          projectCosts.labor,
          projectCosts.subcontract,
        ],
        backgroundColor: 'rgba(54, 162, 235, 0.2)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 2,
        pointBackgroundColor: 'rgba(54, 162, 235, 1)',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: 'rgba(54, 162, 235, 1)'
      },
      {
        label: getTranslation(['comparison', 'finnishAverage'], language),
        data: [
          benchmark.material.avg,
          benchmark.labor.avg,
          benchmark.subcontract.avg,
        ],
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        borderColor: 'rgba(75, 192, 192, 1)',
        borderWidth: 2,
        pointBackgroundColor: 'rgba(75, 192, 192, 1)',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: 'rgba(75, 192, 192, 1)'
      },
      {
        label: language === 'fi' ? 'Pääkaupunkiseutu' : 'Capital Region',
        data: [
          capitalAdjusted.material,
          capitalAdjusted.labor,
          capitalAdjusted.subcontract,
        ],
        backgroundColor: 'rgba(255, 206, 86, 0.2)',
        borderColor: 'rgba(255, 206, 86, 1)',
        borderWidth: 2,
        pointBackgroundColor: 'rgba(255, 206, 86, 1)',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: 'rgba(255, 206, 86, 1)'
      }
    ]
  };

  const options: ChartOptions<'radar'> = {
    plugins: {
      tooltip: {
        backgroundColor: 'rgba(33, 33, 33, 0.95)',
        padding: 12,
        titleFont: {
          size: 14,
          weight: 'bold'
        },
        bodyFont: {
          size: 13
        },
        callbacks: {
          label: function(context) {
            const value = context.raw as number;
            return `${context.dataset.label}: ${value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} €/m²`;
          }
        }
      },
      legend: {
        position: 'top',
        align: 'start',
        labels: {
          boxWidth: 12,
          padding: 15,
          font: {
            size: 12
          }
        }
      },
      datalabels: {
        display: false // Asegura que no se muestren los valores en los nodos
      }
    },
    scales: {
      r: {
        angleLines: {
          color: 'rgba(200, 200, 200, 0.2)'
        },
        grid: {
          color: 'rgba(200, 200, 200, 0.2)'
        },
        pointLabels: {
          font: {
            size: 12
        }
        },
        ticks: {
          backdropColor: 'transparent',
          color: 'rgba(200, 200, 200, 0.8)',
          font: {
            size: 11
          },
          callback: function(value) {
            return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + ' €/m²';
          }
        }
      }
    },
    responsive: true,
    maintainAspectRatio: false
  };

  // Notas mejoradas
  const notes = [
    language === 'fi'
      ? 'Arvot perustuvat Suomen rakennuskustannusindeksiin (2024).' 
      : 'Values based on the Finnish Construction Cost Index (2024).',
    language === 'fi'
      ? `Tyypillinen kokonaiskustannusalue: ${benchmark.total.min} - ${benchmark.total.max} €/m².`
      : `Typical total cost range: ${benchmark.total.min} - ${benchmark.total.max} €/m².`,
    language === 'fi'
      ? 'Kustannukset voivat vaihdella sijainnin, rakentamistavan ja projektin koon mukaan.'
      : 'Costs may vary depending on location, construction method, and project size.',
    language === 'fi'
      ? 'Palvelu- ja aliurakkatöihin liittyvät kustannukset sisältävät ulkopuoliset urakat ja palvelut.'
      : 'Subcontract and services costs include external contracts and specialist services.',
    language === 'fi'
      ? 'Pääkaupunkiseudun arvot ovat esimerkinomaisia ja voivat muuttua.'
      : 'Capital Region values are for reference only and may change.'
  ];

  // Obtener el título correcto según idioma
  const chartTitle = language === 'fi' 
    ? 'Kustannusvertailu suomalaisten rakennusstandardien kanssa'
    : 'Cost comparison with Finnish building standards';

  return (
    <div className="dashboard-card">
      <div className="card-header">
        <h3>{headerCase(chartTitle)}</h3>
      </div>
      <div style={{ padding: '1rem' }}>
        {divisorHm2 && (
          <div style={{
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
            backgroundColor: 'var(--surface-2)',
            borderRadius: '6px',
            fontSize: '0.9em',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1rem',
            alignItems: 'center'
          }}>
            <span style={{ fontWeight: 600 }}>
              {language === 'fi' ? 'Projektisi:' : 'Your project:'}
            </span>
            <span>
              {getTranslation(['comparison', 'perBrm2'], language)}: {(costSummary.grandTotal / projectArea).toFixed(0)} €
            </span>
            <span style={{ color: 'var(--primary)' }}>
              {getTranslation(['comparison', 'perHm2'], language)}: {(costSummary.grandTotal / divisorHm2).toFixed(0)} €
            </span>
          </div>
        )}
        <div style={{ height: '500px' }}>
          <Radar data={data} options={options} />
        </div>
        <div style={{ 
          marginTop: '1rem',
          padding: '1rem',
          backgroundColor: 'var(--surface-2)',
          borderRadius: '8px',
          fontSize: '0.95em',
          color: 'var(--text-2)'
        }}>
          <p style={{ margin: '0 0 0.5rem 0', fontWeight: 600 }}>
            {language === 'fi' ? 'Huom:' : 'Note:'}
          </p>
          <ul style={{ margin: '0', paddingLeft: '1.5rem' }}>
            {notes.map((note, idx) => (
              <li key={idx}>{note}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

const CostAnalysisSection = ({ 
  costSummary,
  analysisResult,
  projectArea,
  language,
  elements
}: { 
  costSummary: {
    totalMaterial: number;
    totalLabor: number;
    totalSubcontract: number;
    grandTotal: number;
  };
  analysisResult: CostAnalysisResult | null;
  projectArea: number;
  language: Language;
  elements: BaseCostElement[];
}) => {
  const costPerM2 = projectArea ? costSummary.grandTotal / projectArea : 0;
  
  // Calcular costos por tipo de elemento IFC
  const ifcTypeCosts = elements.reduce((acc, element) => {
    if (!acc[element.type]) {
      acc[element.type] = {
        count: 0,
        material: 0,
        labor: 0,
        subcontract: 0,
        total: 0
      };
    }
    acc[element.type].count++;
    acc[element.type].material += element.costs.material;
    acc[element.type].labor += element.costs.labor;
    acc[element.type].subcontract += element.costs.subcontract;
    acc[element.type].total += element.costs.total;
    return acc;
  }, {} as { [key: string]: { 
    count: number;
    material: number;
    labor: number;
    subcontract: number;
    total: number;
  }});

  // Datos para el gráfico de barras apiladas
  const stackedBarOptions: ChartOptions<'bar'> = {
    plugins: {
      title: {
        display: false
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(33, 33, 33, 0.95)',
        padding: 12,
        titleFont: {
          size: 14,
          weight: 'bold'
        },
        bodyFont: {
          size: 13
        },
        callbacks: {
          title: function(context) {
            return context[0].label;
          },
          label: function(context) {
            const value = context.raw as number;
            return `${context.dataset.label}: ${value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} €/m²`;
          }
        }
      },
      legend: {
        position: 'top',
        align: 'start',
        labels: {
          boxWidth: 12,
          padding: 15,
          font: {
            size: 12
          }
        }
      },
      datalabels: {
        display: false
      }
    },
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        grid: {
          display: false
        },
        ticks: {
          maxRotation: 45,
          minRotation: 45,
          font: {
            size: 11
          }
        }
      },
      y: {
        grid: {
          color: 'rgba(200, 200, 200, 0.1)'
        },
        ticks: {
          font: {
            size: 11
          },
          callback: function(value) {
            return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + ' €/m²';
          }
        }
      }
    }
  };

  const stackedBarData = {
    labels: Object.keys(ifcTypeCosts).map(type => type.replace('Ifc', '')),
    datasets: [
      {
        label: 'Material',
        data: Object.values(ifcTypeCosts).map(cost => cost.material),
        backgroundColor: 'rgba(54, 162, 235, 0.85)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 1
      },
      {
        label: 'Labor',
        data: Object.values(ifcTypeCosts).map(cost => cost.labor),
        backgroundColor: 'rgba(75, 192, 192, 0.85)',
        borderColor: 'rgba(75, 192, 192, 1)',
        borderWidth: 1
      },
      {
        label: getTranslation(['costTypes', 'subcontract'], language),
        data: Object.values(ifcTypeCosts).map(cost => cost.subcontract),
        backgroundColor: 'rgba(255, 206, 86, 0.85)',
        borderColor: 'rgba(255, 206, 86, 1)',
        borderWidth: 1
      }
    ]
  };

  return (
    <div className="dashboard-card">
      <div className="card-header">
        <h3>{headerCase(getTranslation(['analysisSections', 'analysis'], language) ?? '')}</h3>
      </div>
      <div style={{ padding: '1rem' }}>
        <h4 className="cost-page-section-subtitle">{headerCase(getTranslation(['comparison', 'title', language], language) ?? '')}</h4>
        <div style={{ height: '400px' }}>
          <Bar data={stackedBarData} options={stackedBarOptions} />
        </div>
        <div className="data-cards-grid">
          <div className="data-card cost-metrics-card">
            <div className="data-card-header">
              <h4 className="data-card-title">{headerCase(getTranslation(['metrics', 'costPerArea'], language) ?? '')}</h4>
            </div>
            <div className="data-card-content">
              <div className="metrics-container">
                <div className="metric-item">
                  <div className="metric-label">Cost per m²</div>
                  <div className="metric-value">
                    {costPerM2.toFixed(2)}
                    <span className="metric-unit">€/m²</span>
                  </div>
                </div>
                <div className="metric-item">
                  <div className="metric-label">Benchmark</div>
                  <div className="metric-value">
                    {costPerM2 < 2000 ? 'Below' : costPerM2 > 3000 ? 'Above' : 'Average'}
                    <span className="metric-unit">Finnish standard</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="data-card cost-metrics-card">
            <div className="data-card-header">
              <h4 className="data-card-title">{headerCase(getTranslation(['metrics', 'laborCostRatio'], language) ?? '')}</h4>
            </div>
            <div className="data-card-content">
              <div className="metrics-container">
                <div className="metric-item">
                  <div className="metric-label">Percentage</div>
                  <div className="metric-value">
                    {((costSummary.totalLabor / costSummary.grandTotal) * 100).toFixed(1)}
                    <span className="metric-unit">%</span>
                  </div>
                </div>
                <div className="metric-item">
                  <div className="metric-label">Standard</div>
                  <div className="metric-value">
                    35-45%
                    <span className="metric-unit">Finnish range</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="data-card cost-metrics-card">
            <div className="data-card-header">
              <h4 className="data-card-title">{headerCase(getTranslation(['metrics', 'materialCostRatio'], language) ?? '')}</h4>
            </div>
            <div className="data-card-content">
              <div className="metrics-container">
                <div className="metric-item">
                  <div className="metric-label">Percentage</div>
                  <div className="metric-value">
                    {((costSummary.totalMaterial / costSummary.grandTotal) * 100).toFixed(1)}
                    <span className="metric-unit">%</span>
                  </div>
                </div>
                <div className="metric-item">
                  <div className="metric-label">Standard</div>
                  <div className="metric-value">
                    40-50%
                    <span className="metric-unit">Finnish range</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="data-card cost-metrics-card">
            <div className="data-card-header">
              <h4 className="data-card-title">{headerCase(getTranslation(['metrics', 'subcontractCostRatio'], language) ?? '')}</h4>
            </div>
            <div className="data-card-content">
              <div className="metrics-container">
                <div className="metric-item">
                  <div className="metric-label">Percentage</div>
                  <div className="metric-value">
                    {((costSummary.totalSubcontract / costSummary.grandTotal) * 100).toFixed(1)}
                    <span className="metric-unit">%</span>
                  </div>
                </div>
                <div className="metric-item">
                  <div className="metric-label">Standard</div>
                  <div className="metric-value">
                    10-15%
                    <span className="metric-unit">Finnish range</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* IFC Element Type Analysis con el mismo estilo que los otros cuadros */}
        <div className="data-cards-grid" style={{ marginTop: '2rem' }}>
          {Object.entries(ifcTypeCosts).map(([type, costs]) => (
            <div key={type} className="data-card ifc-cost-card">
              <div className="data-card-header">
                <h4 className="data-card-title">{headerCase(type.replace('Ifc', ''))}</h4>
              </div>
              <div className="data-card-content">
                <div className="metrics-container">
                  <div className="metric-item">
                    <div className="metric-label">Total Cost</div>
                    <div className="metric-value">
                      {costs.total.toFixed(2)}
                      <span className="metric-unit">€</span>
                    </div>
                  </div>
                  <div className="metric-item">
                    <div className="metric-label">Elements</div>
                    <div className="metric-value">
                      {costs.count}
                      <span className="metric-unit">count</span>
                    </div>
                  </div>
                  <div className="metric-item">
                    <div className="metric-label">Percentage</div>
                    <div className="metric-value">
                      {((costs.total / costSummary.grandTotal) * 100).toFixed(1)}
                      <span className="metric-unit">% of total</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="charts-grid" style={{ marginTop: '2rem' }}>
          <div className="chart-wrapper">
            <h4 className="cost-page-section-subtitle">{headerCase('Cost distribution overview')}</h4>
            <CostBreakdownChart elements={elements} language={language} />
          </div>
          <div className="chart-wrapper">
            <h4 className="cost-page-section-subtitle">{headerCase('Element type cost distribution')}</h4>
            <div style={{ height: '400px' }}>
              <Bar data={stackedBarData} options={stackedBarOptions} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const formatDate = (date: Date): string => {
  return date.toLocaleDateString(undefined, { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
};

const getPhaseColor = (phase: string): string => {
  const colors: { [key: string]: string } = {
    preparation: '#4A90E2',
    foundation: '#F5A623',
    structure: '#7ED321',
    envelope: '#50E3C2',
    interior: '#B8E986',
    mep: '#9013FE',
    finishes: '#BD10E0'
  };
  return colors[phase] || '#D8D8D8';
};

const ConstructionSchedule = ({ schedule, language }: { schedule: ConstructionSchedule; language: Language }) => {
  const timelineWidth = 100; // percentage
  const startTimestamp = schedule.startDate.getTime();
  const totalDuration = schedule.totalDuration;

  const getPhasePosition = (phase: ConstructionPhase): { left: string; width: string } => {
    const phaseStart = phase.startDate.getTime();
    const phaseEnd = phase.endDate.getTime();
    
    const left = ((phaseStart - startTimestamp) / (totalDuration * 24 * 60 * 60 * 1000)) * timelineWidth;
    const width = ((phaseEnd - phaseStart) / (totalDuration * 24 * 60 * 60 * 1000)) * timelineWidth;
    
    return {
      left: `${left}%`,
      width: `${width}%`
    };
  };

  return (
    <div className="dashboard-card">
      <div className="card-header">
        <h3>{headerCase(getTranslation(['schedule', 'title'], language) ?? '')}</h3>
      </div>
      <div style={{ padding: '1.5rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <div>
              <strong>{getTranslation(['schedule', 'startDate'], language)}:</strong> {formatDate(schedule.startDate)}
            </div>
            <div>
              <strong>{getTranslation(['schedule', 'endDate'], language)}:</strong> {formatDate(schedule.endDate)}
            </div>
            <div>
              <strong>{getTranslation(['schedule', 'duration'], language)}:</strong> {schedule.totalDuration} days
            </div>
          </div>
        </div>

        <div className="timeline-container" style={{ 
          position: 'relative',
          marginTop: '2rem',
          marginBottom: '2rem'
        }}>
          {schedule.phases.map((phase: ConstructionPhase, index: number) => (
            <div key={phase.name} style={{ 
              marginBottom: '1rem',
              position: 'relative',
              height: '60px',
              display: 'flex',
              alignItems: 'center'
            }}>
              <div style={{ 
                width: '150px',
                paddingRight: '1rem',
                textAlign: 'right',
                fontWeight: 500
              }}>
                {getTranslation(['phases', phase.name], language)}
              </div>
              
              <div style={{ 
                flex: 1,
                position: 'relative',
                height: '40px',
                backgroundColor: 'var(--surface-2)',
                borderRadius: '4px'
              }}>
                <div style={{
                  position: 'absolute',
                  height: '100%',
                  backgroundColor: getPhaseColor(phase.name),
                  borderRadius: '4px',
                  ...getPhasePosition(phase),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontSize: '0.85em',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  padding: '0 8px'
                }}>
                  {phase.duration} days
                </div>
              </div>

              <div style={{ 
                width: '200px',
                paddingLeft: '1rem',
                fontSize: '0.9em',
                color: 'var(--text-2)'
              }}>
                <div>
                  {getTranslation(['schedule', 'workers'], language)}: {phase.resources.labor}
                </div>
                <div>
                  {getTranslation(['schedule', 'equipment'], language)}: {phase.resources.equipment}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ 
          marginTop: '2rem',
          padding: '1rem',
          backgroundColor: 'var(--surface-2)',
          borderRadius: '8px'
        }}>
          <h4 className="cost-page-section-subtitle" style={{ margin: '0 0 0.5rem 0' }}>
            {headerCase(getTranslation(['schedule', 'criticalPath'], language) ?? '')}
          </h4>
          <div style={{ 
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px'
          }}>
            {schedule.criticalPath.map((phase: string, index: number) => (
              <React.Fragment key={phase}>
                <span style={{
                  padding: '4px 12px',
                  backgroundColor: getPhaseColor(phase),
                  color: 'white',
                  borderRadius: '4px',
                  fontSize: '0.9em'
                }}>
                  {getTranslation(['phases', phase], language)}
                </span>
                {index < schedule.criticalPath.length - 1 && (
                  <span className="material-icons-round" style={{ color: 'var(--text-2)' }}>
                    arrow_forward
                  </span>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div style={{ 
          marginTop: '1rem',
          fontSize: '0.9em',
          color: 'var(--text-2)'
        }}>
          <p>
            {getTranslation(['schedule', 'note'], language)}
          </p>
          <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
            <li>{getTranslation(['schedule', 'noteWeather'], language)}</li>
            <li>{getTranslation(['schedule', 'noteResources'], language)}</li>
            <li>{getTranslation(['schedule', 'notePermits'], language)}</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

interface ScheduleExportData {
  ID: string;
  Name: string;
  Description: string;
  Start: string;
  Finish: string;
}

interface ConsolidatedExportData {
  projectId: number;
  projectName: string;
  projectDate: string;
  projectLocation: string;
  buildingType: string;
  constructionMethod: string;
  totalArea: number;
  projectStartDate: string;
  projectEndDate: string;
  projectDuration: number;
  elementId: number;
  taloCode: string;
  taloCategory: string;
  taloSubcategory: string;
  litteraCode: string;
  litteraName: string;
  litteraCategory: string;
  elementName: string;
  quantity: number;
  materialCost: number;
  laborCost: number;
  subcontractCost: number;
  totalCost: number;
  costPerUnit: number;
  laborHours: number;
  costPerArea: number;
  materialCostPercent: string;
  laborCostPercent: string;
  subcontractCostPercent: string;
  projectTotalCost: number;
  projectCostPerSquareMeter: string | number;
  projectLaborCostRatio: string;
  projectMaterialCostRatio: string;
  projectSubcontractCostRatio: string;
}

interface IfcTaskResources {
    labor: {
        count: number;
        cost: number;
        hours: number;
        type: string;
    };
    equipment: {
        count: number;
        cost: number;
        type: string;
    };
    materials: {
        cost: number;
        type: string;
    };
}

interface IfcTaskRelations {
    relatedElements: {
        elementId: string;
        ifcType: string;
        taloCode: string;
    }[];
    predecessors: string[];
    successors: string[];
}

interface IfcTaskCosts {
    materialCost: number;
    laborCost: number;
    equipmentCost: number;
    overheadCost: number;
    totalCost: number;
    costPerDay: number;
}

interface IfcTaskMetrics {
    progress: number;
    duration: number;
    criticalPath: boolean;
    riskLevel: string;
    productivity: number;
    efficiency: number;
}

interface EnhancedScheduleExportData {
    // Datos básicos
    ID: string;
    Name: string;
    Description: string;
    Start: string;
    Finish: string;
    
    // Recursos
    LaborCount: number;
    LaborCost: number;
    LaborHours: number;
    EquipmentCount: number;
    EquipmentCost: number;
    MaterialCost: number;
    
    // Relaciones
    RelatedElements: string;
    Predecessors: string;
    Successors: string;
    
    // Costos
    TotalCost: number;
    CostPerDay: number;
    OverheadCost: number;
    
    // Métricas
    Duration: number;
    IsCriticalPath: boolean;
    RiskLevel: string;
    Productivity: number;
    
    // Metadata del proyecto
    ProjectArea: number;
    BuildingType: string;
    Location: string;
    ConstructionMethod: string;
    
    // Información Talo
    TaloCodes: string;
    ElementTypes: string;
    
    // Notas y documentación
    Notes: string;
    References: string;
}

interface IfcScheduleData {
    // Datos IFC básicos
    GlobalId: string;
    Name: string;
    Description: string;
    ObjectType: string;
    Identification: string;
    
    // Jerarquía y relaciones
    children?: IfcScheduleData[];
    parentId?: string;
    relatedElements: {
        GlobalId: string;
        Name: string;
        ObjectType: string;
        TaloCode: string;
        PropertySets: {
            name: string;
            properties: {
                name: string;
                value: string | number;
                unit?: string;
            }[];
        }[];
    }[];
    
    // Tiempos
    CreationDate: string;
    StartTime: string;
    FinishTime: string;
    Duration: number;
    WorkingTime: number;
    
    // Recursos y costos
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
        Subcontract: {
            Count: number;
            Cost: number;
            Type: string;
            UnitCost: number;
        };
    };
    
    // Control y estado
    Status: string;
    Priority: number;
    Completion: number;
    IsMilestone: boolean;
    IsCritical: boolean;
    
    // Metadatos del proyecto
    ProjectProperties: {
        BuildingType: string;
        Location: string;
        ConstructionMethod: string;
        TotalArea: number;
        ExpectedDuration: number;
    };
}

const createHierarchicalSchedule = (
    phases: ConstructionPhase[], 
    costData: BaseCostElement[],
    projectInfo: BaseProjectInfo | null
): IfcScheduleData[] => {
    return phases.map((phase, index) => {
        // Calcular duración y costos
        const duration = Math.ceil((phase.endDate.getTime() - phase.startDate.getTime()) / (1000 * 60 * 60 * 24));
        const laborCost = phase.resources.labor * 45 * duration * 8; // 45€/hora, 8 horas/día
        const equipmentCost = phase.resources.equipment * 100 * duration; // 100€/día
        
        // Encontrar elementos relacionados
        const filteredElements = costData.filter(element => {
            const elementType = element.type.toLowerCase();
            const phaseMatch = phase.name.toLowerCase();
            return elementType.includes(phaseMatch) || phaseMatch.includes(elementType);
        });
        const taskSubcontractCost = filteredElements.reduce((sum, el) => sum + (el.costs?.subcontract ?? 0), 0);
        const relatedElements = filteredElements.map(element => ({
                GlobalId: crypto.randomUUID(),
                Name: element.name,
                ObjectType: element.type,
                TaloCode: element.taloCode,
                PropertySets: [
                    {
                        name: "CostProperties",
                        properties: [
                            { name: "MaterialCost", value: element.costs.material, unit: "EUR" },
                            { name: "LaborCost", value: element.costs.labor, unit: "EUR" },
                            { name: "SubcontractCost", value: element.costs.subcontract, unit: "EUR" }
                        ]
                    },
                    {
                        name: "Quantities",
                        properties: [
                            { name: "Quantity", value: element.quantity, unit: "m2" }
                        ]
                    }
                ]
            }));

        // Crear la estructura de datos IFC
        const ifcScheduleData: IfcScheduleData = {
            GlobalId: crypto.randomUUID(),
            Name: phase.name,
            Description: `Construction phase: ${phase.name}`,
            ObjectType: "TASK",
            Identification: `PHASE_${index + 1}`,
            
            relatedElements,
            
            CreationDate: new Date().toISOString(),
            StartTime: phase.startDate.toISOString(),
            FinishTime: phase.endDate.toISOString(),
            Duration: duration,
            WorkingTime: duration * 8, // 8 horas por día
            
            Resources: {
                Labor: {
                    Count: phase.resources.labor,
                    Cost: laborCost,
                    Hours: phase.resources.labor * duration * 8,
                    Type: "GENERAL_LABOR",
                    UnitCost: 45
                },
                Equipment: {
                    Count: phase.resources.equipment,
                    Cost: equipmentCost,
                    Type: "CONSTRUCTION_EQUIPMENT",
                    UnitCost: 100
                },
                Material: {
                    Cost: laborCost * 0.4, // Estimado como 40% del costo laboral
                    Type: "CONSTRUCTION_MATERIAL",
                    Quantity: 1,
                    UnitCost: laborCost * 0.4
                },
                Subcontract: {
                    Count: 0,
                    Cost: taskSubcontractCost,
                    Type: "ALIURAKKA",
                    UnitCost: taskSubcontractCost
                }
            },
            
            Status: "SCHEDULED",
            Priority: 1,
            Completion: 0,
            IsMilestone: false,
            IsCritical: Boolean(phase.isCritical),
            
            ProjectProperties: {
                BuildingType: (projectInfo?.type || "residential").toLowerCase(),
                Location: projectInfo?.location || "Helsinki",
                ConstructionMethod: projectInfo?.constructionMethod || "traditional",
                TotalArea: projectInfo?.area || 0,
                ExpectedDuration: duration
            }
        };

        return ifcScheduleData;
    });
};

// Función para descargar archivo
const downloadFile = (content: string, fileName: string, contentType: string): void => {
    const blob = new Blob([content], { type: contentType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
};

const IFCTaskExportComponent = ({ 
  costData, 
  projectInfo, 
  constructionSchedule, 
  language 
}: { 
  costData: BaseCostElement[];
  projectInfo: BaseProjectInfo | null;
  constructionSchedule: ConstructionSchedule | null;
  language: Language;
}) => {
  const [isExporting, setIsExporting] = React.useState(false);

  const handleExport = () => {
    if (!costData || costData.length === 0) {
      alert('No cost data available for IFC task export');
      return;
    }

    setIsExporting(true);
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Preparar datos consolidados para Power BI (incluyendo Littera)
    const consolidatedData: ConsolidatedExportData[] = costData.map(element => ({
      projectId: 1,
      projectName: projectInfo?.name || "Unnamed Project",
      projectDate: currentDate,
      projectLocation: projectInfo?.location || "Helsinki",
      buildingType: projectInfo?.buildingType || "residential",
      constructionMethod: projectInfo?.constructionMethod || "traditional",
      totalArea: projectInfo?.area || 0,
      projectStartDate: constructionSchedule?.startDate.toISOString() || "",
      projectEndDate: constructionSchedule?.endDate.toISOString() || "",
      projectDuration: constructionSchedule?.totalDuration || 0,
      elementId: element.id,
      taloCode: element.taloCode,
      taloCategory: element.taloCode.split('.')[0],
      taloSubcategory: element.taloCode.split('.').slice(0, 2).join('.'),
      litteraCode: element.litteraCode || '',
      litteraName: element.litteraName || '',
      litteraCategory: element.litteraCategory || '',
      elementName: element.name,
      quantity: element.quantity,
      materialCost: element.costs.material,
      laborCost: element.costs.labor,
      subcontractCost: element.costs.subcontract,
      totalCost: element.costs.total,
      costPerUnit: element.costs.total / element.quantity,
      laborHours: element.costs.labor / 45,
      costPerArea: element.costs.total / (projectInfo?.area || 1),
      materialCostPercent: (element.costs.material / element.costs.total * 100).toFixed(2),
      laborCostPercent: (element.costs.labor / element.costs.total * 100).toFixed(2),
      subcontractCostPercent: (element.costs.subcontract / element.costs.total * 100).toFixed(2),
      projectTotalCost: costData.reduce((sum, el) => sum + el.costs.total, 0),
      projectCostPerSquareMeter: projectInfo?.area ? (costData.reduce((sum, el) => sum + el.costs.total, 0) / projectInfo.area).toFixed(2) : 0,
      projectLaborCostRatio: (costData.reduce((sum, el) => sum + el.costs.labor, 0) / costData.reduce((sum, el) => sum + el.costs.total, 0) * 100).toFixed(2),
      projectMaterialCostRatio: (costData.reduce((sum, el) => sum + el.costs.material, 0) / costData.reduce((sum, el) => sum + el.costs.total, 0) * 100).toFixed(2),
      projectSubcontractCostRatio: (costData.reduce((sum, el) => sum + el.costs.subcontract, 0) / costData.reduce((sum, el) => sum + el.costs.total, 0) * 100).toFixed(2)
    }));

    // Crear estructura jerárquica para IFC
    const ifcScheduleData = createHierarchicalSchedule(
        constructionSchedule?.phases || [],
        costData,
        projectInfo
    );

    // Función para convertir a CSV
    const convertToCSV = (data: any[]): string => {
        if (data.length === 0) return '';
        const headers = Object.keys(data[0]);
        const csvRows = [
            headers.join(','),
            ...data.map(row => 
                headers.map(header => {
                    const value = row[header];
                    return typeof value === 'string' && value.includes(',') 
                        ? `"${value}"` 
                        : value;
                }).join(',')
            )
        ];
        return csvRows.join('\n');
    };

    try {
        // Exportar JSON para IFC
        downloadFile(
            JSON.stringify(ifcScheduleData, null, 2),
            `schedule-ifc-${currentDate}.json`,
            'application/json'
        );

        // Exportar CSV para Power BI
        downloadFile(
            convertToCSV(consolidatedData),
            `cost-analysis-powerbi-${currentDate}.csv`,
            'text/csv'
        );

        // Exportar CSV para IFC Task
        const ifcTaskData = ifcScheduleData.map(task => ({
            TaskID: task.GlobalId,
            TaskName: task.Name,
            TaskType: task.ObjectType,
            StartDate: task.StartTime,
            EndDate: task.FinishTime,
            Duration: task.Duration,
            WorkingHours: task.WorkingTime,
            Status: task.Status,
            Priority: task.Priority,
            IsCritical: task.IsCritical ? "Yes" : "No",
            LaborCount: task.Resources.Labor.Count,
            LaborCost: task.Resources.Labor.Cost,
            MaterialCost: task.Resources.Material.Cost,
            SubcontractCost: task.Resources.Subcontract?.Cost ?? 0,
            TotalCost: task.Resources.Labor.Cost + task.Resources.Material.Cost + (task.Resources.Subcontract?.Cost ?? 0),
            RelatedElements: task.relatedElements.map(el => el.GlobalId).join(';'),
            TaloCodes: task.relatedElements.map(el => el.TaloCode).join(';')
        }));

        downloadFile(
            convertToCSV(ifcTaskData),
            `ifc-task-schedule-${currentDate}.csv`,
            'text/csv'
        );

        alert('Files exported successfully:\n- JSON format (for IFC conversion)\n- CSV format (for Power BI)\n- CSV format (for IFC Task)');
    } catch (error) {
        console.error('Error exporting files:', error);
        alert('Error exporting files. Please try again.');
    } finally {
        setIsExporting(false);
    }
  };

  return (
    <div className="dashboard-card">
      <div className="card-header">
        <h3>
          <span className="material-icons-round" style={{ marginRight: '8px' }}>schedule</span>
          {headerCase(getTranslation(['export', 'ifcTaskTitle'], language) ?? '')}
        </h3>
      </div>
      <div style={{ padding: '1.5rem' }}>
        <div style={{ 
          marginBottom: '1.5rem',
          padding: '1rem',
          backgroundColor: 'var(--surface-2)',
          borderRadius: '8px',
          border: '1px solid var(--border)'
        }}>
          <h4 style={{ 
            margin: '0 0 0.75rem 0', 
            color: 'var(--text-1)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span className="material-icons-round" style={{ fontSize: '20px', color: 'var(--primary)' }}>
              info
            </span>
            {getTranslation(['export', 'ifcTaskDescription'], language)}
          </h4>
          <p style={{ 
            margin: '0 0 1rem 0', 
            color: 'var(--text-2)',
            lineHeight: '1.5',
            fontSize: '0.95em'
          }}>
            {getTranslation(['export', 'ifcTaskDetails'], language)}
          </p>
          
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', 
            gap: '1rem',
            marginBottom: '1rem'
          }}>
            <div style={{
              padding: '0.75rem',
              backgroundColor: 'var(--surface-1)',
              borderRadius: '6px',
              border: '1px solid var(--border)'
            }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '6px', 
                marginBottom: '4px',
                color: 'var(--primary)',
                fontSize: '0.9em',
                fontWeight: '500'
              }}>
                <span className="material-icons-round" style={{ fontSize: '16px' }}>code</span>
                JSON Format
              </div>
              <div style={{ fontSize: '0.85em', color: 'var(--text-2)' }}>
                IFC-compatible schedule data for BIM integration
              </div>
            </div>
            
            <div style={{
              padding: '0.75rem',
              backgroundColor: 'var(--surface-1)',
              borderRadius: '6px',
              border: '1px solid var(--border)'
            }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '6px', 
                marginBottom: '4px',
                color: 'var(--primary)',
                fontSize: '0.9em',
                fontWeight: '500'
              }}>
                <span className="material-icons-round" style={{ fontSize: '16px' }}>analytics</span>
                Power BI CSV
              </div>
              <div style={{ fontSize: '0.85em', color: 'var(--text-2)' }}>
                Consolidated data for business intelligence analysis
              </div>
            </div>
            
            <div style={{
              padding: '0.75rem',
              backgroundColor: 'var(--surface-1)',
              borderRadius: '6px',
              border: '1px solid var(--border)'
            }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '6px', 
                marginBottom: '4px',
                color: 'var(--primary)',
                fontSize: '0.9em',
                fontWeight: '500'
              }}>
                <span className="material-icons-round" style={{ fontSize: '16px' }}>assignment</span>
                IFC Task CSV
              </div>
              <div style={{ fontSize: '0.85em', color: 'var(--text-2)' }}>
                Detailed task schedule with resource allocation
              </div>
            </div>
          </div>

          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
            gap: '0.75rem',
            fontSize: '0.85em'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="material-icons-round" style={{ fontSize: '16px', color: 'var(--success)' }}>check_circle</span>
              <span>{costData.length} cost elements</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="material-icons-round" style={{ fontSize: '16px', color: 'var(--success)' }}>check_circle</span>
              <span>{constructionSchedule?.phases.length || 0} construction phases</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="material-icons-round" style={{ fontSize: '16px', color: 'var(--success)' }}>check_circle</span>
              <span>Finnish TALO 2000 codes</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="material-icons-round" style={{ fontSize: '16px', color: 'var(--success)' }}>check_circle</span>
              <span>Resource allocation data</span>
            </div>
          </div>
        </div>

        <div style={{ 
          display: 'flex', 
          flexDirection: 'column',
          gap: '1rem',
          padding: '1rem',
          backgroundColor: 'var(--surface-1)',
          borderRadius: '8px',
          border: '1px solid var(--border)'
        }}>
          <div>
            <div style={{ 
              fontSize: '0.9em', 
              color: 'var(--text-1)', 
              marginBottom: '4px',
              fontWeight: '500'
            }}>
              {getTranslation(['export', 'readyToExport'], language)}
            </div>
            <div style={{ fontSize: '0.85em', color: 'var(--text-2)' }}>
              {getTranslation(['export', 'exportDescription'], language)}
            </div>
          </div>
          
          <button 
            className="button-primary tooltip-enhanced"
            onClick={handleExport}
            disabled={isExporting || !costData || costData.length === 0}
            data-tooltip="Export IFC task schedule data in multiple formats for BIM integration and project management"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 20px',
              fontSize: '0.95em',
              minWidth: '180px',
              justifyContent: 'center',
              alignSelf: 'flex-start'
            }}
          >
            <span className="material-icons-round">
              {isExporting ? 'hourglass_empty' : 'download'}
            </span>
            {isExporting ? 'Exporting...' : getTranslation(['export', 'exportButton'], language)}
          </button>
        </div>
      </div>
    </div>
  );
};

export function CostPage(_props: Props) {
  const CLAUDE_PLACEHOLDER_CODE = '(PLACEHOLDERFORCLAUDE)';
  const isLitteraPlaceholderCode = (code: string): boolean => {
    const normalized = String(code || '').trim().toLowerCase();
    return (
      !normalized ||
      normalized === '(no littera codes)' ||
      normalized === CLAUDE_PLACEHOLDER_CODE.toLowerCase() ||
      normalized.includes('no littera')
    );
  };

  const { 
    language, 
    setLanguage, 
    costData, 
    setCostData, 
    analysisResult, 
    setAnalysisResult,
    projectInfo,
    setProjectInfo,
    applySuggestionGroup,
    addLitteraCode,
    removeLitteraCode,
    updateLitteraCodeQuantity,
    removeElementsByIds,
  } = useCostStore();
  const litteraFilteringSvcRef = React.useRef(new LitteraFilteringService());
  const [isLoading, setIsLoading] = React.useState(true);
  const [editedElements, setEditedElements] = React.useState<{[key: number]: BaseCostElement}>({});
  const [costSummary, setCostSummary] = React.useState({
    totalMaterial: 0,
    totalLabor: 0,
    totalSubcontract: 0,
    grandTotal: 0
  });
  const [costFactors, setCostFactors] = React.useState<CostFactors>(DEFAULT_COST_FACTORS);
  const [buildingType, setBuildingType] = React.useState('residential');
  const [constructionMethod, setConstructionMethod] = React.useState('traditional');
  const [constructionSchedule, setConstructionSchedule] = React.useState<ConstructionSchedule | null>(null);
  const [startDate, setStartDate] = React.useState<Date>(new Date());
  const [syncImportResult, setSyncImportResult] = React.useState<SyncImportResult | null>(null);
  const importFileInputRef = React.useRef<HTMLInputElement>(null);
  const libraryFileInputRef = React.useRef<HTMLInputElement>(null);
  const { getLibrary, loadLibrary } = useLibraryStore();

  // Permite usar herramientas MCP de Claude desde CostPage sin depender de IFCViewer abierto.
  React.useEffect(() => {
    setupMCPWebSocket();
  }, []);

  // Datos efectivos usados solo por la tabla (costData base + ediciones pendientes).
  // Si el elemento tiene litteraCodes, los costes del objeto se derivan siempre de la suma de lc.costs
  // para que la fila del objeto (IFC Type, Name, TALO Code) muestre el total correcto sin depender de "Calculate Cost".
  const effectiveCostData = React.useMemo(() => {
    return costData.map((el) => {
      const base = editedElements[el.id] ?? el;
      const lcs = base.litteraCodes ?? [];
      if (lcs.length === 0) return base;
      let material = 0;
      let labor = 0;
      let subcontract = 0;
      for (const lc of lcs) {
        const c = lc.costs ?? {};
        material += c.material ?? 0;
        labor += c.labor ?? 0;
        subcontract += c.subcontract ?? 0;
      }
      const total = material + labor + subcontract;
      return { ...base, costs: { ...base.costs, material, labor, subcontract, total } };
    });
  }, [costData, editedElements]);

  // Snapshot para herramientas MCP cuando CostStore no esta sincronizado aun.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as any).__costPageEffectiveData = effectiveCostData;
  }, [effectiveCostData]);

  // Al entrar en CostPage, scroll al inicio para que la tabla quede arriba (como Excel)
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // OPTIMIZACIÓN: Debounce para cálculos pesados de resumen y horarios
  React.useEffect(() => {
    if (!costData || costData.length === 0) {
      setIsLoading(false);
      return;
    }

    // Calcular resumen de forma optimizada
    const summaryTimer = setTimeout(() => {
      const summary = costData.reduce((acc, element) => {
        acc.totalMaterial += element.costs.material;
        acc.totalLabor += element.costs.labor;
        acc.totalSubcontract += element.costs.subcontract;
        acc.grandTotal += element.costs.total;
        return acc;
      }, {
        totalMaterial: 0,
        totalLabor: 0,
        totalSubcontract: 0,
        grandTotal: 0
      });

      setCostSummary(summary);

      // Calculate construction schedule (solo si projectInfo está disponible)
      if (projectInfo) {
        const timeService = TimeAnalysisService.getInstance();
        const schedule = timeService.calculateConstructionSchedule(
          costData,
          normalizeBuildingTypeKey(projectInfo.buildingType || 'residential'),
          projectInfo.area || 0,
          normalizeConstructionMethodKey(projectInfo.constructionMethod || 'traditional'),
          startDate
        );
        setConstructionSchedule(schedule);
      }

      setIsLoading(false);
    }, 100); // Pequeño delay para evitar cálculos repetidos durante actualizaciones rápidas

    return () => clearTimeout(summaryTimer);
  }, [costData, projectInfo, startDate]);

  /** Fase 2B: import sync/measurement file (xlsx/csv).
   * - Lee overrides por elemento (GUID) desde filas tipo Sync (GUID + TALO + costos + LitteraCodes JSON).
   * - Lee LitteraCodes agregados por grupo desde filas de Measurement Data sin GUID.
   * - No escribe directamente en `costData`; solo actualiza `editedElements`.
   *   El usuario debe pulsar "Calculate" para aplicar los cambios y recalcular costes.
   */
  const handleSyncImport = React.useCallback(async (file: File | null) => {
    if (!file || !costData?.length) {
      if (!costData?.length) {
        setSyncImportResult({
          updated: 0,
          ignored: 0,
          errors: [getTranslation(['syncImport', 'noDataError'], language)],
        });
      }
      return;
    }

    const errors: string[] = [];

    try {
      const isCsv = /\.csv$/i.test(file.name);
      const wb = isCsv
        ? XLSX.read(await file.text(), { type: 'string', raw: true })
        : XLSX.read(await file.arrayBuffer(), { type: 'array', raw: true });

      // Buscar hoja con columna GUID: primero Measurement Data, luego Sync, luego primera.
      // Measurement Data tiene un logo en las filas 1-2 y el header real en la fila 3,
      // por lo que escaneamos las primeras 5 filas para encontrar la fila de cabecera.
      let sheetName = '';
      let sheet: XLSX.WorkSheet | null = null;
      let headerRowIdx = 0; // Índice 0-based de la fila de cabecera dentro de la hoja
      const sheetPriority = ['Measurement Data', SYNC_SHEET_NAME, ...wb.SheetNames];
      for (const name of sheetPriority) {
        if (!wb.SheetNames.includes(name)) continue;
        const testSheet = wb.Sheets[name];
        const testAoa = XLSX.utils.sheet_to_json<string[]>(testSheet, {
          header: 1,
          defval: '',
        }) as string[][];
        // Escanear las primeras 5 filas buscando la fila que contenga 'guid'
        for (let ri = 0; ri < Math.min(testAoa.length, 5); ri++) {
          const rowHeaders = (testAoa[ri] || []).map((h) => String(h).trim().toLowerCase());
          if (rowHeaders.includes('guid')) {
            sheetName = name;
            sheet = testSheet;
            headerRowIdx = ri;
            console.log(`[CostPage] Using sheet "${name}" for import (GUID column at row ${ri + 1})`);
            break;
          }
        }
        if (sheet) break;
      }

      if (!sheet) {
        setSyncImportResult({
          updated: 0,
          ignored: 0,
          errors: [getTranslation(['syncImport', 'noSheetError'], language) + ' No sheet with GUID column found.'],
        });
        return;
      }

      // range: headerRowIdx hace que aoa[0] sea la fila de cabecera real (aunque esté en fila 3 del sheet)
      const aoa = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', range: headerRowIdx }) as string[][];
      if (aoa.length < 2) {
        setSyncImportResult({
          updated: 0,
          ignored: 0,
          errors: [getTranslation(['syncImport', 'noDataRowsError'], language)],
        });
        return;
      }

      const headers = (aoa[0] || []).map((h) => String(h).trim());
      const colIndex = (name: string) => {
        const n = name.toLowerCase();
        const i = headers.findIndex((h) => String(h).toLowerCase() === n);
        if (i >= 0) return i;
        if (name === SYNC_COLUMNS.GUID && headers.some((h) => String(h).toLowerCase() === 'guid')) {
          return headers.findIndex((h) => String(h).toLowerCase() === 'guid');
        }
        return -1;
      };

      const guidIdx = colIndex(SYNC_COLUMNS.GUID);
      if (guidIdx < 0) {
        setSyncImportResult({
          updated: 0,
          ignored: 0,
          errors: [getTranslation(['syncImport', 'missingGuidColumnError'], language)],
        });
        return;
      }

      const getStr = (row: string[], key: string) => {
        const i = colIndex(key);
        return i >= 0 ? String(row[i] ?? '').trim() : '';
      };
      const getNum = (row: string[], key: string): number | undefined => {
        const s = getStr(row, key);
        if (s === '') return undefined;
        const n = Number(s);
        return Number.isFinite(n) ? n : undefined;
      };

      console.log('[CostPage] Column headers:', headers);
      console.log('[CostPage] GUID column index:', guidIdx);
      console.log('[CostPage] First 5 data rows:', aoa.slice(1, 6));

      // Overrides por GUID (Sync)
      const byGuid = new Map<
        string,
        {
          taloCode?: string;
          taloName?: string;
          material?: number;
          labor?: number;
          subcontract?: number;
          total?: number;
          litteraCodes?: string;
        }
      >();

      // Filas de Littera por grupo (Measurement Data): sin GUID pero con Littera Code
      type GroupLitteraRow = {
        ifcType: string;
        name: string;
        taloCode: string;
        litteraCode: string;
        litteraName: string;
        litteraCategory: string | null;
        unit: string;
        quantity: number;
        material: number;
        labor: number;
        subcontract: number;
        total: number;
        relevanceScore?: number;
        rowIndex: number;
      };
      const groupLitteraRows: GroupLitteraRow[] = [];
      
      // Grupos detectados en el Excel (para detectar borrados): sin GUID, con IFC Type + Name + TALO
      // Esto incluye tanto filas con Littera Code como filas de grupo sin Littera (que indican borrado)
      type GroupMarker = {
        ifcType: string;
        name: string;
        taloCode: string;
        hasLittera: boolean; // true si tiene al menos una fila con Littera Code
        rowIndex: number;
      };
      const groupMarkers = new Map<string, GroupMarker>();

      let rowsWithGuid = 0;
      let rowsWithData = 0;

      for (let r = 1; r < aoa.length; r++) {
        const row = aoa[r] || [];
        const guid = String(row[guidIdx] ?? '').trim();
        const litteraCodeCell = getStr(row, 'Littera Code');
        const hasRealLitteraCode = litteraCodeCell && !isLitteraPlaceholderCode(litteraCodeCell);
        const ifcType = getStr(row, 'IFC Type');
        const name = getStr(row, 'Name');
        const taloCodeCell = getStr(row, SYNC_COLUMNS.TALO_CODE) || getStr(row, 'TALO Code');

        // Fila de grupo (Measurement Data): sin GUID, con IFC Type + Name (puede tener o no Littera Code)
        if (!guid && ifcType && name) {
          const nameNorm = stripExcelGroupNameSuffix(name);
          const taloCodeNorm = (taloCodeCell || '').trim();
          const groupKey = `${taloCodeNorm}-${nameNorm}`;
          
          // Marcar que este grupo aparece en el Excel
          if (!groupMarkers.has(groupKey)) {
            groupMarkers.set(groupKey, {
              ifcType,
              name: nameNorm,
              taloCode: taloCodeNorm,
              hasLittera: false,
              rowIndex: r + 1,
            });
          }
          
          // Si tiene Littera Code, es una fila de Littera válida
          if (hasRealLitteraCode) {
            const marker = groupMarkers.get(groupKey)!;
            marker.hasLittera = true;
            
            groupLitteraRows.push({
              ifcType,
              name,
              taloCode: taloCodeNorm,
              litteraCode: litteraCodeCell,
              litteraName: getStr(row, 'Littera Name'),
              litteraCategory: getStr(row, 'Littera Category') || null,
              unit: getStr(row, 'Unit'),
              quantity: getNum(row, 'Quantity') ?? 0,
              material: getNum(row, SYNC_COLUMNS.MATERIAL_COST) ?? getNum(row, 'Material Cost') ?? 0,
              labor: getNum(row, SYNC_COLUMNS.LABOR_COST) ?? getNum(row, 'Labor Cost') ?? 0,
              subcontract: getNum(row, SYNC_COLUMNS.SUBCONTRACT_COST) ?? getNum(row, 'Subcontract Cost') ?? (getNum(row, SYNC_COLUMNS.EQUIPMENT_COST) ?? getNum(row, 'Equipment Cost') ?? 0) + (getNum(row, SYNC_COLUMNS.OVERHEAD_COST) ?? getNum(row, 'Overhead Cost') ?? 0),
              total: getNum(row, SYNC_COLUMNS.TOTAL_COST) ?? getNum(row, 'Total Cost') ?? 0,
              relevanceScore: getNum(row, 'Relevance Score'),
              rowIndex: r + 1,
            });
          }
          // Si no tiene Littera Code pero tiene IFC Type + Name, es una marca de grupo vacío (borrado)
          // No hacemos nada aquí, solo lo marcamos en groupMarkers
          continue;
        }

        if (guid) rowsWithGuid++;
        if (!guid) continue;

        // Solo primera ocurrencia por GUID con datos
        if (byGuid.has(guid)) continue;

        // Get cost values from row
        const taloCode = getStr(row, SYNC_COLUMNS.TALO_CODE) || getStr(row, 'TALO Code');
        const taloName = getStr(row, SYNC_COLUMNS.TALO_NAME) || getStr(row, 'TALO Name');
        const material = getNum(row, SYNC_COLUMNS.MATERIAL_COST) ?? getNum(row, 'Material Cost');
        const labor = getNum(row, SYNC_COLUMNS.LABOR_COST) ?? getNum(row, 'Labor Cost');
        const subcontractRow = getNum(row, SYNC_COLUMNS.SUBCONTRACT_COST) ?? getNum(row, 'Subcontract Cost') ?? (getNum(row, SYNC_COLUMNS.EQUIPMENT_COST) ?? getNum(row, 'Equipment Cost') ?? 0) + (getNum(row, SYNC_COLUMNS.OVERHEAD_COST) ?? getNum(row, 'Overhead Cost') ?? 0);
        const total = getNum(row, SYNC_COLUMNS.TOTAL_COST) ?? getNum(row, 'Total Cost');
        // Leer LitteraCodes JSON si la hoja Sync lo trae (columna 'LitteraCodes').
        // En Measurement Data esta columna no existe → getStr devuelve '' → se ignora correctamente.
        const litteraCodes = getStr(row, SYNC_COLUMNS.LITTERA_CODES);

        if (r <= 5) {
          console.log(
            `[CostPage] Row ${r} - GUID: "${guid}", taloCode: "${taloCode}", material: ${material}, labor: ${labor}, total: ${total}`
          );
        }

        // Solo contar filas con datos actualizables
        if (
          taloCode ||
          taloName ||
          material !== undefined ||
          labor !== undefined ||
          subcontractRow !== 0 ||
          total !== undefined ||
          litteraCodes
        ) {
          rowsWithData++;
          byGuid.set(guid, {
            taloCode: taloCode || undefined,
            taloName: taloName || undefined,
            material,
            labor,
            subcontract: subcontractRow,
            total,
            litteraCodes: litteraCodes || undefined,
          });
        }
      }

      console.log(
        `[CostPage] Import summary: ${aoa.length - 1} total rows, ${rowsWithGuid} with GUID, ${rowsWithData} with updateable data, ${byGuid.size} unique GUIDs, ${groupLitteraRows.length} group-level Littera rows`
      );

      const modelGuids = new Set(costData.map((el) => (el.globalId ?? '').trim()).filter(Boolean));
      let updated = 0;
      let ignored = 0;
      for (const g of byGuid.keys()) {
        if (!modelGuids.has(g)) ignored++;
      }

      // Ediciones importadas que se aplicarán al pulsar "Calculate"
      const importedEdited: { [key: number]: BaseCostElement } = {};

      // 1) Overrides por GUID (Sync)
      costData.forEach((el) => {
        const g = (el.globalId ?? '').trim();
        if (!g) return;
        const row = byGuid.get(g);
        if (!row) return;

        let litteraCodes = importedEdited[el.id]?.litteraCodes ?? el.litteraCodes;
        if (row.litteraCodes) {
          try {
            const parsed = JSON.parse(row.litteraCodes) as Array<{
              litteraCode?: string;
              litteraName?: string;
              litteraCategory?: string | null;
              unit?: string;
              quantity?: number;
              source?: 'ifc' | 'suggestion' | 'library' | 'user';
              costs?: { material?: number; labor?: number; subcontract?: number; equipment?: number; overhead?: number; total?: number };
            }>;
            if (Array.isArray(parsed) && parsed.length >= 0) {
              litteraCodes = parsed.map((item) => {
                const c = item?.costs;
                const subcontract = c ? (Number(c.subcontract) || (Number(c.equipment) || 0) + (Number(c.overhead) || 0)) : 0;
                return {
                  litteraCode: String(item?.litteraCode ?? ''),
                  litteraName: String(item?.litteraName ?? ''),
                  litteraCategory: item?.litteraCategory ?? undefined,
                  unit: String(item?.unit ?? ''),
                  quantity: Number(item?.quantity) || 0,
                  source: item?.source,
                  ...(c && {
                    costs: {
                      material: Number(c.material) || 0,
                      labor: Number(c.labor) || 0,
                      subcontract,
                      total: Number(c.total) || 0,
                    },
                  }),
                };
              });
            }
          } catch {
            errors.push(`${getTranslation(['syncImport', 'invalidLitteraJsonError'], language)} (GUID: ${g})`);
          }
        }

        const base = importedEdited[el.id] ?? el;
        const rowHasCost =
          row.material !== undefined ||
          row.labor !== undefined ||
          row.subcontract !== undefined ||
          row.total !== undefined;
        let material = row.material ?? base.costs.material;
        let labor = row.labor ?? base.costs.labor;
        let subcontractVal = row.subcontract ?? base.costs.subcontract;
        let total = row.total ?? material + labor + subcontractVal;

        // Si el Excel no trae costes pero sí Littera asignados, calcular coste desde littera-prices (igual que cantidades).
        if (!rowHasCost && litteraCodes && litteraCodes.length > 0) {
          let mat = 0,
            lab = 0,
            sub = 0,
            tot = 0;
          for (const lc of litteraCodes) {
            const unit = (lc.unit || '').trim() || '';
            if (!unit || unit === '***') continue;
            const qty =
              (lc.quantity ?? 0) > 0
                ? (lc.quantity ?? 0)
                : getQuantityForLitteraCodeByType(
                    base.type || 'Unknown',
                    unit,
                    base.baseQuantities || {},
                    base.name || '',
                    base.quantity || 0,
                    { description: lc.litteraName },
                    base.extraProperties
                  );
            const price = getPriceForLittera(lc.litteraCode, unit);
            if (price) {
              mat += (price.material ?? 0) * qty;
              lab += (price.labor ?? 0) * qty;
              sub += (price.subcontract ?? 0) * qty;
              tot += (price.total ?? 0) * qty;
            }
          }
          if (tot > 0 || mat > 0 || lab > 0 || sub > 0) {
            material = mat;
            labor = lab;
            subcontractVal = sub;
            total = tot;
          }
        } else if (!rowHasCost) {
          total = material + labor + subcontractVal;
        }

        const updatedEl: BaseCostElement = {
          ...base,
          taloCode: row.taloCode !== undefined && row.taloCode !== '' ? row.taloCode : base.taloCode,
          taloName: row.taloName !== undefined && row.taloName !== '' ? row.taloName : base.taloName,
          costs: { material, labor, subcontract: subcontractVal, total },
          litteraCodes,
          litteraCode: litteraCodes?.[0]?.litteraCode,
          litteraName: litteraCodes?.[0]?.litteraName,
          litteraCategory: litteraCodes?.[0]?.litteraCategory,
        };

        importedEdited[el.id] = updatedEl;
        updated++;
      });

      // 2) Actualizaciones por grupo a partir de filas de Littera (Measurement Data, sin GUID)
      // Measurement Data tiene autoridad completa: 
      // - Si un grupo aparece en el Excel, se actualiza según el Excel
      // - Si un grupo NO aparece en el Excel, se borran todos sus LitteraCodes
      if (groupMarkers.size > 0 || sheetName === 'Measurement Data') {
        const { elementsByType } = buildGroupedData(costData);

        // Agrupar filas de Littera por (TALO Code normalizado + Name normalizado)
        const groupedByKey = new Map<
          string,
          {
            taloCode: string;
            name: string;
            rows: GroupLitteraRow[];
          }
        >();

        for (const row of groupLitteraRows) {
          const taloCodeNorm = (row.taloCode || '').trim();
          const nameNorm = normalizeRevitName(row.name || '');
          const key = `${taloCodeNorm}-${nameNorm}`;
          if (!groupedByKey.has(key)) {
            groupedByKey.set(key, {
              taloCode: taloCodeNorm,
              name: nameNorm,
              rows: [],
            });
          }
          groupedByKey.get(key)!.rows.push(row);
        }

        // AUTORIDAD COMPLETA: Detectar grupos que existían antes pero NO aparecen en el Excel
        // Estos grupos deben tener sus LitteraCodes borrados
        const allExistingGroups = new Set<string>();
        elementsByType.forEach((typeMap) => {
          typeMap.forEach((_, groupKey) => {
            allExistingGroups.add(groupKey);
          });
        });

        const groupsInExcel = new Set(groupMarkers.keys());
        const groupsToDelete = Array.from(allExistingGroups).filter(
          (key) => !groupsInExcel.has(key)
        );

        // Borrar LitteraCodes de grupos que no aparecen en el Excel
        for (const key of groupsToDelete) {
          let groupElements: BaseCostElement[] | null = null;
          for (const [, typeMap] of elementsByType.entries()) {
            const bucket = typeMap.get(key);
            if (bucket && bucket.length) {
              groupElements = bucket;
              break;
            }
          }

          if (groupElements && groupElements.length > 0) {
            const first = groupElements[0];
            const taloCode = first.taloCode || '';
            
            groupElements.forEach((originalEl) => {
              const base = importedEdited[originalEl.id] ?? originalEl;
              
              // Solo borrar si realmente tenía LitteraCodes
              if (base.litteraCodes && base.litteraCodes.length > 0) {
                const updatedEl: BaseCostElement = {
                  ...base,
                  litteraCodes: undefined,
                  litteraCode: undefined,
                  litteraName: undefined,
                  litteraCategory: undefined,
                };

                importedEdited[originalEl.id] = updatedEl;
                updated++;
              }
            });
          }
        }

        // Procesar todos los grupos marcados en el Excel (tanto con Littera como sin Littera)
        for (const [key, marker] of groupMarkers.entries()) {
          const { taloCode, name, hasLittera } = marker;

          // Buscar elementos de este grupo en cualquier tipo IFC
          let groupElements: BaseCostElement[] | null = null;
          for (const [, typeMap] of elementsByType.entries()) {
            const bucket = typeMap.get(key);
            if (bucket && bucket.length) {
              groupElements = bucket;
              break;
            }
          }

          if (!groupElements || !groupElements.length) {
            const rowIdx = marker.rowIndex;
            errors.push(`Row ${rowIdx}: group not found for TALO="${taloCode}", Name="${name}"`);
            continue;
          }

          const nHosts = assemblyHostCount(groupElements);
          const n = nHosts > 0 ? nHosts : groupElements.length;

          // Si el grupo NO tiene Littera en el Excel, borrar todos los LitteraCodes
          if (!hasLittera) {
            groupElements.forEach((originalEl) => {
              const base = importedEdited[originalEl.id] ?? originalEl;
              
              const updatedEl: BaseCostElement = {
                ...base,
                taloCode: taloCode || base.taloCode,
                litteraCodes: undefined, // Borrar todos los LitteraCodes
                litteraCode: undefined,
                litteraName: undefined,
                litteraCategory: undefined,
                // Mantener los costes originales (no se recalculan al borrar Littera)
              };

              importedEdited[originalEl.id] = updatedEl;
              updated++;
            });
            continue;
          }

          // Si el grupo SÍ tiene Littera, procesar las filas de Littera
          const group = groupedByKey.get(key);
          if (!group) continue; // No debería pasar si hasLittera es true, pero por seguridad
          const { rows } = group;

          // Agregar por LitteraCode dentro de este grupo
          const byLittera = new Map<
            string,
            {
              litteraCode: string;
              litteraName: string;
              litteraCategory: string | null;
              unit: string;
              quantity: number;
              material: number;
              labor: number;
              subcontract: number;
              total: number;
              relevanceScore?: number;
            }
          >();

          for (const r of rows) {
            const code = (r.litteraCode || '').trim();
            if (!code || isLitteraPlaceholderCode(code)) continue;
            if (!byLittera.has(code)) {
              byLittera.set(code, {
                litteraCode: code,
                litteraName: r.litteraName || '',
                litteraCategory: r.litteraCategory,
                unit: r.unit || '',
                quantity: 0,
                material: 0,
                labor: 0,
                subcontract: 0,
                total: 0,
                relevanceScore: r.relevanceScore,
              });
            }
            const agg = byLittera.get(code)!;
            agg.quantity += r.quantity || 0;
            agg.material += r.material || 0;
            agg.labor += r.labor || 0;
            agg.subcontract += r.subcontract || 0;
            agg.total += r.total || 0;
          }

          // Aplicar estos Littera agregados a cada elemento del grupo
          // IMPORTANTE: Cada elemento debe tener su cantidad INDIVIDUAL, no la cantidad total del grupo
          // Las cantidades totales se calculan automáticamente al visualizar/exportar sumando las individuales
          groupElements.forEach((originalEl) => {
            const base = importedEdited[originalEl.id] ?? originalEl;

            const newLitteraCodes = Array.from(byLittera.values()).map((agg) => {
              // IMPORTANTE: El Excel NO tiene cantidades válidas para Littera, solo el tipo de unidad
              // Las cantidades deben calcularse SIEMPRE desde el IFC para mantener trazabilidad
              const finalQuantity = getQuantityForLitteraCodeByType(
                base.type || 'Unknown',
                agg.unit,
                base.baseQuantities || {},
                base.name || '',
                0,
                { description: agg.litteraName },
                base.extraProperties
              );

              // Si el Excel trae costes, repartir por elemento. Si no, calcular desde littera-prices × cantidad (igual que cantidades).
              const hasCostFromExcel = (agg.material || agg.labor || agg.subcontract || agg.total) > 0;
              const isLayer = base.extraProperties?.["CostaBIM.LayerRole"] === "layer";
              let materialPerEl: number;
              let laborPerEl: number;
              let subcontractPerEl: number;
              let totalPerEl: number;
              if (isLayer) {
                materialPerEl = laborPerEl = subcontractPerEl = totalPerEl = 0;
              } else if (hasCostFromExcel) {
                materialPerEl = agg.material ? agg.material / n : 0;
                laborPerEl = agg.labor ? agg.labor / n : 0;
                subcontractPerEl = agg.subcontract ? agg.subcontract / n : 0;
                totalPerEl =
                  agg.total && agg.total > 0 ? agg.total / n : materialPerEl + laborPerEl + subcontractPerEl;
              } else {
                const price = getPriceForLittera(agg.litteraCode, agg.unit);
                if (price) {
                  materialPerEl = (price.material ?? 0) * finalQuantity;
                  laborPerEl = (price.labor ?? 0) * finalQuantity;
                  subcontractPerEl = (price.subcontract ?? 0) * finalQuantity;
                  totalPerEl = (price.total ?? 0) * finalQuantity;
                } else {
                  materialPerEl = laborPerEl = subcontractPerEl = totalPerEl = 0;
                }
              }

              return {
                litteraCode: agg.litteraCode,
                litteraName: agg.litteraName,
                litteraCategory: agg.litteraCategory ?? undefined,
                unit: agg.unit,
                quantity: finalQuantity,
                relevanceScore: agg.relevanceScore,
                source: 'user' as const,
                ...(materialPerEl ||
                laborPerEl ||
                subcontractPerEl ||
                totalPerEl
                  ? {
                      costs: {
                        material: materialPerEl,
                        labor: laborPerEl,
                        subcontract: subcontractPerEl,
                        total: totalPerEl,
                      },
                    }
                  : {}),
              };
            });

            const aggregated = newLitteraCodes.reduce(
              (acc, lc) => {
                if (lc.costs) {
                  acc.material += lc.costs.material ?? 0;
                  acc.labor += lc.costs.labor ?? 0;
                  acc.subcontract += lc.costs.subcontract ?? 0;
                  acc.total += lc.costs.total ?? 0;
                }
                return acc;
              },
              { material: 0, labor: 0, subcontract: 0, total: 0 }
            );

            const updatedEl: BaseCostElement = {
              ...base,
              taloCode: taloCode || base.taloCode,
              litteraCodes: newLitteraCodes,
              litteraCode: newLitteraCodes[0]?.litteraCode,
              litteraName: newLitteraCodes[0]?.litteraName,
              litteraCategory: newLitteraCodes[0]?.litteraCategory,
              costs: aggregated.total > 0 ? aggregated : base.costs,
            };

            importedEdited[originalEl.id] = updatedEl;
            updated++;
          });
        }
      }

      // Si hay ediciones importadas, guardarlas como ediciones pendientes.
      // La tabla se actualizará usando effectiveCostData, pero costData solo
      // se consolidará al pulsar "Calculate Cost".
      if (Object.keys(importedEdited).length > 0) {
        setEditedElements((prev) => ({
          ...prev,
          ...importedEdited,
        }));
      }

      setSyncImportResult({ updated, ignored, errors: [] });
      console.log('[CostPage] Sync/Measurement import applied to costData:', {
        updated,
        ignored,
        editedCount: Object.keys(importedEdited).length,
        errorsCount: errors.length,
      });
    } catch (err) {
      console.error('[CostPage] Sync/Measurement import error:', err);
      setSyncImportResult({
        updated: 0,
        ignored: 0,
        errors: [err instanceof Error ? err.message : getTranslation(['syncImport', 'fileReadError'], language)],
      });
    }
  }, [costData, language, setEditedElements]);

  const handleCostEdit = (elementId: number, costType: keyof BaseCostElement['costs'], value: number) => {
    const element = costData.find(el => el.id === elementId);
    if (!element) return;

    const updatedElement = {
      ...element,
      costs: {
        ...element.costs,
        [costType]: value
      }
    };

    setEditedElements({
      ...editedElements,
      [elementId]: updatedElement
    });
  };

  const handleRemoveElements = React.useCallback((ids: number[]) => {
    removeElementsByIds(ids);
    setEditedElements((prev) => {
      const next = { ...prev };
      ids.forEach((id) => delete next[id]);
      return next;
    });
  }, [removeElementsByIds]);

  // Wrappers para sincronizar editedElements cuando se modifican Littera desde la UI
  // Esto asegura que los cambios se reflejen inmediatamente en la tabla, incluso si hay ediciones pendientes
  const handleRemoveLitteraCode = React.useCallback((elementId: number, litteraCode: string) => {
    // Llamar a la función del store
    removeLitteraCode(elementId, litteraCode);
    
    // Si hay una edición pendiente para este elemento, sincronizarla también
    setEditedElements((prev) => {
      const edited = prev[elementId];
      if (!edited) return prev; // No hay edición pendiente, el store ya lo maneja
      
      const existingCodes = edited.litteraCodes || [];
      const updatedCodes = existingCodes.filter(lc => lc.litteraCode !== litteraCode);
      
      if (updatedCodes.length === 0) {
        // Remove all Littera data if no codes remain
        return {
          ...prev,
          [elementId]: {
            ...edited,
            litteraCodes: undefined,
            litteraCode: undefined,
            litteraName: undefined,
            litteraCategory: undefined
          }
        };
      }
      
      // Update with remaining codes
      return {
        ...prev,
        [elementId]: {
          ...edited,
          litteraCodes: updatedCodes,
          litteraCode: updatedCodes[0]?.litteraCode,
          litteraName: updatedCodes[0]?.litteraName,
          litteraCategory: updatedCodes[0]?.litteraCategory
        }
      };
    });
  }, [removeLitteraCode]);

  const handleAddLitteraCode = React.useCallback((
    elementId: number,
    litteraCode: string,
    litteraName: string,
    litteraCategory: string | null,
    unit: string
  ) => {
    // Llamar a la función del store
    addLitteraCode(elementId, litteraCode, litteraName, litteraCategory, unit);
    
    // Si hay una edición pendiente para este elemento, sincronizarla también
    setEditedElements((prev) => {
      const edited = prev[elementId];
      if (!edited) return prev; // No hay edición pendiente, el store ya lo maneja
      
      // Verificar si el código ya existe
      const existingCodes = edited.litteraCodes || [];
      if (existingCodes.some(lc => lc.litteraCode === litteraCode)) {
        return prev; // Ya existe, no hacer nada
      }
      
      // Calcular cantidad (misma lógica que en CostStore)
      const element = costData.find(el => el.id === elementId);
      if (!element) return prev;
      
      const taloUnit = litteraUnitToTalo2000Unit(unit);
      const elementBQ = { baseQuantities: edited.baseQuantities || element.baseQuantities };
      const calculatedQuantity = getCorrectQuantity(elementBQ, taloUnit);
      
      const newCode = {
        litteraCode,
        litteraName,
        litteraCategory: litteraCategory || undefined,
        unit,
        quantity: calculatedQuantity,
        source: 'user' as const,
        costs: undefined
      };
      
      const updatedCodes = [...existingCodes, newCode];
      
      return {
        ...prev,
        [elementId]: {
          ...edited,
          litteraCodes: updatedCodes,
          litteraCode: updatedCodes[0]?.litteraCode,
          litteraName: updatedCodes[0]?.litteraName,
          litteraCategory: updatedCodes[0]?.litteraCategory
        }
      };
    });
  }, [addLitteraCode, costData]);

  /**
   * Aplica un código TALO a un grupo de elementos Y además ejecuta el filtrado de
   * Littera para asignar automáticamente los códigos sugeridos (incluyendo JM).
   * Esto resuelve el caso donde elementos sin TALO en el IFC (p.ej. deltapalkit de Revit)
   * no recibían códigos Littera durante el processElement inicial.
   */
  const handleApplySuggestionGroupWithLittera = React.useCallback(async (
    elementIds: number[],
    taloCode: string
  ) => {
    // Paso 1: Asignar el código TALO (sincrónico en Zustand)
    applySuggestionGroup(elementIds, taloCode);

    // Paso 2: Leer el estado actualizado inmediatamente (Zustand es sincrónico)
    const state = useCostStore.getState();
    const affectedElements = state.costData.filter(el => elementIds.includes(el.id));
    if (!affectedElements.length) return;

    const svc = litteraFilteringSvcRef.current;
    const mcpByGlobalId = state.ontelolaattaMcp?.byGlobalId ?? {};

    for (const el of affectedElements) {
      if (isConfirmedOntelolaattaElement(el, mcpByGlobalId)) {
        continue;
      }
      try {
        // el.taloCode ya tiene el nuevo código TALO asignado arriba
        const suggestions = await svc.getFilteredLitteraCodes(el as any, 10);

        for (const s of suggestions) {
          // Omitir códigos de agrupación y excluidos
          if (s.unit === '***' || s.relevanceScore < 0) continue;

          // Omitir si ya está asignado
          const alreadyExists = (el.litteraCodes || []).some(lc => lc.litteraCode === s.litteraCode);
          if (alreadyExists) continue;

          // addLitteraCode calcula la cantidad automáticamente (incluyendo JM → Length)
          addLitteraCode(el.id, s.litteraCode, s.description, s.category || null, s.unit);
        }
      } catch (err) {
        console.warn(`[CostPage] Error obteniendo sugerencias Littera para elemento ${el.id}:`, err);
      }
    }
  }, [applySuggestionGroup, addLitteraCode]);

  const handleUpdateLitteraCodeQuantity = React.useCallback((
    elementId: number,
    litteraCode: string,
    quantity: number
  ) => {
    // Llamar a la función del store
    updateLitteraCodeQuantity(elementId, litteraCode, quantity);
    
    // Si hay una edición pendiente para este elemento, sincronizarla también
    setEditedElements((prev) => {
      const edited = prev[elementId];
      if (!edited) return prev; // No hay edición pendiente, el store ya lo maneja
      
      const existingCodes = edited.litteraCodes || [];
      const updatedCodes = existingCodes.map(lc => {
        if (lc.litteraCode === litteraCode) {
          return { ...lc, quantity };
        }
        return lc;
      });
      
      return {
        ...prev,
        [elementId]: {
          ...edited,
          litteraCodes: updatedCodes
        }
      };
    });
  }, [updateLitteraCodeQuantity]);

  const handleRecalculate = () => {
    let updatedElements = costData.map(element => {
      if (editedElements[element.id]) {
        const editedElement = editedElements[element.id];
        // Base on current element so globalId and all fields are preserved (traceability)
        return {
          ...element,
          ...editedElement,
          costs: {
            ...editedElement.costs,
            total: editedElement.costs.material +
                   editedElement.costs.labor +
                   editedElement.costs.subcontract
          }
        };
      }
      return element;
    });

    // Integrar costes al objeto: si el elemento tiene litteraCodes con costes, el objeto debe mostrar la suma
    updatedElements = updatedElements.map((el) => {
      const lcs = el.litteraCodes ?? [];
      if (lcs.length === 0) return el;
      let material = 0;
      let labor = 0;
      let subcontract = 0;
      for (const lc of lcs) {
        const c = lc.costs ?? {};
        material += c.material ?? 0;
        labor += c.labor ?? 0;
        subcontract += c.subcontract ?? 0;
      }
      const total = material + labor + subcontract;
      return { ...el, costs: { ...el.costs, material, labor, subcontract, total } };
    });

    setCostData(updatedElements);
    setEditedElements({});
  };

  const handleLibraryUpload = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !/\.json$/i.test(file.name)) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = reader.result as string;
        const parsed: unknown = JSON.parse(raw);
        const result = validateCostLibrary(parsed);
        if (!result.valid) {
          alert(result.error);
          return;
        }
        loadLibrary({ ...result.lib, updatedAt: result.lib.updatedAt ?? new Date().toISOString().slice(0, 10) });
      } catch (err) {
        alert('No se pudo leer el archivo. Compruebe que es un JSON válido.');
      }
    };
    reader.readAsText(file);
  }, [loadLibrary]);

  const handleLibraryDownload = React.useCallback(() => {
    const lib = getLibrary();
    const projectBuildingType = projectInfo?.buildingType?.trim() || '';
    const projectConstructionMethod = projectInfo?.constructionMethod?.trim() || '';
    let payload: CostLibrary;

    // Priorizar lo que muestra la tabla (costData/effectiveCostData) para que al exportar
    // se genere un JSON con todos los Littera actuales. Solo usar la librería cargada si
    // no hay datos del proyecto (p. ej. proyecto vacío).
    if (costData?.length) {
      // Usar effectiveCostData para exportar lo que la tabla muestra (incluye ediciones
      // en editedElements). Así los Littera añadidos en la tabla se incluyen en el JSON.
      const dataToExport = effectiveCostData?.length ? effectiveCostData : costData;
      // Agrupar por clave (taloCode|elementType|normalizedName) y reunir todos los Littera
      // de los elementos del grupo, para que la librería exporte la unión completa (no solo
      // el primer elemento que podía tener menos códigos).
      const keyToElements = new Map<string, BaseCostElement[]>();
      for (const el of dataToExport) {
        if (!el.taloCode?.trim()) continue;
        const normalizedName = normalizeRevitName(el.name || '');
        const key = `${el.taloCode}|${el.type ?? ''}|${normalizedName}`;
        const list = keyToElements.get(key) ?? [];
        list.push(el);
        keyToElements.set(key, list);
      }
      const entries: LibraryEntry[] = [];
      for (const [key, elements] of keyToElements) {
        const first = elements[0];
        type LcItem = NonNullable<BaseCostElement['litteraCodes']>[number];
        const allLitteraByCode = new Map<string, { lc: LcItem; totalQtyForUnit: number }>();
        for (const el of elements) {
          const lcs = el.litteraCodes ?? [];
          const totalQtyByUnit = new Map<string, number>();
          for (const lc of lcs) {
            const q = lc.quantity ?? 0;
            const u = (lc.unit || '').toUpperCase() || 'M2';
            totalQtyByUnit.set(u, (totalQtyByUnit.get(u) ?? 0) + q);
          }
          for (const lc of lcs) {
            if (allLitteraByCode.has(lc.litteraCode)) continue;
            const u = (lc.unit || '').toUpperCase() || 'M2';
            allLitteraByCode.set(lc.litteraCode, { lc, totalQtyForUnit: totalQtyByUnit.get(u) ?? 1 });
          }
        }
        const litteraCodesArray = Array.from(allLitteraByCode.values());
        if (litteraCodesArray.length === 0) continue;
        const litteraCodes = litteraCodesArray.map(({ lc, totalQtyForUnit }) => {
          const qty = lc.quantity ?? 0;
          const totalForUnit = totalQtyForUnit;
          const quantityRatio = totalForUnit > 0 ? qty / totalForUnit : undefined;
          const costs = lc.costs;
          let costPerUnit: CostPerUnit | undefined;
          if (qty > 0 && costs && (costs.total != null || costs.material != null)) {
            costPerUnit = {
              material: costs.material != null ? costs.material / qty : undefined,
              labor: costs.labor != null ? costs.labor / qty : undefined,
            subcontract: costs.subcontract != null ? costs.subcontract / qty : undefined,
              total: costs.total != null ? costs.total / qty : undefined,
            };
          }
          return {
            litteraCode: lc.litteraCode,
            litteraName: lc.litteraName,
            litteraCategory: lc.litteraCategory,
            unit: lc.unit,
            ...(quantityRatio != null && quantityRatio >= 0 && quantityRatio <= 1 && { quantityRatio }),
            ...(costPerUnit && { costPerUnit }),
          };
        });
        entries.push({
          taloCode: first.taloCode,
          elementType: first.type ?? '',
          namePattern: normalizeRevitName(first.name || '') || undefined,
          unit: getCorrectUnit(first.type ?? '', first.taloCode),
          buildingType: projectBuildingType || undefined,
          constructionMethod: projectConstructionMethod || undefined,
          litteraCodes,
        });
      }
      payload = {
        version: '1.0',
        updatedAt: new Date().toISOString().slice(0, 10),
        metadata: {
          source: 'export',
          buildingType: projectBuildingType || undefined,
          constructionMethod: projectConstructionMethod || undefined,
        },
        entries,
      };
    } else if (lib?.entries?.length) {
      payload = lib;
    } else {
      payload = {
        version: '1.0',
        updatedAt: new Date().toISOString().slice(0, 10),
        entries: [],
      };
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const metaLabel = [payload.metadata?.buildingType, payload.metadata?.constructionMethod].filter(Boolean).join('-');
    a.download = metaLabel ? `cost-library-${metaLabel}-${payload.updatedAt}.json` : `cost-library-${payload.updatedAt}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [getLibrary, costData, effectiveCostData, projectInfo]);

  const handleLibraryApply = React.useCallback(() => {
    const lib = getLibrary();
    if (!lib || !lib.entries.length || !costData?.length) return;
    const projectBuildingType = (projectInfo?.buildingType ?? '').trim().toLowerCase();
    const projectConstructionMethod = (projectInfo?.constructionMethod ?? '').trim().toLowerCase();
    const updated = costData.map((el) => {
      const entry = lib.entries.find((e) => {
        if (e.taloCode !== el.taloCode || e.elementType !== el.type) return false;
        if (e.namePattern != null && e.namePattern !== '' && !el.name.includes(e.namePattern)) return false;
        const entryBuilding = (e.buildingType ?? '').trim().toLowerCase();
        if (entryBuilding !== '' && entryBuilding !== projectBuildingType) return false;
        const entryMethod = (e.constructionMethod ?? '').trim().toLowerCase();
        if (entryMethod !== '' && entryMethod !== projectConstructionMethod) return false;
        return true;
      });
      if (!entry) return el;
      const n = entry.litteraCodes.length;
      const elementBQ = { baseQuantities: el.baseQuantities };
      const fromLibrary = entry.litteraCodes.map((lc) => {
        // Usar getQuantityForLitteraCodeByType para calcular correctamente según el tipo IFC
        // (ej: perímetro de puertas = 2*height + width, no solo Length)
        const elementQtyForUnit = getQuantityForLitteraCodeByType(
          el.type || 'Unknown',
          lc.unit,
          el.baseQuantities || {},
          el.name || '',
          el.quantity || 0,
          { description: lc.litteraName },
          el.extraProperties
        );
        const ratio = lc.quantityRatio ?? (n > 0 ? 1 / n : 1);
        const quantity = elementQtyForUnit * ratio;
        let cpu = lc.costPerUnit;
        const legacyCosts = (lc as { costs?: CostPerUnit & { total?: number } }).costs;
        const legacyQty = (lc as { quantity?: number }).quantity;
        if (!cpu && legacyCosts && typeof legacyQty === 'number' && legacyQty > 0) {
          cpu = {
            material: legacyCosts.material != null ? legacyCosts.material / legacyQty : undefined,
            labor: legacyCosts.labor != null ? legacyCosts.labor / legacyQty : undefined,
            subcontract: legacyCosts.subcontract != null ? legacyCosts.subcontract / legacyQty : undefined,
            total: legacyCosts.total != null ? legacyCosts.total / legacyQty : undefined,
          };
        }
        let costs: { material: number; labor: number; subcontract: number; total: number } | undefined;
        if (cpu && (cpu.total != null || cpu.material != null)) {
          costs = {
            material: (cpu.material ?? 0) * quantity,
            labor: (cpu.labor ?? 0) * quantity,
            subcontract: (cpu.subcontract ?? 0) * quantity,
            total: (cpu.total ?? 0) * quantity,
          };
        }
        return {
          litteraCode: lc.litteraCode,
          litteraName: lc.litteraName,
          litteraCategory: lc.litteraCategory,
          unit: lc.unit,
          quantity,
          ...(costs && { costs }),
        };
      });
      // Fusionar: Littera de la librería añaden o actualizan por litteraCode; los que ya tiene
      // el elemento y no están en la librería se mantienen (no se eliminan).
      const existingByCode = new Map((el.litteraCodes ?? []).map((lc) => [lc.litteraCode, lc]));
      for (const lc of fromLibrary) {
        existingByCode.set(lc.litteraCode, lc);
      }
      const litteraCodes = Array.from(existingByCode.values());
      const aggregated = litteraCodes.reduce(
        (acc, lc) => {
          if (lc.costs) {
            acc.material += lc.costs.material ?? 0;
            acc.labor += lc.costs.labor ?? 0;
            acc.subcontract += lc.costs.subcontract ?? 0;
            acc.total += lc.costs.total ?? 0;
          }
          return acc;
        },
        { material: 0, labor: 0, subcontract: 0, total: 0 }
      );
      const hasCosts = aggregated.total > 0 || aggregated.material > 0 || aggregated.labor > 0;
      return {
        ...el,
        litteraCodes,
        ...(hasCosts && { costs: aggregated }),
      };
    });
    setCostData(updated);
    // La tabla usa effectiveCostData = costData con override por editedElements.
    // Si no limpiamos editedElements, los elementos con ediciones pendientes seguirían
    // mostrando la versión antigua y no se verían los Littera aplicados.
    setEditedElements({});
  }, [getLibrary, costData, setCostData, projectInfo]);

  if (isLoading) {
    return <LoadingState language={language} />;
  }

  if (!costData || costData.length === 0) {
    return <EmptyState language={language} />;
  }

  // Function to download measurement data as JSON
  // Helper function to escape CSV values
  const escapeCSV = (value: any): string => {
    if (value === null || value === undefined) return '';
    const stringValue = String(value);
    // If contains commas, quotes or newlines, wrap in quotes and double internal quotes
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  };

  const handleDownloadMeasurementData = () => {
    if (!costData || costData.length === 0) {
      alert('No data available to export');
      return;
    }

    const currentDate = new Date().toISOString().split('T')[0];
    
    // Preparar datos completos para inspección
    const measurementData = {
      metadata: {
        exportDate: new Date().toISOString(),
        projectName: projectInfo?.name || 'Unnamed Project',
        projectArea: projectInfo?.area || 0,
        projectLocation: projectInfo?.location || 'Helsinki',
        buildingType: projectInfo?.buildingType || 'residential',
        constructionMethod: projectInfo?.constructionMethod || 'traditional',
        totalElements: costData.length,
        elementsWithLittera: costData.filter(el => el.litteraCodes && el.litteraCodes.length > 0).length,
        elementsWithoutLittera: costData.filter(el => !el.litteraCodes || el.litteraCodes.length === 0).length
      },
      summary: {
        totalMaterial: costSummary.totalMaterial,
        totalLabor: costSummary.totalLabor,
        totalSubcontract: costSummary.totalSubcontract,
        grandTotal: costSummary.grandTotal
      },
      elements: costData.map((element) => {
        // Normalizar nombre para agrupamiento (mismo patrón que en la UI)
        const normalizedName = normalizeRevitName(element.name);
        
        return {
        // Identification
        id: element.id,
        name: element.name, // Nombre original
        normalizedName: normalizedName, // Nombre normalizado para agrupamiento
        type: element.type,
        category: (element as any).category || '',
        
        // TALO classification
        taloCode: element.taloCode,
        taloName: element.taloName,
        
        // Littera classification (multiple codes)
        litteraCodes: element.litteraCodes || [],
        litteraCodesCount: element.litteraCodes?.length || 0,
        
        // Legacy Littera (for backward compatibility)
        litteraCode: element.litteraCode,
        litteraName: element.litteraName,
        litteraCategory: element.litteraCategory,
        
        // Quantities
        quantity: element.quantity,
        baseQuantities: element.baseQuantities,
        
        // Costs
        costs: {
          material: element.costs.material,
          labor: element.costs.labor,
          equipment: element.costs.subcontract,
          overhead: element.costs.subcontract,
          total: element.costs.total
        },
        
        // Calculated metrics
        laborHours: element.costs.labor / 45,
        costPerUnit: element.quantity > 0 ? element.costs.total / element.quantity : 0
      };
      })
    };

    // Create and download JSON file
    const jsonString = JSON.stringify(measurementData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `measurement-ifc-${currentDate}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    console.log('[CostPage] Measurement data exported:', {
      totalElements: measurementData.elements.length,
      withLittera: measurementData.metadata.elementsWithLittera,
      withoutLittera: measurementData.metadata.elementsWithoutLittera
    });
  };

  const handleDownloadMeasurementCSV = () => {
    if (!costData || costData.length === 0) {
      alert('No data available to export');
      return;
    }

    const currentDate = new Date().toISOString().split('T')[0];
    
    // CSV Headers
    const headers = [
      'Element ID',
      'Name',
      'Normalized Name',
      'IFC Type',
      'Category',
      'TALO Code',
      'TALO Name',
      'Littera Code',
      'Littera Name',
      'Littera Category',
      'Littera Unit',
      'Littera Quantity',
      'Littera Relevance',
      'Primary Quantity',
      'Area (m²)',
      'Volume (m³)',
      'Length (m)',
      'Material Cost',
      'Labor Cost',
      'Subcontract Cost',
      'Total Cost',
      'Labor Hours',
      'Cost per Unit'
    ];

    // Create CSV rows
    // Each Littera code generates a separate row
    const rows: string[] = [];
    
      costData.forEach((element) => {
        const el = element as any as BaseCostElement;
        const area = el.baseQuantities?.Area?.value || el.baseQuantities?.GrossArea?.value || el.baseQuantities?.NetArea?.value || '';
        const volume = el.baseQuantities?.Volume?.value || el.baseQuantities?.GrossVolume?.value || el.baseQuantities?.NetVolume?.value || '';
        const length = el.baseQuantities?.Length?.value || '';
        const laborHours = el.costs.labor / 45;
        const costPerUnit = el.quantity > 0 ? el.costs.total / el.quantity : 0;

      // Normalizar nombre para agrupamiento
      const normalizedName = normalizeRevitName(el.name);
      
      // If element has Littera codes, create a row for each code
      if (el.litteraCodes && el.litteraCodes.length > 0) {
        el.litteraCodes.forEach(litteraCode => {
          const row = [
            escapeCSV(el.id),
            escapeCSV(el.name),
            escapeCSV(normalizedName),
            escapeCSV(el.type),
            escapeCSV((el as any).category || ''),
            escapeCSV(el.taloCode),
            escapeCSV(el.taloName),
            escapeCSV(litteraCode.litteraCode),
            escapeCSV(litteraCode.litteraName),
            escapeCSV(litteraCode.litteraCategory),
            escapeCSV(litteraCode.unit),
            escapeCSV(litteraCode.quantity),
            escapeCSV(litteraCode.relevanceScore !== undefined ? litteraCode.relevanceScore : ''),
            escapeCSV(el.quantity),
            escapeCSV(area),
            escapeCSV(volume),
            escapeCSV(length),
            escapeCSV(el.costs.material.toFixed(2)),
            escapeCSV(el.costs.labor.toFixed(2)),
            escapeCSV(el.costs.subcontract.toFixed(2)),
            escapeCSV(el.costs.total.toFixed(2)),
            escapeCSV(laborHours.toFixed(2)),
            escapeCSV(costPerUnit.toFixed(2))
          ];
          rows.push(row.join(','));
        });
      } else {
        // If no Littera codes, create a row without Littera data
        const row = [
          escapeCSV(el.id),
          escapeCSV(el.name),
          escapeCSV(normalizedName),
          escapeCSV(el.type),
          escapeCSV((el as any).category || ''),
          escapeCSV(el.taloCode),
          escapeCSV(el.taloName),
          escapeCSV(''), // Empty Littera Code
          escapeCSV(''), // Empty Littera Name
          escapeCSV(''), // Empty Littera Category
          escapeCSV(''), // Empty Littera Unit
          escapeCSV(''), // Empty Littera Quantity
          escapeCSV(''), // Empty Littera Relevance
          escapeCSV(el.quantity),
          escapeCSV(area),
          escapeCSV(volume),
          escapeCSV(length),
          escapeCSV(el.costs.material.toFixed(2)),
          escapeCSV(el.costs.labor.toFixed(2)),
          escapeCSV(el.costs.subcontract.toFixed(2)),
          escapeCSV(el.costs.total.toFixed(2)),
          escapeCSV(laborHours.toFixed(2)),
          escapeCSV(costPerUnit.toFixed(2))
        ];
        rows.push(row.join(','));
      }
    });

    // Combine headers and rows
    const csvContent = [
      // Metadata as CSV comments (some CSV readers may ignore them)
      `# IFC Measurement - Exported: ${new Date().toISOString()}`,
      `# Project: ${projectInfo?.name || 'Unnamed Project'}`,
      `# Location: ${projectInfo?.location || 'Helsinki'}`,
      `# Area: ${projectInfo?.area || 0} m²`,
      `# Building Type: ${projectInfo?.buildingType || 'residential'}`,
      `# Construction Method: ${projectInfo?.constructionMethod || 'traditional'}`,
      `# Total Elements: ${costData.length}`,
      `# Elements with Littera: ${costData.filter(el => el.litteraCodes && el.litteraCodes.length > 0).length}`,
      `# Elements without Littera: ${costData.filter(el => !el.litteraCodes || el.litteraCodes.length === 0).length}`,
      `# Cost Summary:`,
      `#   Material: ${costSummary.totalMaterial.toFixed(2)}`,
      `#   Labor: ${costSummary.totalLabor.toFixed(2)}`,
      `#   Subcontract: ${costSummary.totalSubcontract.toFixed(2)}`,
      `#   Total: ${costSummary.grandTotal.toFixed(2)}`,
      '', // Empty line before headers
      headers.join(','),
      ...rows
    ].join('\n');

    // Create and download CSV file
    // Use UTF-8 BOM so Excel opens special characters correctly
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `measurement-ifc-${currentDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    const totalRows = rows.length;
    const elementsWithLittera = costData.filter(el => el.litteraCodes && el.litteraCodes.length > 0).length;
    console.log('[CostPage] CSV exported:', {
      totalElements: costData.length,
      totalRows: totalRows,
      withLittera: elementsWithLittera,
      withoutLittera: costData.length - elementsWithLittera
    });
  };

  const handleDownloadMeasurementExcel = async () => {
    if (!costData || costData.length === 0) {
      alert('No data available to export');
      return;
    }

    try {
      const HEADER_ROW_INDEX = 3; // Reservamos filas 1-2 para el logo
      const currentDate = new Date().toISOString().split('T')[0];
      
      // Create workbook and worksheet
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Costa - IFC Cost Analysis';
      workbook.created = new Date();
      
      const worksheet = workbook.addWorksheet('Measurement Data', {
        views: [{ 
          state: 'frozen', 
          ySplit: HEADER_ROW_INDEX,
          showGridLines: true 
        }], // Freeze header row
        properties: {
          outlineLevelRow: 2, // Maximum outline level (0-indexed, so 2 = 3 levels: 0, 1, 2)
          outlineLevelCol: 0,
          outlineProperties: {
            summaryBelow: false, // Show summaries (group headers) above details
            summaryRight: false
          }
        }
      });

      const EXCEL_FONT = '&"Roboto Mono"';
      const ODD_HEADER = `${EXCEL_FONT}&R&D`;
      const ODD_FOOTER = `${EXCEL_FONT}&LCosta Laskenta Oy\nY-tunnus: 3019665-7&R&P`;

      const loadCostaLogoPngBase64 = async (): Promise<string | null> => {
        try {
          const res = await fetch("/Costa_logo.svg");
          if (!res.ok) return null;
          const svgText = await res.text();
          const match = svgText.match(/base64,([^"]+)/);
          return match?.[1]?.replace(/\s+/g, "") ?? null;
        } catch {
          return null;
        }
      };

      // Define standard columns (no emoticons; Excel-compatible text only)
      // NOTE: We intentionally do NOT expose raw JSON in a visible column; group-level Littera details
      // are shown as separate rows (one per Littera) which are human-readable and also used on import.
      const standardColumns = [
        { header: 'IFC Type', key: 'ifcType', width: 15 },
        { header: 'Name', key: 'name', width: 40 },
        { header: 'GUID', key: 'globalId', width: 24 }, // IFC GUID para trazabilidad con el modelo
        { header: 'TALO Code', key: 'taloCode', width: 12 },
        // Nota: omitimos TALO Name en Measurement Data para simplificar la vista;
        // el nombre del código TALO sigue disponible en otros contextos (p.ej. Sync sheet).
        { header: 'Littera Code', key: 'litteraCode', width: 12 },
        { header: 'Littera Name', key: 'litteraName', width: 40 },
        { header: 'Littera Category', key: 'litteraCategory', width: 25 },
        { header: 'Unit', key: 'unit', width: 8 },
        { header: 'Quantity', key: 'quantity', width: 12, style: { numFmt: '#,##0.00' } },
        { header: 'Relevance Score', key: 'relevanceScore', width: 15 },
        { header: 'Area (m²)', key: 'area', width: 12, style: { numFmt: '#,##0.00' } },
        { header: 'Volume (m³)', key: 'volume', width: 12, style: { numFmt: '#,##0.00' } },
        { header: 'Length (m)', key: 'length', width: 12, style: { numFmt: '#,##0.00' } },
        { header: 'Material Cost', key: 'materialCost', width: 15, style: { numFmt: '#,##0.00' } },
        { header: 'Labor Cost', key: 'laborCost', width: 15, style: { numFmt: '#,##0.00' } },
        { header: 'Subcontract Cost', key: 'subcontractCost', width: 15, style: { numFmt: '#,##0.00' } },
        { header: 'Total Cost', key: 'totalCost', width: 15, style: { numFmt: '#,##0.00' } }
      ];

      // Collect all unique units across all IFC types (shared with CostTableExcelStyle)
      const allUnitsSet = new Set<string>();
      costData.forEach(element => {
        const units = getUnitsForIFCType(element.type);
        units.forEach(unit => allUnitsSet.add(unit));
      });
      const allUnits = Array.from(allUnitsSet).sort();

      // Add unit summary columns starting from column T (index 19, which is column 20)
      const unitColumns = allUnits.map(unit => {
        let header = unit;
        if (unit === 'M2' || unit === 'BRM2' || unit === 'NM2') header = `${unit} (m²)`;
        else if (unit === 'M3' || unit === 'RM3' || unit === 'NM3') header = `${unit} (m³)`;
        else if (unit === 'JM' || unit === 'M') header = `${unit} (m)`;
        else if (unit === 'KG') header = `${unit} (kg)`;
        else if (unit === 'KPL') header = `${unit} (pcs)`;
        else if (unit === 'ERÄ') header = `${unit} (lot)`;
        else if (unit === 'AS') header = `${unit} (m²)`;
        
        return {
          header: header,
          key: `unit_${unit}`,
          width: 12,
          style: { numFmt: '#,##0.00' }
        };
      });

      const allColumnsForHeader = [...standardColumns, ...unitColumns];

      // Evitamos que ExcelJS genere headers automáticamente en la fila 1.
      // En su lugar, los ponemos manualmente en `HEADER_ROW_INDEX`.
      worksheet.columns = [
        ...standardColumns.map((c) => ({ key: c.key, width: c.width })),
        ...unitColumns.map((c) => ({ key: c.key, width: c.width })),
      ] as any;

      // Logo como imagen repetible (en filas superiores), a ~1/2 tamaño
      const costaLogoPngBase64 = await loadCostaLogoPngBase64();
      if (costaLogoPngBase64) {
        const imageId = workbook.addImage({
          base64: costaLogoPngBase64,
          extension: 'png',
        });

        worksheet.getRow(1).height = 15;
        worksheet.getRow(2).height = 0;

        worksheet.addImage(imageId, {
          tl: { col: 0, row: 0 }, // A1 (0-based)
          ext: { width: 100, height: 22 },
        });
      }

      // Repetir filas del logo + header en cada página impresa
      worksheet.pageSetup.printTitlesRow = `1:${HEADER_ROW_INDEX}`;

      // Header/Footer (texto + fecha/página, con la fuente de la plantilla)
      worksheet.headerFooter = {
        differentFirst: false,
        differentOddEven: false,
        firstHeader: ODD_HEADER,
        firstFooter: ODD_FOOTER,
        oddHeader: ODD_HEADER,
        oddFooter: ODD_FOOTER,
        evenHeader: ODD_HEADER,
        evenFooter: ODD_FOOTER,
      };

      // Style header row (manual en HEADER_ROW_INDEX)
      const headerRow = worksheet.getRow(HEADER_ROW_INDEX);
      allColumnsForHeader.forEach((col, idx) => {
        headerRow.getCell(idx + 1).value = col.header;
      });

      headerRow.font = { bold: true, name: 'Roboto Mono', color: { argb: 'FFFFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      headerRow.height = 20;

      // Group by IFC type + TALO + name (same logic as CostTableExcelStyle)
      const { elementsByType } = buildGroupedData(costData);

      let currentRow = 2; // Start after header

      // Process each IFC Type group
      elementsByType.forEach((elementGroups, ifcType) => {
        const typeStartRow = currentRow;
        
        let typeTotalCost = 0;
        let typeElementCount = 0;
        let typeLitteraCount = 0;

        // Add type summary row (group header)
        const typeRow = worksheet.addRow({
          ifcType: ifcType,
          name: `${elementGroups.size} group${elementGroups.size !== 1 ? 's' : ''}`,
          totalCost: 0 // Will be calculated
        });
        
        typeRow.font = { bold: true, size: 12, name: 'Roboto Mono', color: { argb: 'FFFFFFFF' } };
        typeRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF4472C4' }
        };
        typeRow.alignment = { vertical: 'middle', horizontal: 'left' };
        typeRow.height = 20;
        typeRow.outlineLevel = 0; // Level 0: Top-level group (IFC Type)
        currentRow++;

        // Process each grouped element (Normalized Name + TALO Code)
        elementGroups.forEach((elements, groupKey) => {
          const firstElement = pickAssemblyGroupLead(elements);
          const normalizedName = normalizeRevitName(firstElement.name);
          const isRevit = firstElement.name !== normalizedName; // Detect if it's Revit (name was normalized)
          const displayName = isRevit ? normalizedName : firstElement.name;
          
          // Calculate aggregated values for the group
          const groupTotalCost = elements.reduce((sum, el) => sum + el.costs.total, 0);
          const groupMaterialCost = elements.reduce((sum, el) => sum + el.costs.material, 0);
          const groupLaborCost = elements.reduce((sum, el) => sum + el.costs.labor, 0);
          const groupSubcontractCost = elements.reduce((sum, el) => sum + el.costs.subcontract, 0);
          
          const groupArea = groupMaaraAreaM2(elements);
          const groupVolume = groupMaaraVolumeM3(elements);
          const groupLength = groupMaaraLengthM(elements);
          
          const hostCount = assemblyHostCount(elements);
          const variantCount = hostCount > 0 ? hostCount : elements.length;
          const variantText = variantCount > 1 ? ` (${variantCount} variants)` : '';
          const unitsForTypeForGroup = getUnitsForIFCType(ifcType);

          const groupQuantitiesByUnit = calculateBaseQuantitiesByUnitForElements(elements, ifcType);
          const elementRowData: Record<string, unknown> = {
            ifcType: '',
            name: `${displayName}${variantText}`,
            globalId: '', // Level 2: group row; GUIDs in level 4
            taloCode: firstElement.taloCode || '',
            area: groupArea,
            volume: groupVolume,
            length: groupLength,
            materialCost: groupMaterialCost,
            laborCost: groupLaborCost,
            subcontractCost: groupSubcontractCost,
            totalCost: groupTotalCost
          };
          allUnits.forEach(unit => {
            const key = `unit_${unit}`;
            elementRowData[key] = unitsForTypeForGroup.includes(unit) && groupQuantitiesByUnit[unit] !== '' ? groupQuantitiesByUnit[unit] : '';
          });

          // Add grouped element summary row (level 2: Name, TALO, costs + measurement summary)
          const elementRow = worksheet.addRow(elementRowData);
          elementRow.font = { bold: true, size: 11, name: 'Roboto Mono' };
          elementRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFDCE6F1' }
          };
          elementRow.alignment = { vertical: 'middle', horizontal: 'left' };
          elementRow.height = 18;
          elementRow.outlineLevel = 1; // Level 1: Element group (nested under IFC Type)
          currentRow++;
          typeElementCount += variantCount;
          typeTotalCost += groupTotalCost;

          // Collect and aggregate Littera codes from all elements in the group
          const litteraCodeMap = new Map<string, {
            litteraCode: string;
            litteraName: string;
            litteraCategory?: string;
            unit: string;
            quantity: number;
            relevanceScore?: number;
            materialCost: number;
            laborCost: number;
            subcontractCost: number;
            totalCost: number;
          }>();

          // Process all elements in the group to aggregate Littera codes
          const mcpByGlobalId = useCostStore.getState().ontelolaattaMcp?.byGlobalId ?? {};
          elements.forEach((el) => {
            if (!contributesToMaara(el.extraProperties)) return;
            const confirmedOntelo = isConfirmedOntelolaattaElement(el, mcpByGlobalId);
            const elementLitteraCodes = litteraCodesForConfirmedOntelolaatta(
              el.litteraCodes,
              confirmedOntelo
            );
            if (elementLitteraCodes && elementLitteraCodes.length > 0) {
              // Calculate total quantity of all Littera codes for this element to distribute costs proportionally
              const totalLitteraQuantity = elementLitteraCodes.reduce((sum, lc) => sum + (lc.quantity || 0), 0);
              
              elementLitteraCodes.forEach((lc) => {
                const key = lc.litteraCode;
                if (!litteraCodeMap.has(key)) {
                  litteraCodeMap.set(key, {
                    litteraCode: lc.litteraCode,
                    litteraName: lc.litteraName,
                    litteraCategory: lc.litteraCategory,
                    unit: lc.unit,
                    quantity: 0,
                    relevanceScore: lc.relevanceScore,
                    materialCost: 0,
                    laborCost: 0,
                    subcontractCost: 0,
                    totalCost: 0
                  });
                }
                const aggregated = litteraCodeMap.get(key)!;
                aggregated.quantity += lc.quantity || 0;
                
                // Distribute element costs proportionally based on Littera code quantity
                // If total quantity is 0, distribute equally
                const lcQuantity = lc.quantity || 0;
                const costRatio = totalLitteraQuantity > 0 ? lcQuantity / totalLitteraQuantity : (1 / elementLitteraCodes.length);
                
                aggregated.materialCost += el.costs.material * costRatio;
                aggregated.laborCost += el.costs.labor * costRatio;
                aggregated.subcontractCost += el.costs.subcontract * costRatio;
                aggregated.totalCost += el.costs.total * costRatio;
              });
            }
          });

          // Add rows for aggregated Littera codes (visual + datos editables por grupo)
          // Cada fila de Littera representa un código Littera agregado para este grupo:
          // - ifcType: tipo IFC del grupo
          // - name: nombre normalizado del grupo (sin sufijos de Revit)
          // - taloCode/taloName: del primer elemento del grupo
          // - quantity / costs: totales del grupo para ese Littera
          if (litteraCodeMap.size > 0) {
            litteraCodeMap.forEach((aggregatedLittera) => {
              const detailRow = worksheet.addRow({
                ifcType: ifcType,
                name: normalizedName,
                globalId: '',
                taloCode: firstElement.taloCode || '',
                litteraCode: aggregatedLittera.litteraCode,
                litteraName: aggregatedLittera.litteraName,
                litteraCategory: aggregatedLittera.litteraCategory,
                unit: aggregatedLittera.unit,
                quantity: aggregatedLittera.quantity,
                relevanceScore: aggregatedLittera.relevanceScore || 0,
                area: groupArea,
                volume: groupVolume,
                length: groupLength,
                materialCost: aggregatedLittera.materialCost,
                laborCost: aggregatedLittera.laborCost,
                subcontractCost: aggregatedLittera.subcontractCost,
                totalCost: aggregatedLittera.totalCost
              });

              detailRow.outlineLevel = 2; // Level 2: Detail rows (nested under Element)
              detailRow.font = { size: 10, name: 'Roboto Mono' };
              detailRow.alignment = { vertical: 'middle' };
              
              // Highlight high relevance codes
              if (aggregatedLittera.relevanceScore && aggregatedLittera.relevanceScore > 200) {
                detailRow.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFF0F9E6' }
                };
              }

              currentRow++;
              typeLitteraCount++;
            });
          } else {
            // No Littera codes - add one Claude placeholder row with group keys populated.
            // Keep this row intentionally empty in quantity/measurements/costs so it acts as a clean editable placeholder.
            // This preserves block shape for MCP inplace updates and keeps import matching stable.
            const detailRow = worksheet.addRow({
              ifcType: ifcType,
              name: normalizedName,
              globalId: '',
              taloCode: firstElement.taloCode || '',
              litteraCode: CLAUDE_PLACEHOLDER_CODE,
              litteraName: CLAUDE_PLACEHOLDER_CODE,
              unit: '',
              quantity: '',
              relevanceScore: '',
              area: '',
              volume: '',
              length: '',
              materialCost: '',
              laborCost: '',
              subcontractCost: '',
              totalCost: ''
            });
            detailRow.font = { italic: true, color: { argb: 'FF808080' }, name: 'Roboto Mono' };
            detailRow.outlineLevel = 2; // Level 2: Detail row even if no Littera codes
            currentRow++;
          }

          // Level 4: one row per GUID with that element measurement summary AND individual costs for editing
          elements.forEach((el) => {
            const singleQuantities = calculateBaseQuantitiesByUnitForElements([el], ifcType);
            const guidRowData: Record<string, unknown> = {
              ifcType: '',
              name: '',
              globalId: el.globalId || '',
              taloCode: el.taloCode || '',
              litteraCode: '',
              litteraName: '',
              litteraCategory: '',
              unit: '',
              quantity: '',
              relevanceScore: '',
              area: '',
              volume: '',
              length: '',
              materialCost: el.costs.material,
              laborCost: el.costs.labor,
              subcontractCost: el.costs.subcontract,
              totalCost: el.costs.total
            };
            allUnits.forEach(unit => {
              const key = `unit_${unit}`;
              guidRowData[key] = unitsForTypeForGroup.includes(unit) && singleQuantities[unit] !== '' ? singleQuantities[unit] : '';
            });
            const guidRow = worksheet.addRow(guidRowData);
            guidRow.font = { size: 10, color: { argb: 'FF666666' }, name: 'Roboto Mono' };
            guidRow.alignment = { vertical: 'middle' };
            guidRow.outlineLevel = 3; // Level 4 in user terms: GUID rows
            currentRow++;
          });
        });

        // Update type summary row with totals
        typeRow.getCell('name').value = `${elementGroups.size} group${elementGroups.size !== 1 ? 's' : ''}, ${typeElementCount} element${typeElementCount !== 1 ? 's' : ''}, ${typeLitteraCount} Littera code${typeLitteraCount !== 1 ? 's' : ''}`;
        typeRow.getCell('totalCost').value = typeTotalCost;
        typeRow.getCell('totalCost').numFmt = '#,##0.00';
      });

      // Configure outline settings (4 levels: IFC Type, Element group, Littera, GUID)
      worksheet.properties.outlineLevelRow = 3;
      worksheet.properties.outlineLevelCol = 0;
      worksheet.properties.outlineProperties = {
        summaryBelow: false, // Show summaries above details
        summaryRight: false
      };

      // Export with all levels collapsed: only level 0 (IFC types) visible initially
      const lastRowNumber = worksheet.lastRow?.number || 0;
      for (let i = HEADER_ROW_INDEX + 1; i <= lastRowNumber; i++) {
        const row = worksheet.getRow(i);
        if (row.outlineLevel !== undefined && row.outlineLevel >= 1) {
          row.hidden = true;
        }
      }

      // Add grand total row at the end
      const grandTotalRow = worksheet.addRow({
        ifcType: 'GRAND TOTAL',
        name: `${costData.length} elements total`,
        totalCost: costSummary.grandTotal
      });
      grandTotalRow.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      grandTotalRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF203864' }
      };
      grandTotalRow.getCell('totalCost').numFmt = '#,##0.00';
      grandTotalRow.outlineLevel = 0; // Grand total is not part of any group

      // Outline: Level 0 = IFC Type, 1 = Element group (name, TALO, costs + measurements), 2 = Littera, 3 = GUID rows

      // Sync sheet: one row per element by GUID for import/update (Fase 2B); measurements are not written here (not overwritten on import)
      const syncSheet = workbook.addWorksheet(SYNC_SHEET_NAME, {
        views: [{ state: 'frozen', ySplit: 1, showGridLines: true }]
      });
      syncSheet.columns = [
        { header: SYNC_COLUMNS.GUID, key: 'guid', width: 26 },
        { header: SYNC_COLUMNS.TALO_CODE, key: 'taloCode', width: 14 },
        { header: SYNC_COLUMNS.TALO_NAME, key: 'taloName', width: 32 },
        { header: SYNC_COLUMNS.MATERIAL_COST, key: 'materialCost', width: 14, style: { numFmt: '#,##0.00' } },
        { header: SYNC_COLUMNS.LABOR_COST, key: 'laborCost', width: 12, style: { numFmt: '#,##0.00' } },
        { header: SYNC_COLUMNS.SUBCONTRACT_COST, key: 'subcontractCost', width: 14, style: { numFmt: '#,##0.00' } },
        { header: SYNC_COLUMNS.TOTAL_COST, key: 'totalCost', width: 12, style: { numFmt: '#,##0.00' } },
        { header: SYNC_COLUMNS.LITTERA_CODES, key: 'litteraCodes', width: 80 }
      ];
      const syncHeaderRow = syncSheet.getRow(1);
      syncHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      syncHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
      syncHeaderRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      syncHeaderRow.height = 22;
      costData.forEach((el) => {
        const guid = el.globalId ?? '';
        const litteraJson = el.litteraCodes && el.litteraCodes.length > 0
          ? JSON.stringify(el.litteraCodes.map((lc: any) => ({
              litteraCode: lc.litteraCode,
              litteraName: lc.litteraName,
              litteraCategory: lc.litteraCategory ?? null,
              unit: lc.unit,
              quantity: lc.quantity ?? 0,
              source: lc.source,
              ...(lc.costs && {
                costs: {
                  material: lc.costs.material ?? 0,
                  labor: lc.costs.labor ?? 0,
                  subcontract: lc.costs.subcontract ?? 0,
                  total: lc.costs.total ?? 0,
                },
              }),
            })))
          : '';
        syncSheet.addRow({
          guid,
          taloCode: el.taloCode ?? '',
          taloName: el.taloName ?? '',
          materialCost: el.costs.material,
          laborCost: el.costs.labor,
          subcontractCost: el.costs.subcontract,
          totalCost: el.costs.total,
          litteraCodes: litteraJson
        });
      });

      // Add comprehensive metadata sheet
      const metadataSheet = workbook.addWorksheet('Metadata');
      metadataSheet.columns = [
        { header: 'Property', key: 'property', width: 30 },
        { header: 'Value', key: 'value', width: 60 }
      ];

      // Calculate statistics
      const elementsWithLittera = costData.filter(el => el.litteraCodes && el.litteraCodes.length > 0);
      const totalLitteraCodes = costData.reduce((sum, el) => sum + (el.litteraCodes?.length || 0), 0);
      const elementsByTypeStats = new Map<string, number>();
      costData.forEach(el => {
        const type = el.type || 'Unknown';
        elementsByTypeStats.set(type, (elementsByTypeStats.get(type) || 0) + 1);
      });

      const metadataRows = [
        // Project Information
        { property: 'PROJECT INFORMATION', value: '' },
        { property: 'Export Date', value: new Date().toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) },
        { property: 'Export Date (ISO)', value: new Date().toISOString() },
        { property: 'Project Name', value: projectInfo?.name || 'Unnamed Project' },
        { property: 'Location', value: projectInfo?.location || 'Helsinki' },
        { property: 'Area (m²)', value: projectInfo?.area ? projectInfo.area.toFixed(2) : '0.00' },
        { property: 'Building Type', value: projectInfo?.buildingType || 'residential' },
        { property: 'Construction Method', value: projectInfo?.constructionMethod || 'traditional' },
        { property: '', value: '' },
        
        // Element Statistics
        { property: 'ELEMENT STATISTICS', value: '' },
        { property: 'Total Elements', value: costData.length },
        { property: 'Elements with Littera Codes', value: elementsWithLittera.length },
        { property: 'Elements without Littera Codes', value: costData.length - elementsWithLittera.length },
        { property: 'Total Littera Codes Assigned', value: totalLitteraCodes },
        { property: 'Average Littera Codes per Element', value: costData.length > 0 ? (totalLitteraCodes / costData.length).toFixed(2) : '0.00' },
        { property: '', value: '' },
        
        // Elements by Type
        { property: 'ELEMENTS BY IFC TYPE', value: '' },
        ...Array.from(elementsByTypeStats.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) => ({ property: type, value: count })),
        { property: '', value: '' },
        
        // Cost Summary
        { property: 'COST SUMMARY', value: '' },
        { property: 'Material Cost (€)', value: costSummary.totalMaterial.toFixed(2) },
        { property: 'Labor Cost (€)', value: costSummary.totalLabor.toFixed(2) },
        { property: 'Subcontract Cost (€)', value: costSummary.totalSubcontract.toFixed(2) },
        { property: 'Grand Total (€)', value: costSummary.grandTotal.toFixed(2) },
        { property: '', value: '' },
        { property: 'Cost per m² (€/m²)', value: projectInfo?.area && projectInfo.area > 0 
          ? (costSummary.grandTotal / projectInfo.area).toFixed(2) 
          : 'N/A' },
        { property: 'Material Cost %', value: costSummary.grandTotal > 0 
          ? ((costSummary.totalMaterial / costSummary.grandTotal) * 100).toFixed(2) + '%'
          : '0.00%' },
        { property: 'Labor Cost %', value: costSummary.grandTotal > 0 
          ? ((costSummary.totalLabor / costSummary.grandTotal) * 100).toFixed(2) + '%'
          : '0.00%' },
        { property: 'Subcontract Cost %', value: costSummary.grandTotal > 0 
          ? ((costSummary.totalSubcontract / costSummary.grandTotal) * 100).toFixed(2) + '%'
          : '0.00%' },
        { property: '', value: '' },
        
        // Export Information
        { property: 'EXPORT INFORMATION', value: '' },
        { property: 'File Format', value: 'Excel (.xlsx)' },
        { property: 'Generated By', value: 'Costa - IFC Cost Analysis Tool' },
        { property: 'Worksheet Structure', value: 'Hierarchical grouping with expand/collapse' },
        { property: 'Grouping Levels', value: '4 levels: IFC Type, Element Group (with measurements), Littera Codes, GUID rows' },
        { property: 'Notes', value: 'All levels collapsed on export. Use Excel outline controls (left) to expand. No emoticons.' }
      ];

      metadataRows.forEach((row, index) => {
        const addedRow = metadataSheet.addRow(row);
        
        // Style section headers (identify by being all caps and no value)
        if (row.property && row.property === row.property.toUpperCase() && row.value === '') {
          addedRow.font = { bold: true, size: 12, color: { argb: 'FF4472C4' } };
          addedRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE7E6E6' }
          };
        } else if (row.property && row.property !== '') {
          // Style property names
          addedRow.getCell(1).font = { bold: true };
        }
      });

      // Style metadata header
      const metaHeaderRow = metadataSheet.getRow(1);
      metaHeaderRow.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      metaHeaderRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      metaHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };
      metaHeaderRow.height = 25;

      // Määräluettelo sheet: official 4-column Finnish quantity schedule format.
      // Columns: Littera | Selite | Määrä | Yks — identical to the Costa deliverable format.
      // Chapter header rows use short numeric codes and Yks = "***".
      // READ-ONLY for import — handleSyncImport always picks 'Measurement Data' or 'Sync' first.
      const maaraSheet = workbook.addWorksheet('Määräluettelo', {
        views: [{ state: 'frozen', ySplit: 1, showGridLines: true }]
      });
      maaraSheet.columns = [
        { header: 'Littera', key: 'littera', width: 14 },
        { header: 'Selite',  key: 'selite',  width: 58 },
        { header: 'Määrä',  key: 'maara',   width: 14 },
        { header: 'Yks',    key: 'yks',     width: 8  },
      ];

      const maaraHeaderRow = maaraSheet.getRow(1);
      maaraHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      maaraHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };
      maaraHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };
      maaraHeaderRow.height = 22;

      const addMaaraChapterRow = (littera: string | number, selite: string) => {
        const r = maaraSheet.addRow({ littera, selite, maara: ' ', yks: '***' });
        r.font = { bold: true, size: 11 };
        r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
        r.alignment = { vertical: 'middle' };
      };

      const addMaaraMeasureRow = (littera: string | number, selite: string, maara: number | string, yks: string) => {
        const r = maaraSheet.addRow({ littera, selite, maara, yks });
        r.alignment = { vertical: 'middle' };
        // Format Määrä cell as number when it is one
        if (typeof maara === 'number') r.getCell('maara').numFmt = '#,##0.00';
      };

      // --- Section 00: LAAJUUSTIEDOT (scope data — always present) ---
      addMaaraChapterRow('00', 'LAAJUUSTIEDOT');
      // 001000: site area — not extracted from IFC by default; left blank for manual entry
      addMaaraMeasureRow('001000', 'rakennusalueen pinta-ala', '', 'M2');
      // 002000: gross floor area (BRM2) — from projectInfo.area when available
      const maaraBrm2 = projectInfo?.area ? Math.round(projectInfo.area) : '';
      addMaaraMeasureRow('002000', 'bruttoala', maaraBrm2, 'BRM2');
      // 003000: building volume (RM3) — sum of GrossVolume across all elements
      const maaraVol = costData.reduce((sum, el) => {
        if (!contributesToMaara(el.extraProperties)) return sum;
        const gv = (el.baseQuantities?.GrossVolume as { value?: number })?.value ?? 0;
        return sum + gv;
      }, 0);
      addMaaraMeasureRow('003000', 'rakennusten tilavuus', maaraVol > 0 ? Math.round(maaraVol) : '', 'RM3');

      // --- Measurement rows from costData ---
      // Aggregate: one entry per unique litteraCode across all elements
      type MaaraEntry = { selite: string; quantity: number; unit: string; category: string };
      const maaraMap = new Map<string, MaaraEntry>();
      costData.forEach((el) => {
        if (!contributesToMaara(el.extraProperties)) return;
        (el.litteraCodes ?? []).forEach((lc) => {
          const code = (lc.litteraCode ?? '').trim();
          if (!code) return;
          if (!maaraMap.has(code)) {
            maaraMap.set(code, {
              selite:    lc.litteraName ?? '',
              quantity:  0,
              unit:      lc.unit ?? '',
              category:  lc.litteraCategory ?? '',
            });
          }
          maaraMap.get(code)!.quantity += lc.quantity ?? 0;
        });
      });

      // Group by 2-digit chapter prefix, sort numerically within and across chapters
      const maaraByChapter = new Map<string, { chapterName: string; rows: Array<{ code: string } & MaaraEntry> }>();
      Array.from(maaraMap.entries()).forEach(([code, entry]) => {
        const chapterCode = code.length >= 2 ? code.substring(0, 2) : code;
        if (!maaraByChapter.has(chapterCode)) {
          maaraByChapter.set(chapterCode, { chapterName: entry.category || chapterCode, rows: [] });
        }
        const chap = maaraByChapter.get(chapterCode)!;
        if (entry.category && chap.chapterName === chapterCode) chap.chapterName = entry.category;
        chap.rows.push({ code, ...entry });
      });

      Array.from(maaraByChapter.entries())
        .sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10))
        .forEach(([chapterCode, chap]) => {
          addMaaraChapterRow(chapterCode, chap.chapterName.toUpperCase());
          chap.rows
            .sort((a, b) => parseInt(a.code, 10) - parseInt(b.code, 10))
            .forEach((entry) => {
              const qty = entry.quantity > 0 ? parseFloat(entry.quantity.toFixed(2)) : '';
              addMaaraMeasureRow(entry.code, entry.selite, qty, entry.unit);
            });
        });

      // Generate Excel file
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      });
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `measurement-ifc-${currentDate}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      console.log('[CostPage] Excel exported with grouping:', {
        totalElements: costData.length,
        ifcTypes: elementsByType.size,
        withLittera: costData.filter(el => el.litteraCodes && el.litteraCodes.length > 0).length
      });

    } catch (error) {
      console.error('[CostPage] Error exporting to Excel:', error);
      alert('Error exporting to Excel. Please check console for details.');
    }
  };

  const onImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleSyncImport(file);
    e.target.value = '';
  };

  return (
    <div className="page cost-page">
      <header style={{ 
        padding: '1rem 2rem',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '24px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <h2 className="cost-page-main-header" style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px',
            margin: 0
          }}>
            <span className="material-icons-round">euro</span>
            {getTranslation(['pageTitle'], language) ?? ''}
          </h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {costData && costData.length > 0 && (() => {
            const headerBtnBase: React.CSSProperties = {
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '5px 10px',
              border: 'none',
              borderRadius: '5px',
              fontSize: '0.8rem',
              fontWeight: '500',
              cursor: 'pointer',
              transition: 'background-color 0.2s'
            };
            const excelColor = 'var(--primary, #1E88E5)';
            const libraryColor = '#5E35B1';
            const libraryApplyColor = '#00897B';
            const disabledColor = '#78909C';
            const hasLibrary = Boolean(getLibrary()?.entries?.length);
            const iconSize = '16px';
            return (
              <>
                {/* Grupo Excel: descargar, subir */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button
                    type="button"
                    onClick={handleDownloadMeasurementExcel}
                    style={{ ...headerBtnBase, backgroundColor: excelColor, color: 'white' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#1565C0'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = excelColor; }}
                    title={getTranslation(['headerButtons', 'downloadExcelTitle'], language)}
                  >
                    <span className="material-icons-round" style={{ fontSize: iconSize }}>download</span>
                    {getTranslation(['headerButtons', 'downloadExcel'], language)}
                  </button>
                  <input
                    type="file"
                    ref={importFileInputRef}
                    accept=".xlsx,.xls,.csv"
                    style={{ display: 'none' }}
                    onChange={onImportFileChange}
                    aria-label="Import sync file"
                  />
                  <button
                    type="button"
                    onClick={() => importFileInputRef.current?.click()}
                    style={{ ...headerBtnBase, backgroundColor: '#0D47A1', color: 'white' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#08306B'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#0D47A1'; }}
                    title={getTranslation(['headerButtons', 'uploadExcelTitle'], language)}
                  >
                    <span className="material-icons-round" style={{ fontSize: iconSize }}>upload_file</span>
                    {getTranslation(['headerButtons', 'uploadExcel'], language)}
                  </button>
                </div>
                {/* Grupo Librería: descargar, subir, aplicar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', borderLeft: '1px solid var(--border)', paddingLeft: '8px' }}>
                  <button
                    type="button"
                    onClick={handleLibraryDownload}
                    style={{ ...headerBtnBase, backgroundColor: libraryColor, color: 'white' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#4527A0'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = libraryColor; }}
                    title={getTranslation(['headerButtons', 'libraryDownloadTitle'], language)}
                  >
                    <span className="material-icons-round" style={{ fontSize: iconSize }}>download</span>
                    {getTranslation(['headerButtons', 'libraryDownload'], language)}
                  </button>
                  <input
                    type="file"
                    ref={libraryFileInputRef}
                    accept=".json"
                    style={{ display: 'none' }}
                    onChange={handleLibraryUpload}
                    aria-label={getTranslation(['headerButtons', 'libraryUpload'], language)}
                  />
                  <button
                    type="button"
                    onClick={() => libraryFileInputRef.current?.click()}
                    style={{ ...headerBtnBase, backgroundColor: libraryColor, color: 'white' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#4527A0'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = libraryColor; }}
                    title={getTranslation(['headerButtons', 'libraryUploadTitle'], language)}
                  >
                    <span className="material-icons-round" style={{ fontSize: iconSize }}>upload_file</span>
                    {getTranslation(['headerButtons', 'libraryUpload'], language)}
                  </button>
                  <button
                    type="button"
                    onClick={handleLibraryApply}
                    disabled={!hasLibrary || !costData?.length}
                    style={{
                      ...headerBtnBase,
                      backgroundColor: hasLibrary ? libraryApplyColor : disabledColor,
                      color: 'white',
                      cursor: hasLibrary && costData?.length ? 'pointer' : 'not-allowed'
                    }}
                    onMouseEnter={(e) => { if (hasLibrary && costData?.length) e.currentTarget.style.backgroundColor = '#00695C'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = hasLibrary ? libraryApplyColor : disabledColor; }}
                    title={getTranslation(['headerButtons', 'libraryApplyTitle'], language)}
                  >
                    <span className="material-icons-round" style={{ fontSize: iconSize }}>playlist_add_check</span>
                    {getTranslation(['headerButtons', 'libraryApply'], language)}
                  </button>
                </div>
              </>
            );
          })()}
          <DatabaseInfo hasData={costData && costData.length > 0} />
          <LanguageSelector />
        </div>
      </header>
      
      {/* Littera Validation Panel - Hidden until real IFC testing provides feedback */}
      {/* Uncomment to enable validation UI:
      {process.env.NODE_ENV === 'development' && (
        <div style={{ padding: '1rem 2rem', borderBottom: '1px solid var(--border)' }}>
          <LitteraValidationPanel />
        </div>
      )}
      */}
      
      <div className="main-page-content">
        <aside className="cost-page-project-info-section">
          <ProjectInfoCard
            projectInfo={projectInfo as StoreBaseProjectInfo | null}
            setProjectInfo={setProjectInfo as ProjectInfoCardProps['setProjectInfo']}
            costData={costData}
            setCostData={setCostData}
            startDate={startDate}
            setStartDate={setStartDate}
            setConstructionSchedule={setConstructionSchedule as React.Dispatch<React.SetStateAction<StoreConstructionSchedule | null>>}
            language={language}
            defaultCostFactors={DEFAULT_COST_FACTORS}
          />
        </aside>
        <div className="content-area">
          <div className="cost-table-excel-wrapper">
            <CostTableExcelStyle
              language={language}
              data={effectiveCostData}
              onEdit={handleCostEdit}
              onApplySuggestionGroup={handleApplySuggestionGroupWithLittera}
              onRemoveLitteraCode={handleRemoveLitteraCode}
              onUpdateLitteraCodeQuantity={handleUpdateLitteraCodeQuantity}
              onAddLitteraCode={handleAddLitteraCode}
              onRemoveElements={handleRemoveElements}
            />
          </div>
          <div className="actions-container" style={{ marginTop: '1rem', marginBottom: '1rem', display: 'flex', gap: '1rem' }}>
            <button 
              className="button-primary"
              onClick={handleRecalculate}
              disabled={Object.keys(editedElements).length === 0}
            >
              <span className="material-icons-round">calculate</span>
              {getTranslation(['actions', 'calculate'], language)}
            </button>
          </div>
          <CostSummaryCard summary={costSummary} language={language} />
          <CostAnalysisSection
            costSummary={costSummary}
            analysisResult={analysisResult}
            projectArea={projectInfo?.area ?? 0}
            language={language}
            elements={costData}
          />
          <OmaTyoVsSubcontractPanel
            elements={costData}
            costSummary={costSummary}
            language={language}
            projectInfo={projectInfo as ProjectInfo | null}
          />
          <CostComparisonChart 
            costSummary={costSummary}
            projectInfo={projectInfo as ProjectInfo | null}
            language={language}
          />
          <CostByGroupChart
            costData={costData}
            costSummary={costSummary}
            projectInfo={projectInfo as ProjectInfo | null}
            language={language}
          />
          {constructionSchedule && (
            <ConstructionSchedule 
              schedule={constructionSchedule}
              language={language}
            />
          )}
          <EnhancedBOQExportComponent 
            costData={costData}
            projectInfo={projectInfo}
            onExport={(filename, format) => {
              console.log(`Enhanced BOQ exported: ${filename} (${format})`);
            }}
          />
          <div style={{ marginTop: '2rem', opacity: 0.7 }}>
            <details>
              <summary style={{ cursor: 'pointer', fontSize: '0.9em', color: 'var(--text-2)' }}>
                Legacy BOQ Export (Basic Version)
              </summary>
              <BOQExportComponent 
                costData={costData}
                projectInfo={projectInfo}
                onExport={(filename, format) => {
                  console.log(`Legacy BOQ exported: ${filename} (${format})`);
                }}
              />
            </details>
          </div>
          <IFCTaskExportComponent
            costData={costData}
            projectInfo={projectInfo as ProjectInfo | null}
            constructionSchedule={constructionSchedule}
            language={language}
          />
        </div>
      </div>

      {/* Diálogo resultado importación Sync (Fase 2B) */}
      {syncImportResult && (
        <div
          role="dialog"
          aria-labelledby="sync-import-result-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
          onClick={() => setSyncImportResult(null)}
        >
          <div
            style={{
              backgroundColor: 'var(--surface-1)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '1.5rem',
              maxWidth: '400px',
              width: '90%',
              boxShadow: '0 8px 24px rgba(0,0,0,0.2)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="sync-import-result-title" className="cost-page-dialog-title">
              {headerCase(getTranslation(['syncImport', 'resultTitle'], language) || 'Import result')}
            </h3>
            <p style={{ margin: '0 0 0.5rem' }}>
              <strong>{syncImportResult.updated}</strong> {getTranslation(['syncImport', 'rowsUpdated'], language)}
            </p>
            {syncImportResult.ignored > 0 && (
              <p style={{ margin: '0 0 0.5rem', color: 'var(--text-2)' }}>
                <strong>{syncImportResult.ignored}</strong> {getTranslation(['syncImport', 'rowsIgnored'], language)}
              </p>
            )}
            {syncImportResult.errors.length > 0 && (
              <ul style={{ margin: '0.5rem 0', paddingLeft: '1.25rem', color: 'var(--warning)', fontSize: '0.9em' }}>
                {syncImportResult.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => setSyncImportResult(null)}
              style={{
                marginTop: '1rem',
                padding: '8px 16px',
                backgroundColor: 'var(--primary)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.9rem'
              }}
            >
              {getTranslation(['syncImport', 'close'], language)}
            </button>
          </div>
        </div>
      )}

    </div>
  );
} 